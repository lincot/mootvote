import { PLATFORM_NAME } from "@lincot/anon-vote-sdk";
import { getEddsa, getPoseidon } from "./circomMemo";

const AUTH_DOMAIN = 1635087464n;

export async function makeAuthSig(prv: Uint8Array, pubXY: [bigint, bigint]) {
  const eddsa = await getEddsa();
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const now = Math.floor(Date.now() / 1000);

  const m = poseidon([PLATFORM_NAME, AUTH_DOMAIN, BigInt(now)]);
  const sig = eddsa.signPoseidon(prv, m);

  const toHex32 = (n: bigint) => {
    const out = new Uint8Array(32);
    let x = n;
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  return {
    "X-BJJ-PubX": toHex32(pubXY[0]),
    "X-BJJ-PubY": toHex32(pubXY[1]),
    "X-BJJ-Ts": String(now),
    "X-BJJ-Sig-R8X": String(F.toObject(sig.R8[0])),
    "X-BJJ-Sig-R8Y": String(F.toObject(sig.R8[1])),
    "X-BJJ-Sig-S": String(sig.S),
  };
}
