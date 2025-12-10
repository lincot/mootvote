import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Mootvote } from "./idl/mootvote";
import mootvoteIdl from "./idl/mootvote.json";
import { createStubObject } from "./utils";

let _program: Program<Mootvote> | undefined;

const getStubProvider = () =>
  createStubObject(
    "Provider has not been set. Call `setProvider(provider)` before using this function.",
  ) as AnchorProvider;

export const getProgram =
  () => (_program ??= new Program(mootvoteIdl, getStubProvider()));

/** Call once, early, to supply the RPC provider. */
export const setProvider = (provider: AnchorProvider) => {
  _program = new Program(mootvoteIdl, provider);
};
