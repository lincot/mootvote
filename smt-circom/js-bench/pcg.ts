const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;

const MULTIPLIER = 0x2360_ED05_1FC6_5DA4_4385_DF64_9FCC_F645n;

function rotR64(x: bigint, rot: number): bigint {
  const r = rot & 63;
  const xx = x & MASK64;
  if (r === 0) return xx;
  const br = BigInt(r);
  return ((xx >> br) | ((xx << (64n - br)) & MASK64)) & MASK64;
}

function writeU64LE(dst: Uint8Array, off: number, v: bigint): void {
  let x = v & MASK64;
  for (let i = 0; i < 8; i++) {
    dst[off + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}

export class Pcg64Mcg {
  private state: bigint;

  constructor(state: bigint) {
    this.state = (state | 1n) & MASK128;
  }

  nextU64(): bigint {
    const s = (this.state * MULTIPLIER) & MASK128;
    this.state = s;

    const rot = Number(s >> 122n);
    const hi = (s >> 64n) & MASK64;
    const lo = s & MASK64;
    const xsl = (hi ^ lo) & MASK64;

    return rotR64(xsl, rot);
  }

  fillBytes(dest: Uint8Array): void {
    let i = 0;
    while (i + 8 <= dest.length) {
      writeU64LE(dest, i, this.nextU64());
      i += 8;
    }
    const rem = dest.length - i;
    if (rem > 0) {
      const tmp = new Uint8Array(8);
      writeU64LE(tmp, 0, this.nextU64());
      dest.set(tmp.subarray(0, rem), i);
    }
  }
}
