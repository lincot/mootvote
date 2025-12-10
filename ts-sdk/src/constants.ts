import { PublicKey } from "@solana/web3.js";
import mootVoteIdl from "./idl/mootvote.json";

export const PROGRAM_ID = new PublicKey(mootVoteIdl.address);

export const PLATFORM_NAME = 5579801008792368229n;

export const PLATFORM_CONFIG = PublicKey.findProgramAddressSync(
  [Buffer.from("PLATFORM_CONFIG")],
  PROGRAM_ID,
)[0];
