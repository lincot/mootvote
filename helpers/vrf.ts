import type { BabyJub, Point, Poseidon } from "circomlibjs";

// BabyJubJub Base8 / Poseidon DLEQ suite. Tags are ASCII strings encoded big-endian.
const MAP = 0x424a4a5f5652465f4d41505f5631n;
const DLEQ = 0x424a4a5f5652465f444c45515f5631n;
const OUT = 0x424a4a5f5652465f4f55545f5631n;

export function evaluateVrf(
  babyjub: BabyJub,
  poseidon: Poseidon,
  sk: bigint,
  scope: bigint,
) {
  if (scope < 0n || scope >= babyjub.p) {
    throw new RangeError("Invalid VRF scope");
  }
  const F = babyjub.F;
  const pub = babyjub.mulPointEscalar(babyjub.Base8, sk);
  const pubXY = pub.map((x) => F.toObject(x) as bigint);
  const map = (i: number) =>
    elligator2(babyjub, poseidon([MAP, ...pubXY, scope, i]));
  const base = babyjub.mulPointEscalar(babyjub.addPoint(map(0), map(1)), 8n);
  const gamma = babyjub.mulPointEscalar(base, sk);
  const output = babyjub.mulPointEscalar(gamma, 8n);
  if (F.isZero(output[0])) throw new Error("VRF output is the identity");

  // Wide reduction keeps the nonce bias negligible. Each proof needs fresh randomness.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(64));
  let nonce = 0n;
  for (const byte of bytes) nonce = (nonce << 8n) | BigInt(byte);
  const order = babyjub.subOrder;
  nonce = 1n + nonce % (order - 1n);
  const a = babyjub.mulPointEscalar(babyjub.Base8, nonce);
  const b = babyjub.mulPointEscalar(base, nonce);
  const coords = [...output, ...a, ...b].map((x) => F.toObject(x) as bigint);
  const digest: bigint = F.toObject(
    poseidon([DLEQ, scope, ...pubXY, ...coords]),
  );
  const challenge = digest & ((1n << 128n) - 1n);
  const response = (nonce + order - (challenge * 8n * sk) % order) % order;
  return {
    seed: F.toObject(poseidon([OUT, coords[0], coords[1]])) as bigint,
    vrfGamma: gamma.map((x) => F.toObject(x) as bigint),
    vrfChallenge: challenge,
    vrfResponse: response,
  };
}

// RFC 9380 section 6.7.1, followed by the Montgomery-to-Edwards map.
function elligator2(babyjub: BabyJub, u: Uint8Array): Point {
  const F = babyjub.F;
  const j = F.e(168698);
  const t = F.isZero(u) ? F.one : u;
  const z = F.mul(F.e(5), F.square(t));
  const x1 = F.div(F.neg(j), F.add(F.one, z));
  const gx = F.mul(x1, F.add(F.one, F.mul(x1, F.add(x1, j))));
  const first: boolean = F.isSquare(gx);
  const x = first ? x1 : F.sub(F.neg(j), x1);
  let y = F.sqrt(first ? gx : F.mul(z, gx));
  if ((F.toObject(y) & 1n) !== BigInt(first)) y = F.neg(y);
  return [F.div(x, y), F.div(F.sub(x, F.one), F.add(x, F.one))];
}
