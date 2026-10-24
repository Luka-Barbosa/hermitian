/** Seeded randomness for the generator. Each subsystem gets its own stream. */

function hashSeed(seed: number, name: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h;
}

const BASE32 = "abcdefghjkmnpqrstuvwxyz23456789";

export class Rng {
  private state: number;
  private spareNormal: number | undefined;

  constructor(seed: number, stream: string) {
    this.state = hashSeed(seed, stream);
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Index drawn in proportion to weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  normal(): number {
    if (this.spareNormal !== undefined) {
      const s = this.spareNormal;
      this.spareNormal = undefined;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 50) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }

  id(prefix: string, length: number): string {
    let s = prefix;
    for (let i = 0; i < length; i++) s += BASE32[Math.floor(this.next() * BASE32.length)];
    return s;
  }

  hex(prefix: string, length: number): string {
    let s = prefix;
    for (let i = 0; i < length; i++) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
}
