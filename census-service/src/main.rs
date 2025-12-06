use clap::Parser;
use sqlx::postgres::PgPoolOptions;
use std::{env, path::PathBuf};
use tracing::error;

use crate::{config::IndexerConfig, server::Server};

mod config;
mod server;

#[derive(Parser)]
#[clap(author, version, about, long_about = None)]
pub struct Cli {
    #[arg(long, short, help = "Config path")]
    config: PathBuf,
}

#[actix_web::main]
async fn main() {
    dotenvy::dotenv().unwrap();
    tracing_subscriber::fmt::init();

    let cli = Cli::parse_from(env::args());
    let config = IndexerConfig::from_path(cli.config);

    let url = std::env::var("DATABASE_URL").expect("expected DATABASE_URL to be set");
    let pg_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("Expected postgres to connect");

    let server = Server::new(pg_pool);

    let res = server
        .execute(
            &config.addrs,
            config.ssl,
            std::thread::available_parallelism()
                .unwrap()
                .get()
                .saturating_sub(5)
                .min(1),
        )
        .await;
    if let Err(err) = res {
        error!("Server finished with {err}");
    }
}
