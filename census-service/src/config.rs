use config::{Config, File};
use serde::Deserialize;
use std::path::PathBuf;
use tracing::debug;

#[derive(Debug, Deserialize)]
pub(crate) struct IndexerConfig {
    pub addrs: String,
    pub ssl: SslConfig,
}

impl IndexerConfig {
    pub(super) fn from_path(config_path: PathBuf) -> Self {
        debug!("Reading config from path {:?}", config_path);
        let config = Config::builder()
            .add_source(File::from(config_path))
            .add_source(config::Environment::with_prefix("MV_CENSUS").separator("_"))
            .build()
            .expect("Failed to build envs");

        config
            .try_deserialize()
            .expect("Failed to deserialize config")
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct SslConfig {
    pub key: PathBuf,
    pub cert: PathBuf,
}
