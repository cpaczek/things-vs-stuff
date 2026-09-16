// The TypeSafe proxy. One POST = one speculative fan-out call that returns a
// tower concept's complete stat block against every enemy type in today's waves.
// The API key stays server-side; responses are cached per (day, concept, enemy set).

import { NextRequest, NextResponse } from "next/server";
import {
  evaluate,
  type Question,
  type NoulAnswer,
  type ChoiceAnswer,
} from "@/lib/typesafe";
import {
  TOWER_QUESTIONS,
  METHODS,
  ICON_CHOICES,
  POLICE_QUESTIONS,
  iconQuestion,
  effQuestion,
  feedsQuestion,
  methodQuestion,
} from "@/lib/questions";
import type { JudgeResponse, StatBlock } from "@/game/types";
import {
  checkLimit,
  metric,
  budgetExhausted,
  budgetSpend,
  clientIp,
  judgeKV,
} from "@/lib/cf";

export const runtime = "nodejs";

// --- L1: tiny in-memory cache (per server instance / worker isolate) ----------
const cache = new Map<string, JudgeResponse>();
const CACHE_MAX = 1000;

// --- L2: Cloudflare KV — every player shares one verdict per concept per day --
const KV_TTL_S = 60 * 60 * 48; // judgments only matter for the day; keep 48h

async function kvGet(key: string): Promise<JudgeResponse | null> {
  const kv = await judgeKV();
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as JudgeResponse) : null;
  } catch {
    return null;
  }
}

async function kvPut(key: string, value: JudgeResponse): Promise<void> {
  // awaited: on Workers, floating promises are cancelled when the response
  // returns, so a fire-and-forget write would silently never land in KV
  try {
    const kv = await judgeKV();
    await kv?.put(key, JSON.stringify(value), { expirationTtl: KV_TTL_S });
  } catch {
    /* cache write failures never block a response */
  }
}

// --- local-dev backstop limiter (production uses the RL_* bindings) ----------
const buckets = new Map<string, { tokens: number; last: number }>();
const RATE_PER_MIN = 300;

function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_PER_MIN, last: now };
  b.tokens = Math.min(RATE_PER_MIN, b.tokens + ((now - b.last) / 60000) * RATE_PER_MIN);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

// --- request shape ------------------------------------------------------------
type JudgeBody = {
  /** The tower concept being judged, e.g. "a fusion of a campfire and a tornado". */
  doc: string;
  /** Today's enemy types to fan out against. */
  enemies: { id: string; doc: string }[];
  /** Cache namespace — the daily seed. */
  daySeed: string;
  /** Also ask the judge to pick an icon (for player-invented things). */
  wantIcon?: boolean;
  /** Also screen for munchkin submissions (omnipotent/vague inventions). */
  police?: boolean;
};

const ID_RE = /^[a-z0-9_-]{1,40}$/i;

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!allow(ip) || !(await checkLimit("RL_LOOSE", ip))) {
    await metric(["judge", "limited_loose"]);
    return NextResponse.json({ error: "slow down!" }, { status: 429 });
  }

  let body: JudgeBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const { enemies, daySeed, wantIcon, police } = body;
  const doc =
    typeof body.doc === "string"
      ? // eslint-disable-next-line no-control-regex
        body.doc.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      : "";
  if (doc.length < 2 || doc.length > 240)
    return badRequest("doc must be a 2-240 char string");
  if (!Array.isArray(enemies) || enemies.length < 1 || enemies.length > 8)
    return badRequest("enemies must be 1-8 entries");
  if (typeof daySeed !== "string" || daySeed.length > 20)
    return badRequest("daySeed required");
  for (const e of enemies) {
    if (!ID_RE.test(e?.id ?? "")) return badRequest("bad enemy id");
    if (typeof e.doc !== "string" || e.doc.length < 2 || e.doc.length > 160)
      return badRequest("bad enemy doc");
  }

  const key = `${daySeed}|${doc.toLowerCase().trim()}|${enemies
    .map((e) => e.id)
    .sort()
    .join(",")}|${wantIcon ? "i" : ""}${police ? "p" : ""}`;

  const hit = cache.get(key);
  if (hit) {
    await metric(["judge", "hit_memory"]);
    return NextResponse.json({ ...hit, cached: true });
  }

  const kvHit = await kvGet(key);
  if (kvHit) {
    cache.set(key, kvHit);
    await metric(["judge", "hit_kv"]);
    return NextResponse.json({ ...kvHit, cached: true });
  }

  // --- this request would hit the PAID upstream — strict gates apply ---------
  if (!(await checkLimit("RL_STRICT", ip))) {
    await metric(["judge", "limited_strict"]);
    return NextResponse.json(
      { error: "the judge needs a breather — try again in a minute" },
      { status: 429 }
    );
  }
  const exhausted = await budgetExhausted(ip);
  if (exhausted) {
    await metric(["judge", `budget_${exhausted}`]);
    return NextResponse.json(
      {
        error:
          exhausted === "ip"
            ? "you've worn the judge out for today — come back tomorrow"
            : "the judge is resting today — come back tomorrow",
      },
      { status: exhausted === "ip" ? 429 : 503 }
    );
  }

  // --- build the speculative fan-out: every question, one round trip ---------
  const questions: Record<string, Question> = {};
  for (const [id, instructions] of Object.entries(TOWER_QUESTIONS)) {
    questions[id] = { type: "noul", instructions };
  }
  for (const e of enemies) {
    questions[`eff_${e.id}`] = { type: "noul", instructions: effQuestion(e.doc) };
    questions[`feeds_${e.id}`] = { type: "noul", instructions: feedsQuestion(e.doc) };
    questions[`method_${e.id}`] = {
      type: "choice",
      instructions: methodQuestion(e.doc),
      criteria: METHODS,
    };
  }
  if (wantIcon) {
    questions["icon"] = { type: "choice", instructions: iconQuestion, criteria: ICON_CHOICES };
  }
  if (police) {
    for (const [id, q] of Object.entries(POLICE_QUESTIONS)) {
      questions[`police_${id}`] = {
        type: "noul",
        instructions: q.instructions,
        criteria: q.criteria,
      };
    }
  }

  let result;
  try {
    result = await evaluate(`A defense: ${doc}`, questions);
  } catch (err) {
    console.error("[judge] TypeSafe call failed:", err);
    return NextResponse.json({ error: "judgment failed" }, { status: 502 });
  }

  const noul = (id: string) => (result.answers[id] as NoulAnswer)?.noul ?? 0;

  const stats: StatBlock = {
    perEnemy: {},
    slows: noul("slows"),
    splash: noul("splash"),
    reach: noul("reach"),
    rapid: noul("rapid"),
    wild: noul("wild"),
  };
  for (const e of enemies) {
    const method = result.answers[`method_${e.id}`] as ChoiceAnswer;
    stats.perEnemy[e.id] = {
      eff: noul(`eff_${e.id}`),
      feeds: noul(`feeds_${e.id}`),
      method: method?.choice ?? "none",
      methodP: method ? method.probabilities[method.choice] ?? 0 : 0,
      pNone: method ? method.probabilities["none"] ?? 1 : 1,
    };
  }

  const response: JudgeResponse = {
    stats,
    icon: wantIcon ? (result.answers["icon"] as ChoiceAnswer)?.choice : undefined,
    police: police
      ? { absurd: noul("police_absurd"), vague: noul("police_vague") }
      : undefined,
    usage: result.usage,
    latencyMs: result.latencyMs,
    cached: false,
    // Full trace for the Dev Mode decision-trace panel.
    trace: {
      document: `A defense: ${doc}`,
      questions,
      answers: result.answers,
    },
  };

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, response);
  await kvPut(key, response);
  await budgetSpend(ip);
  await metric(["judge", "upstream"]);

  return NextResponse.json(response);
}
