// Cloudflare runtime bindings, null-safe for local dev (where none exist).
// Abuse protection lives here: two per-IP rate tiers + a global daily budget
// on paid upstream calls. All limits are tunable constants in this file.

export const LIMITS = {
  /** Hard ceiling on TOTAL uncached TypeSafe calls per UTC day, all users.
   * The catastrophic-case cost cap — distributed attacks hit this wall. */
  DAILY_UPSTREAM_CAP: 5000,
  /** Per-IP daily cap on uncached calls. KV-backed, so unlike the ratelimit
   * binding it can't be diluted by connection spraying across servers.
   * A heavy legit player uses well under 150/day (most judgments are cached). */
  IP_DAILY_CAP: 250,
} as const;

type RateLimiter = { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
type AnalyticsEngine = {
  writeDataPoint: (p: { blobs?: string[]; doubles?: number[]; indexes?: string[] }) => void;
};
export type KVNamespaceLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
};

async function cfEnv(): Promise<Record<string, unknown> | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return getCloudflareContext().env as Record<string, unknown>;
  } catch {
    return null; // not on Cloudflare (plain `next dev`)
  }
}

export async function judgeKV(): Promise<KVNamespaceLike | null> {
  const env = await cfEnv();
  return (env?.JUDGE_CACHE as KVNamespaceLike) ?? null;
}

/** true = allowed. Fails open when the binding is missing (local dev). */
export async function checkLimit(name: "RL_LOOSE" | "RL_STRICT", key: string): Promise<boolean> {
  const env = await cfEnv();
  const rl = env?.[name] as RateLimiter | undefined;
  if (!rl) return true;
  try {
    return (await rl.limit({ key })).success;
  } catch {
    return true;
  }
}

/** Fire a free Analytics Engine data point (no-op locally). */
export async function metric(blobs: string[]): Promise<void> {
  const env = await cfEnv();
  const ae = env?.GAME_METRICS as AnalyticsEngine | undefined;
  try {
    ae?.writeDataPoint({ blobs, doubles: [1], indexes: [blobs[0]] });
  } catch {
    /* metrics never break requests */
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const budgetKey = () => `budget|${today()}`;
const ipKey = (ip: string) => `ipday|${today()}|${ip}`;

/** Are the global or per-IP daily upstream budgets exhausted? (coarse KV counters) */
export async function budgetExhausted(ip: string): Promise<"global" | "ip" | null> {
  const kv = await judgeKV();
  if (!kv) return null;
  try {
    const [g, i] = await Promise.all([kv.get(budgetKey()), kv.get(ipKey(ip))]);
    if (g !== null && parseInt(g, 10) >= LIMITS.DAILY_UPSTREAM_CAP) return "global";
    if (i !== null && parseInt(i, 10) >= LIMITS.IP_DAILY_CAP) return "ip";
    return null;
  } catch {
    return null;
  }
}

/** Count one paid upstream call against both budgets (racy but coarse — fine). */
export async function budgetSpend(ip: string): Promise<void> {
  const kv = await judgeKV();
  if (!kv) return;
  try {
    const [g, i] = await Promise.all([kv.get(budgetKey()), kv.get(ipKey(ip))]);
    await Promise.all([
      kv.put(budgetKey(), String((g ? parseInt(g, 10) : 0) + 1), { expirationTtl: 60 * 60 * 48 }),
      kv.put(ipKey(ip), String((i ? parseInt(i, 10) : 0) + 1), { expirationTtl: 60 * 60 * 48 }),
    ]);
  } catch {
    /* never block a response on accounting */
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}
