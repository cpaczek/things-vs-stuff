// One tiny judgment per day: which biome does today's invasion march through?
// Cached in memory + KV like judgments — one global call per seed.

import { NextRequest, NextResponse } from "next/server";
import { evaluate, type ChoiceAnswer } from "@/lib/typesafe";
import { BIOME_QUESTION, BIOMES, DEFAULT_BIOME } from "@/lib/biomes";
import { checkLimit, metric, clientIp } from "@/lib/cf";

export const runtime = "nodejs";

const cache = new Map<string, string>();

type KVNamespaceLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
};

async function kv(): Promise<KVNamespaceLike | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    return ((getCloudflareContext().env as Record<string, unknown>)
      .JUDGE_CACHE as KVNamespaceLike) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkLimit("RL_LOOSE", clientIp(req)))) {
    return NextResponse.json({ error: "slow down!" }, { status: 429 });
  }
  let body: { daySeed?: string; enemies?: { doc: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const daySeed = body.daySeed;
  const enemies = body.enemies;
  if (typeof daySeed !== "string" || daySeed.length > 20 || !Array.isArray(enemies) || enemies.length < 1 || enemies.length > 8) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const key = `theme|${daySeed}`;
  const mem = cache.get(key);
  if (mem) return NextResponse.json({ biome: mem, cached: true });

  const store = await kv();
  const stored = store ? await store.get(key).catch(() => null) : null;
  if (stored) {
    cache.set(key, stored);
    return NextResponse.json({ biome: stored, cached: true });
  }

  try {
    const result = await evaluate(
      `The invaders: ${enemies.map((e) => String(e.doc).slice(0, 160)).join("; ")}`,
      {
        biome: {
          type: "choice",
          instructions: BIOME_QUESTION.instructions,
          criteria: BIOME_QUESTION.criteria,
        },
      }
    );
    const choice = (result.answers["biome"] as ChoiceAnswer)?.choice;
    const biome = choice && BIOMES[choice] ? choice : DEFAULT_BIOME;
    cache.set(key, biome);
    await store?.put(key, biome, { expirationTtl: 60 * 60 * 48 }).catch(() => {});
    await metric(["theme", "upstream"]);
    return NextResponse.json({ biome, cached: false });
  } catch {
    return NextResponse.json({ biome: DEFAULT_BIOME, cached: false });
  }
}
