import { IdlTypes } from "@coral-xyz/anchor";
import { Mootvote } from "./idl/mootvote";

export type CompressedProof = IdlTypes<Mootvote>["compressedProof"];
export type Point = IdlTypes<Mootvote>["point"];
export type Poll = IdlTypes<Mootvote>["poll"];
export type Tally = IdlTypes<Mootvote>["tally"];
export type PlatformConfig = IdlTypes<Mootvote>["platformConfig"];
