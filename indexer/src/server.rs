use actix_cors::Cors;
use actix_web::{error::ErrorInternalServerError, get, web, App, HttpServer, Responder};
use openssl::ssl::{SslAcceptor, SslFiletype, SslMethod};
use serde::{Deserialize, Serialize};
use serde_with::{hex::Hex, serde_as, DisplayFromStr};
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::SslConfig;

#[derive(Clone)]
struct AppState {
    pg_pool: PgPool,
}

pub struct Server {
    pg_pool: PgPool,
}

impl Server {
    pub fn new(pg_pool: PgPool) -> Self {
        Self { pg_pool }
    }

    pub async fn execute(
        self,
        addrs: &str,
        ssl_config: SslConfig,
        workers: usize,
    ) -> std::io::Result<()> {
        let state = AppState {
            pg_pool: self.pg_pool,
        };

        let mut ssl_builder = SslAcceptor::mozilla_intermediate(SslMethod::tls())?;
        ssl_builder.set_private_key_file(ssl_config.key, SslFiletype::PEM)?;
        ssl_builder.set_certificate_chain_file(ssl_config.cert)?;

        HttpServer::new(move || {
            App::new()
                .app_data(web::Data::new(state.clone()))
                .wrap(Cors::permissive())
                .wrap(actix_web::middleware::Compress::default())
                .service(get_poll)
                .service(list_votes)
                .service(list_polls)
                .service(is_voter)
        })
        .bind_openssl(addrs, ssl_builder)?
        .workers(workers)
        .run()
        .await
    }
}

#[serde_as]
#[derive(Serialize)]
struct PollOut {
    #[serde_as(as = "DisplayFromStr")]
    poll_id: u64,
    title: String,
    choices: Vec<String>,
    census_root: String,
    coordinator_key: (String, String),
    voting_start_time: u64,
    voting_end_time: u64,
    #[serde_as(as = "DisplayFromStr")]
    fee: u64,
    #[serde_as(as = "DisplayFromStr")]
    platform_fee: u64,
    fee_destination: String,
    description_url: String,
    census_url: String,
    tally: Option<Vec<u64>>,
}

#[get("/polls/{poll_id}")]
async fn get_poll(
    state: web::Data<AppState>,
    path: web::Path<i64>,
) -> actix_web::Result<impl Responder> {
    let poll_id = path.into_inner();
    let rec = sqlx::query!(
        r#"
        SELECT poll_id, title, choices, census_root, coord_x, coord_y,
               voting_start_time, voting_end_time, fee, platform_fee,
               fee_destination, description_url, census_url, tally
        FROM polls WHERE poll_id = $1 AND title IS NOT NULL AND census_valid IS TRUE
        "#,
        poll_id
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    if let Some(p) = rec {
        let out = PollOut {
            poll_id: p.poll_id as u64,
            title: p
                .title
                .expect("title expected to be not null as per query constraint"),
            choices: p
                .choices
                .expect("choices are expected to be set atomically with title"),
            census_root: hex::encode(&p.census_root),
            coordinator_key: (hex::encode(&p.coord_x), hex::encode(&p.coord_y)),
            voting_start_time: p.voting_start_time as u64,
            voting_end_time: p.voting_end_time as u64,
            fee: p.fee as u64,
            platform_fee: p.platform_fee as u64,
            fee_destination: p.fee_destination,
            description_url: p.description_url,
            census_url: p.census_url,
            tally: p.tally.map(bytemuck::cast_vec),
        };
        Ok(web::Json(out))
    } else {
        Err(actix_web::error::ErrorNotFound("poll not found"))
    }
}

#[serde_as]
#[derive(Serialize)]
struct VoteOut {
    #[serde_as(as = "DisplayFromStr")]
    id: u64,
    eph_x: String,
    eph_y: String,
    #[serde_as(as = "DisplayFromStr")]
    nonce: u64,
    ciphertext: String,
}

#[derive(Deserialize)]
struct VotesQuery {
    limit: Option<i64>,
    after: Option<i64>,
}

#[get("/polls/{poll_id}/votes")]
async fn list_votes(
    state: web::Data<AppState>,
    path: web::Path<i64>,
    query: web::Query<VotesQuery>,
) -> actix_web::Result<impl Responder> {
    let poll_id = path.into_inner();
    let limit = query.limit.unwrap_or(100).clamp(1, 1000);
    let after_id = query.after.unwrap_or(0);

    let total = sqlx::query_scalar!(
        r#"SELECT COUNT(*)::BIGINT FROM votes WHERE poll_id = $1"#,
        poll_id
    )
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?
    .unwrap_or(0);

    let rows = sqlx::query!(
        r#"
        SELECT id, eph_x, eph_y, nonce, ciphertext
        FROM votes
        WHERE poll_id = $1 AND id > $2
        ORDER BY id ASC
        LIMIT $3
        "#,
        poll_id,
        after_id,
        limit + 1
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let items: Vec<_> = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| VoteOut {
            id: r.id as u64,
            eph_x: hex::encode(&r.eph_x),
            eph_y: hex::encode(&r.eph_y),
            nonce: r.nonce as u64,
            ciphertext: hex::encode(&r.ciphertext),
        })
        .collect();

    #[derive(Serialize)]
    struct Page {
        items: Vec<VoteOut>,
        total: u64,
    }

    Ok(web::Json(Page {
        items,
        total: total as u64,
    }))
}

#[derive(Deserialize)]
enum PollStatus {
    Active,
    Upcoming,
    Ended,
}

#[serde_as]
#[derive(Serialize)]
struct PollItem {
    #[serde_as(as = "DisplayFromStr")]
    poll_id: u64,
    voting_start_time: u64,
    voting_end_time: u64,
    title: String,
    choices: Vec<String>,
}

#[derive(Serialize)]
struct PollPage {
    items: Vec<PollItem>,
    next_before: Option<u64>,
}

#[serde_as]
#[derive(Deserialize)]
struct UserPollsQuery {
    #[serde_as(as = "Option<Hex>")]
    voter_leaf: Option<[u8; 32]>,
    #[serde_as(as = "Option<Hex>")]
    coordinator: Option<[u8; 64]>,
    status: Option<PollStatus>,
    limit: Option<i64>,
    before: Option<i64>,
}

#[get("/polls")]
async fn list_polls(
    state: web::Data<AppState>,
    q: web::Query<UserPollsQuery>,
) -> actix_web::Result<web::Json<PollPage>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let before = q.before.unwrap_or(i64::MAX);

    if q.coordinator.is_none() && q.voter_leaf.is_none() {
        return Err(actix_web::error::ErrorBadRequest(
            "provide coordinator and/or voter_leaf",
        ));
    }

    let (coord_present, coord_x, coord_y) = if let Some(c) = &q.coordinator {
        (true, &c[..32], &c[32..])
    } else {
        (false, &[0u8; 32][..], &[0u8; 32][..])
    };
    let (voter_present, voter_leaf_bytes) = if let Some(v) = &q.voter_leaf {
        (true, &v[..])
    } else {
        (false, &[0u8; 32][..])
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let want_active = matches!(q.status, Some(PollStatus::Active));
    let want_upcoming = matches!(q.status, Some(PollStatus::Upcoming));
    let want_ended = matches!(q.status, Some(PollStatus::Ended));

    let skip_active = !want_active;
    let skip_upcoming = !want_upcoming;
    let skip_ended = !want_ended;

    let rows = sqlx::query!(
        r#"
        SELECT
          p.id,
          p.poll_id,
          p.title,
          p.choices,
          p.voting_start_time,
          p.voting_end_time,
          p.description_url,
          p.census_url
        FROM polls p
        WHERE
          p.census_valid = TRUE
          AND p.title IS NOT NULL
          AND p.id < $10
          AND (
                ($1 AND p.coord_x = $2 AND p.coord_y = $3)
                OR
                ($4 AND EXISTS (
                     SELECT 1 FROM voter_polls vp
                     WHERE vp.poll_id = p.poll_id
                       AND vp.key_hash = $5
                ))
          )
          AND ($7 OR (p.voting_start_time <= $6 AND p.voting_end_time >  $6))
          AND ($8 OR (p.voting_start_time > $6))
          AND ($9 OR (p.voting_end_time <= $6))
        ORDER BY p.id DESC
        LIMIT $11
        "#,
        coord_present,
        coord_x,
        coord_y,
        voter_present,
        voter_leaf_bytes,
        now as i64,
        skip_active,
        skip_upcoming,
        skip_ended,
        before,
        limit + 1,
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let next_before = if rows.len() > limit as usize {
        Some(rows[limit as usize - 1].id as u64)
    } else {
        None
    };
    let items = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| PollItem {
            poll_id: r.poll_id as u64,
            voting_start_time: r.voting_start_time as u64,
            voting_end_time: r.voting_end_time as u64,
            title: r
                .title
                .expect("title expected to be not null as per query constraint"),
            choices: r
                .choices
                .expect("choices are expected to be set atomically with title"),
        })
        .collect();

    Ok(web::Json(PollPage { items, next_before }))
}

#[serde_as]
#[derive(Deserialize)]
struct IsVoterQuery {
    #[serde_as(as = "Hex")]
    leaf: [u8; 32],
}

#[get("/polls/{poll_id}/is_voter")]
async fn is_voter(
    state: web::Data<AppState>,
    path: web::Path<u64>,
    q: web::Query<IsVoterQuery>,
) -> actix_web::Result<&'static str> {
    let poll_id = path.into_inner();

    let is_voter = sqlx::query_scalar!(
        r#"SELECT 1 FROM voter_polls WHERE poll_id = $1 AND key_hash = $2"#,
        poll_id as i64,
        &q.leaf[..]
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| actix_web::error::ErrorInternalServerError("db"))?
    .is_some();

    Ok(if is_voter { "true" } else { "false" })
}
