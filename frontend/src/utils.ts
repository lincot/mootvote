import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function formatLamportsAsSol(lamports: bigint): string | null {
  if (lamports < 0n) return null;
  const whole = lamports / BigInt(LAMPORTS_PER_SOL);
  const frac = (lamports % BigInt(LAMPORTS_PER_SOL)).toString().padStart(
    9,
    "0",
  );
  const fracTrim = frac.replace(/0+$/, "");
  return fracTrim ? `${whole}.${fracTrim}` : `${whole}`;
}
