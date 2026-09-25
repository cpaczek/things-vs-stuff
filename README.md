# 🗼 THINGS vs STUFF

https://things.iar.dev

<img width="1621" height="1177" alt="image" src="https://github.com/user-attachments/assets/04d07947-9698-41bb-92aa-b1aa3d80a345" />


A daily doodle tower-defense where **anything can fight anything** — because no damage
table exists, and no tower list either. You **type** every THING you fight with, and every
tower-vs-enemy matchup is decided live by the [TypeSafe](https://typesafe.ai) judgment API
(~200ms per full verdict), the first time the two concepts ever meet. Opera singers shatter
glass golems. Rain clouds accidentally water the plant monsters. A blizzard heals the Giant
Snowman (of course it does).

- **Invent everything** — the hand starts empty. ✏️ INVENT anything (up to 8 per run); the
  judge picks an icon, prices it, and shows how it fares against today's STUFF before you buy.
- **Daily board** — same waves of STUFF and same map for everyone, seeded by the date.
- **Fusion** — drag one tower onto another and pick *how* they combine ("Woodchipper riding
  Thundercloud" ≠ "Thundercloud made of Woodchipper"); the result is judged from scratch,
  emergent flaws included (`wild 0.78` = it misfires).
- **Free play** — 🎲 endless random boards, no waiting for midnight.
- **Dev mode** — `</>` toggles the Decision Trace: every question, probability bar, and
  distribution behind each verdict, plus latency/token counters.

## Run it

```bash
echo 'TYPESAFE_API_KEY=<your key>' > .env.local
npm install
npm run dev        # http://localhost:1337
```

## How it works

One request per concept: `POST /api/judge` fans out ~17 speculative questions in a single
TypeSafe call (effectiveness/backfire/method per enemy + splash/slows/reach/rapid/wild)
and returns a complete stat block. The client caches per (day, concept); the route caches
and rate-limits server-side. The API key never reaches the browser.

| Piece | Where |
|---|---|
| **Audit surface** — every question string, threshold, judged-value→stat mapping, fusion grammars | `lib/questions.ts` |
| TypeSafe client (server-only) | `lib/typesafe.ts` |
| Judge route: fan-out builder, cache, rate limit | `app/api/judge/route.ts` |
| Enemy pool (nouns + emoji, no stats beyond pacing — there is no tower pool) | `lib/pools.ts` |
| Seeded daily config | `lib/daily.ts` |
| Engine (pure logic, judged methods are real mechanics: burn DoT, zap chain, repel knockback, freeze chill) | `game/engine.ts` |
| Canvas doodle renderer (boiling linework, OpenMoji, VFX per judged method) | `game/render.ts` |

## Deploy (Cloudflare Workers → things.iar.dev)

Built with the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare); config in
`wrangler.jsonc` (custom domain route + KV binding). One-time setup:

```bash
npx wrangler login                                # opens browser auth
npx wrangler kv namespace create JUDGE_CACHE      # paste the id into wrangler.jsonc
npx wrangler secret put TYPESAFE_API_KEY          # paste the key when prompted
npm run deploy                                    # build + deploy to things.iar.dev
```

`npm run preview` runs the actual Worker build locally. `.dev.vars` holds the key for
that; `.env.local` covers `next dev`.

**Abuse protection** (all tunable in `lib/cf.ts` / `wrangler.jsonc`): per-IP rate
bindings (120 req/min loose on all API routes; 15/min strict on cache-missing calls —
approximate by design), a **KV per-IP daily cap** (250 uncached judgments/day — the
connection-spray-proof limit), and a **global daily budget** (5,000 upstream calls/day,
`503` when exhausted). Cache hits are never throttled by the caps. `/api/event` accepts
only an enum. Optional extra: add the free WAF rate-limiting rule on `/api/*` in the
dashboard for edge-level blocking.

**Analytics (free):** Workers observability is enabled (`wrangler.jsonc`). Custom game
metrics via Analytics Engine are wired (`lib/cf.ts metric()`, `/api/event` beacons for
run_start/win/loss/invent/fusion) — enable AE once in the dashboard, uncomment the
`analytics_engine_datasets` block, and redeploy. For page analytics, enable Cloudflare
Web Analytics on the zone (2 clicks, auto-injected beacon).

**Caching:** three layers keep TypeSafe spend near zero — client Map (per session),
in-memory LRU (per worker isolate), and **Workers KV** keyed
`(day | concept | enemy-set)` with 48h TTL, so every player worldwide shares a single
judgment per concept per day. Only genuinely new inventions and fusions hit the API.

## Headless playtest harness

```bash
npx tsx tools/playtest.ts --info                 # today's enemies/waves + good spots
npx tsx tools/playtest.ts --strategy strat.json  # simulate a full game vs the real judge
```

Strategy files script inventions/placements/fusions/sells per wave — used for balance
tuning (dev server must be running). Every placed tower must be invented first.

## Credits

Icon art by [OpenMoji](https://openmoji.org) — CC BY-SA 4.0 (fetched by
`tools/fetch-openmoji.mjs` into `public/openmoji/`).
