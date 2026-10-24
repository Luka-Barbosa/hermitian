import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Deterministic request hashing and the on-disk fixture store shared by System 1 and System 2. */

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function requestHash(value: unknown): string {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24);
}

export function fixturesRoot(): string {
  return path.join(process.cwd(), "fixtures");
}

export function fixturePath(kind: "decide" | "system2", hash: string): string {
  return path.join(fixturesRoot(), kind, `${hash}.json`);
}

/** Every fixture read or written in this process, so the recorder can prune stale ones. */
export const usedFixtures = new Set<string>();

export function readFixture<T>(kind: "decide" | "system2", hash: string): T | undefined {
  const file = fixturePath(kind, hash);
  if (!fs.existsSync(file)) return undefined;
  usedFixtures.add(path.join(kind, `${hash}.json`));
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeFixture(kind: "decide" | "system2", hash: string, data: unknown): void {
  const file = fixturePath(kind, hash);
  usedFixtures.add(path.join(kind, `${hash}.json`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Replay never falls through to a live call; it fails loudly with the request hash. */
export class FixtureMissError extends Error {
  constructor(
    readonly kind: "decide" | "system2",
    readonly hash: string,
    readonly tag: string,
  ) {
    super(
      `No recorded ${kind === "decide" ? "System 1" : "System 2"} fixture for "${tag}" (hash ${hash}). ` +
        `Replay never calls a live model. Record it with \`pnpm fixtures:record\`, or run with a live backend.`,
    );
    this.name = "FixtureMissError";
  }
}
