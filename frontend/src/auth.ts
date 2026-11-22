import { PLATFORM_NAME } from "@lincot/mootvote-sdk";
import { toHex32 } from "../../helpers/utils.ts";
import type { SigningAccount } from "./keyring.tsx";
import { getPoseidon } from "./circomMemo";

const AUTH_DOMAIN = 1635087464n;

export async function makeAuthSig(account: SigningAccount) {
  const poseidon = await getPoseidon();
  const now = Math.floor(Date.now() / 1000);

  const m = poseidon([PLATFORM_NAME, AUTH_DOMAIN, BigInt(now)]);
  const sig = await account.signPoseidon(poseidon.F.toObject(m));

  return {
    "X-BJJ-PubX": toHex32(account.pub[0]),
    "X-BJJ-PubY": toHex32(account.pub[1]),
    "X-BJJ-Ts": String(now),
    "X-BJJ-Sig-R8X": String(sig.R8[0]),
    "X-BJJ-Sig-R8Y": String(sig.R8[1]),
    "X-BJJ-Sig-S": String(sig.S),
  };
}
