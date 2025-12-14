export const CLUSTER = (import.meta.env.VITE_CLUSTER) as
  | "devnet"
  | "mainnet";
export const RPC_URL = import.meta.env.VITE_RPC_URL as string;
export const INDEXER_URL = import.meta.env.VITE_INDEXER_URL as string;
export const RELAYER_URL = import.meta.env.VITE_RELAYER_URL as string;
export const CENSUS_URL = import.meta.env.VITE_CENSUS_URL as string;
export const OTHER_CLUSTER_URL = import.meta.env.VITE_OTHER_CLUSTER_URL as
  | string
  | undefined;
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL;
