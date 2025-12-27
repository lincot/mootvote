import { InMemoryDB, Merkletree } from "@iden3/js-merkletree";
import { Pcg64Mcg } from "./pcg.ts";

function randomBytes32FirstZero(rng: Pcg64Mcg): Uint8Array {
  const out = new Uint8Array(32);
  out[0] = 0;
  rng.fillBytes(out.subarray(1));
  return out;
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}

function randomPairs(rng: Pcg64Mcg, n: number): Array<[bigint, bigint]> {
  const pairs: Array<[bigint, bigint]> = [];
  for (let i = 0; i < n; i++) {
    const k = randomBytes32FirstZero(rng);
    const v = randomBytes32FirstZero(rng);
    pairs.push([bytesToBigIntBE(k), bytesToBigIntBE(v)]);
  }
  return pairs;
}

async function main(): Promise<void> {
  const db = new InMemoryDB(new Uint8Array());
  const mt = new Merkletree(db, true, 64);
  const rng = new Pcg64Mcg(0xcafe_f00d_d15e_a5e5n);
  const pairs = randomPairs(rng, 10);
  console.time("add");
  for (const pair of pairs) {
    await mt.add(pair[0], pair[1]);
  }
  console.timeEnd("add");

  console.time("generateProof");
  for (const pair of pairs) {
    await mt.generateProof(pair[0]);
  }
  console.timeEnd("generateProof");
}

main();
