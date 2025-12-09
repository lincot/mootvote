use actix_cors::Cors;
use actix_web::error::ErrorInternalServerError;
use actix_web::{delete, get, post, web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use babyjubjub_rs::Fr;
use babyjubjub_rs::{verify, Point, Signature};
use ff_ce::PrimeField;
use light_poseidon::{Poseidon, PoseidonBytesHasher};
use num_bigint::{BigInt, Sign};
use openssl::ssl::{SslAcceptor, SslFiletype, SslMethod};
use rand::{rngs::OsRng, TryRngCore};
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::info;

use crate::config::SslConfig;

const PLATFORM_NAME: u64 = 4714828379590718565;
// name = "auth"; sum([ord(ch) << (8 * (len(name) - 1 - i)) for i, ch in enumerate(name)])
const AUTH_DOMAIN: u64 = 1635087464;

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
                .service(create_census)
                .service(list_censuses)
                .service(list_members)
                .service(add_member)
                .service(remove_member)
                .service(preflight_registration)
                .service(claim_member)
                .service(export_census)
        })
        .bind_openssl(addrs, ssl_builder)?
        .workers(workers)
        .run()
        .await
    }
}

#[derive(Deserialize)]
struct CreateCensusBody {
    title: String,
    description: Option<String>,
    members: Option<Vec<String>>,
}

#[derive(Serialize)]
struct CreateCensusOut {
    census_id: i64,
}

#[post("/census")]
pub async fn create_census(
    state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<CreateCensusBody>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let mut tx = state
        .pg_pool
        .begin()
        .await
        .map_err(|_| ErrorInternalServerError("Database error"))?;

    let created = sqlx::query!(
        r#"INSERT INTO censuses (title, description, creator_x, creator_y)
           VALUES ($1,$2,$3,$4) RETURNING id"#,
        body.title,
        body.description,
        &actor.pub_x[..],
        &actor.pub_y[..]
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let census_id = created.id;

    if let Some(names) = &body.members {
        for name in names {
            let token = rand_token_32();
            sqlx::query!(
                r#"INSERT INTO census_members (census_id, name, invite)
                   VALUES ($1,$2,$3) RETURNING id"#,
                census_id,
                name,
                &token[..]
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ErrorInternalServerError("Database error"))?;
        }
    }

    tx.commit()
        .await
        .map_err(|_| ErrorInternalServerError("Database error"))?;
    info!("created census {census_id}");

    Ok(web::Json(CreateCensusOut { census_id }))
}

#[derive(Serialize)]
struct CensusListItem {
    id: i64,
    title: String,
    description: Option<String>,
    is_creator: bool,
}

#[derive(Serialize)]
struct ListCensusesOut {
    items: Vec<CensusListItem>,
    next_before: Option<u64>,
}

#[get("/censuses")]
pub async fn list_censuses(
    state: web::Data<AppState>,
    req: HttpRequest,
    mut q: web::Query<ListCensusesQuery>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    q.clamp();

    let rows = sqlx::query!(
        r#"
            SELECT
              c.id,
              c.title,
              c.description,
              (c.creator_x = $1 AND c.creator_y = $2) AS "is_creator!"
            FROM censuses c
            WHERE c.id < $3
              AND (
                (c.creator_x = $1 AND c.creator_y = $2)
                OR $5 AND EXISTS (
                  SELECT 1
                  FROM census_members m
                  WHERE m.census_id = c.id
                    AND m.pub_x = $1
                    AND m.pub_y = $2
                )
              )
            ORDER BY c.id DESC
            LIMIT $4
            "#,
        &actor.pub_x[..],
        &actor.pub_y[..],
        q.before.unwrap_or(i64::MAX),
        q.limit + 1,
        !q.creator_only
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let next_before = if rows.len() > q.limit as usize {
        Some(rows[q.limit as usize - 1].id as u64)
    } else {
        None
    };
    let items: Vec<CensusListItem> = rows
        .into_iter()
        .take(q.limit as usize)
        .map(|r| CensusListItem {
            id: r.id,
            title: r.title,
            description: r.description,
            is_creator: r.is_creator,
        })
        .collect();

    Ok(web::Json(ListCensusesOut { items, next_before }))
}

#[derive(Serialize)]
struct MemberRow {
    id: i64,
    name: String,
    pub_x: Option<String>,
    pub_y: Option<String>,
    joined: bool,
    invite: Option<String>,
}

#[derive(Serialize)]
struct ListMembersOut {
    items: Vec<MemberRow>,
    title: String,
    description: Option<String>,
    is_creator: bool,
    any_left: bool,
}

#[get("/census/{census_id}/members")]
pub async fn list_members(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<i64>,
    mut q: web::Query<PaginationAfter>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let census_id = path.into_inner();
    q.clamp();

    let census = sqlx::query!(
        r#"SELECT title, description, creator_x, creator_y FROM censuses
           WHERE id=$1"#,
        census_id
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let Some(census) = census else {
        return Err(actix_web::error::ErrorNotFound("census not found"));
    };

    let is_creator = same_key(&actor, &census.creator_x, &census.creator_y);

    if !is_creator {
        let row = sqlx::query_scalar!(
            r#"SELECT 1 FROM census_members
                       WHERE census_id=$1 AND pub_x=$2 AND pub_y=$3"#,
            census_id,
            &actor.pub_x[..],
            &actor.pub_y[..]
        )
        .fetch_optional(&state.pg_pool)
        .await
        .map_err(|_| ErrorInternalServerError("Database error"))?;
        if row.is_none() {
            return Err(actix_web::error::ErrorUnauthorized("not a creator/member"));
        }
    }

    let rows = sqlx::query!(
        r#"SELECT id, name, pub_x, pub_y, invite FROM census_members
               WHERE census_id=$1 AND id >= $2
               ORDER BY id ASC
               LIMIT $3"#,
        census_id,
        q.after.map_or(0, |x| x + 1),
        q.limit + 1
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let any_left = rows.len() > q.limit as usize;
    let items: Vec<MemberRow> = rows
        .into_iter()
        .take(q.limit as usize)
        .map(|r| {
            let (jx, jy, joined) = match (r.pub_x, r.pub_y) {
                (Some(px), Some(py)) => (Some(hex::encode(px)), Some(hex::encode(py)), true),
                _ => (None, None, false),
            };
            MemberRow {
                id: r.id,
                name: r.name,
                pub_x: jx,
                pub_y: jy,
                joined,
                invite: if is_creator {
                    r.invite.map(hex::encode)
                } else {
                    None
                },
            }
        })
        .collect();

    Ok(web::Json(ListMembersOut {
        items,
        is_creator,
        title: census.title,
        description: census.description,
        any_left,
    }))
}

#[derive(Deserialize)]
struct AddMemberBody {
    member: String,
}

#[derive(Serialize)]
struct InviteOut {
    member_id: i64,
    name: String,
    token: String,
}

#[derive(Serialize)]
struct AddMemberOut {
    invite: InviteOut,
}

#[post("/census/{census_id}/members")]
pub async fn add_member(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<i64>,
    body: web::Json<AddMemberBody>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let census_id = path.into_inner();

    let c = sqlx::query!(
        r#"SELECT creator_x, creator_y FROM censuses WHERE id=$1"#,
        census_id
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let Some(c) = c else {
        return Err(actix_web::error::ErrorNotFound("no such census"));
    };
    if !same_key(&actor, &c.creator_x, &c.creator_y) {
        return Err(actix_web::error::ErrorUnauthorized("only creator can add"));
    }

    let token = rand_token_32();
    let name = &body.member;
    let row = sqlx::query!(
        r#"INSERT INTO census_members (census_id, name, invite)
               VALUES ($1,$2,$3) RETURNING id"#,
        census_id,
        name,
        &token[..]
    )
    .fetch_one(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let invite = InviteOut {
        member_id: row.id,
        name: name.clone(),
        token: hex::encode(token),
    };

    Ok(web::Json(AddMemberOut { invite }))
}

#[delete("/census/{census_id}/members/{member_id}")]
pub async fn remove_member(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<(i64, i64)>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let (census_id, member_id) = path.into_inner();

    let c = sqlx::query!(
        r#"SELECT creator_x, creator_y FROM censuses WHERE id=$1"#,
        census_id
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let Some(c) = c else {
        return Err(actix_web::error::ErrorNotFound("no such census"));
    };
    if !same_key(&actor, &c.creator_x, &c.creator_y) {
        return Err(actix_web::error::ErrorUnauthorized(
            "only creator can remove",
        ));
    }

    let res = sqlx::query!(
        r#"DELETE FROM census_members WHERE id=$1 AND census_id=$2"#,
        member_id,
        census_id
    )
    .execute(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    if res.rows_affected() == 0 {
        return Err(actix_web::error::ErrorNotFound("no such member"));
    }
    Ok(HttpResponse::NoContent())
}

#[derive(Serialize)]
struct PreflightOut {
    member_id: i64,
    name: String,
    census_title: String,
}

#[get("/census/{census_id}/registration/{token}")]
pub async fn preflight_registration(
    state: web::Data<AppState>,
    path: web::Path<(i64, String)>,
) -> actix_web::Result<impl Responder> {
    let (census_id, tok_hex) = path.into_inner();

    let tok = hex::decode(tok_hex).map_err(|_| actix_web::error::ErrorBadRequest("bad token"))?;
    if tok.len() != 32 {
        return Err(actix_web::error::ErrorBadRequest("bad token len"));
    }

    let r = sqlx::query!(
        r#"SELECT m.id as member_id, m.name, c.title
           FROM census_members m
           JOIN censuses c ON c.id = m.census_id
           WHERE m.census_id=$1 AND m.invite=$2"#,
        census_id,
        &tok[..]
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let Some(r) = r else {
        return Err(actix_web::error::ErrorUnauthorized("invalid/used token"));
    };

    Ok(web::Json(PreflightOut {
        member_id: r.member_id,
        name: r.name,
        census_title: r.title,
    }))
}

#[derive(Deserialize)]
struct ClaimBody {
    token: String,
}

#[post("/census/{census_id}/members/{member_id}/claim")]
pub async fn claim_member(
    state: web::Data<AppState>,
    path: web::Path<(i64, i64)>,
    req: HttpRequest,
    body: web::Json<ClaimBody>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let (census_id, member_id) = path.into_inner();

    let tok =
        hex::decode(&body.token).map_err(|_| actix_web::error::ErrorBadRequest("bad token"))?;
    if tok.len() != 32 {
        return Err(actix_web::error::ErrorBadRequest("bad token len"));
    }

    let res = sqlx::query!(
        r#"UPDATE census_members
           SET pub_x=$1, pub_y=$2, invite=NULL
           WHERE id=$3 AND census_id=$4 AND invite=$5 AND pub_x IS NULL"#,
        &actor.pub_x[..],
        &actor.pub_y[..],
        member_id,
        census_id,
        &tok[..]
    )
    .execute(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    if res.rows_affected() != 1 {
        return Err(actix_web::error::ErrorConflict(
            "invalid token or already claimed",
        ));
    }

    Ok(HttpResponse::NoContent())
}

#[get("/census/{census_id}/export")]
pub async fn export_census(
    state: web::Data<AppState>,
    req: HttpRequest,
    path: web::Path<i64>,
) -> actix_web::Result<impl Responder> {
    let actor = verify_bjj(&req)?;

    let census_id = path.into_inner();

    let c = sqlx::query!(
        r#"SELECT creator_x, creator_y, title FROM censuses WHERE id=$1"#,
        census_id
    )
    .fetch_optional(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;
    let Some(c) = c else {
        return Err(actix_web::error::ErrorNotFound("no such census"));
    };
    if !same_key(&actor, &c.creator_x, &c.creator_y) {
        return Err(actix_web::error::ErrorUnauthorized(
            "only creator can export",
        ));
    }

    let rows = sqlx::query!(
        r#"
        SELECT pub_x, pub_y
        FROM census_members
        WHERE census_id=$1 AND pub_x IS NOT NULL AND pub_y IS NOT NULL
        ORDER BY id ASC
        "#,
        census_id
    )
    .fetch_all(&state.pg_pool)
    .await
    .map_err(|_| ErrorInternalServerError("Database error"))?;

    let mut out = Vec::with_capacity(rows.len() * 32);
    for r in rows {
        let px = r.pub_x.expect("guarded by IS NOT NULL");
        let py = r.pub_y.expect("guarded by IS NOT NULL");
        let leaf = poseidon_hash(&[&px[..], &py[..]]);
        out.extend_from_slice(&leaf);
    }

    let filename = format!("census_{}.bin", census_id);
    Ok(HttpResponse::Ok()
        .content_type("application/octet-stream")
        .append_header((
            actix_web::http::header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        ))
        .body(out))
}

fn rand_token_32() -> [u8; 32] {
    let mut t = [0u8; 32];
    OsRng.try_fill_bytes(&mut t).unwrap();
    t
}

#[derive(Debug, Deserialize)]
struct ListCensusesQuery {
    #[serde(default = "ListCensusesQuery::default_limit")]
    limit: i64,
    before: Option<i64>,
    #[serde(default)]
    creator_only: bool,
}

impl ListCensusesQuery {
    fn default_limit() -> i64 {
        50
    }

    fn clamp(&mut self) {
        if self.limit < 1 || self.limit > 200 {
            self.limit = 50;
        }
    }
}

#[derive(Debug, Deserialize)]
struct PaginationAfter {
    #[serde(default = "PaginationAfter::default_limit")]
    limit: i64,
    after: Option<i64>,
}

impl PaginationAfter {
    fn default_limit() -> i64 {
        50
    }

    fn clamp(&mut self) {
        if self.limit < 1 || self.limit > 200 {
            self.limit = 50;
        }
    }
}

#[derive(Debug, Clone)]
struct BjjActor {
    pub_x: [u8; 32],
    pub_y: [u8; 32],
}

fn parse_hex_32(s: &str) -> Option<[u8; 32]> {
    let mut res = [0; 32];
    hex::decode_to_slice(s, &mut res).ok()?;
    Some(res)
}

fn poseidon_hash(inputs: &[&[u8]]) -> [u8; 32] {
    let mut p = Poseidon::<ark_bn254::Fr>::new_circom(inputs.len()).expect("poseidon init");
    p.hash_bytes_be(inputs).expect("poseidon hash")
}

fn extract_actor(req: &HttpRequest) -> Option<BjjActor> {
    Some(BjjActor {
        pub_x: parse_hex_32(req.headers().get("X-BJJ-PubX")?.to_str().ok()?)?,
        pub_y: parse_hex_32(req.headers().get("X-BJJ-PubY")?.to_str().ok()?)?,
    })
}

fn extract_sig(req: &HttpRequest) -> Option<Signature> {
    let r8 = [
        req.headers().get("X-BJJ-Sig-R8X")?.to_str().ok()?,
        req.headers().get("X-BJJ-Sig-R8Y")?.to_str().ok()?,
    ];
    let s = req.headers().get("X-BJJ-Sig-S")?.to_str().ok()?;
    Some(Signature {
        r_b8: Point {
            x: Fr::from_str(r8[0])?,
            y: Fr::from_str(r8[1])?,
        },
        s: s.parse().ok()?,
    })
}

fn extract_timestamp(req: &HttpRequest) -> Option<u64> {
    req.headers()
        .get("X-BJJ-Ts")?
        .to_str()
        .map(|x| x.parse().ok())
        .ok()
        .flatten()
}

fn verify_bjj(req: &HttpRequest) -> actix_web::Result<BjjActor> {
    let bad_auth = || actix_web::error::ErrorUnauthorized("bad auth");

    let actor = extract_actor(req).ok_or_else(bad_auth)?;
    let ts = extract_timestamp(req).ok_or_else(bad_auth)?;
    let sig = extract_sig(req).ok_or_else(bad_auth)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    if now.abs_diff(ts) > 300 {
        return Err(bad_auth());
    }

    if !verify(
        Point {
            x: Fr::from_str(&U256::from_be_bytes(actor.pub_x).to_string()).ok_or_else(bad_auth)?,
            y: Fr::from_str(&U256::from_be_bytes(actor.pub_y).to_string()).ok_or_else(bad_auth)?,
        },
        sig,
        BigInt::from_bytes_be(
            Sign::Plus,
            &poseidon_hash(&[
                &u64_to_u256_be(PLATFORM_NAME)[..],
                &u64_to_u256_be(AUTH_DOMAIN),
                &u64_to_u256_be(ts),
            ]),
        ),
    ) {
        return Err(bad_auth());
    }

    Ok(actor)
}

fn u64_to_u256_be(x: u64) -> [u8; 32] {
    let mut res = [0; 32];
    res[32 - 8..].copy_from_slice(&x.to_be_bytes());
    res
}

fn same_key(a: &BjjActor, bx: &[u8], by: &[u8]) -> bool {
    a.pub_x == bx && a.pub_y == by
}

#[cfg(test)]
mod tests {
    use num_bigint::BigInt;

    use super::*;

    #[test]
    fn test_verify_signature() {
        // A signature produced using `eddsa.signPoseidon` from circomlibjs.
        const PK: [&str; 2] = [
            "9229531240475740265956875512374294167393085137488369755580333200945296237123",
            "8364167114868939986456454121854073438982879570629316490143522109119596438902",
        ];
        const SIG_R: [&str; 2] = [
            "14236187186491676939638795168633810091929111247056128898934459660013864423818",
            "17276484980815423925763024583001492817035617081616319823377871567815646536180",
        ];
        const SIG_S: &str =
            "1231521666459076784388195539051829862620402904018391670199499808297134704458";
        const MSG: &str =
            "1147491218570295699578247864279555812020164507614875068951199449867530758073";

        let pk = Point {
            x: Fr::from_str(PK[0]).unwrap(),
            y: Fr::from_str(PK[1]).unwrap(),
        };
        let sig = Signature {
            r_b8: Point {
                x: Fr::from_str(SIG_R[0]).unwrap(),
                y: Fr::from_str(SIG_R[1]).unwrap(),
            },
            s: SIG_S.parse().unwrap(),
        };
        let mut msg: BigInt = MSG.parse().unwrap();
        assert_eq!(verify(pk.clone(), sig.clone(), msg.clone()), true);
        msg += 1;
        assert_eq!(verify(pk, sig, msg), false);
    }
}
