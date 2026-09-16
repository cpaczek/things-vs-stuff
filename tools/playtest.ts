// Headless playtest harness: runs the REAL Engine against the REAL judge API
// (via the dev server) with a scripted strategy, then prints a balance report.
//
//   npx tsx tools/playtest.ts --info [--seed 2026-07-20]
//   npx tsx tools/playtest.ts --strategy strat.json [--seed ...]
//
// Strategy JSON:
// {
//   "actions": [
//     { "beforeWave": 1, "type": "invent", "text": "a pair of giant scissors", "as": "scissors" },
//     { "beforeWave": 1, "type": "place", "tower": "scissors", "x": 250, "y": 210, "as": "s1" },
//     { "beforeWave": 3, "type": "fuse", "into": "s1", "from": "f1", "as": "combo" },
//     { "beforeWave": 5, "type": "sell", "name": "combo" }
//   ]
// }
// "beforeWave": N runs the action before wave N starts (1 = during prep).
// There are NO preset towers: every "tower" id must come from an earlier "invent"
// action's "as". Names ("as") let later actions reference placed towers.

import { readFileSync } from "node:fs";
import { Engine, ECONOMY } from "../game/engine";
import { getDailyConfig, todaySeed } from "../lib/daily";
import {
  damagePerShot,
  feedsHealFor,
  rangeFor,
  fireRateFor,
  splashRadiusFor,
  slowFactorFor,
  misfireChanceFor,
  priceFor,
  POLICE,
} from "../lib/questions";
import type { Concept, StatBlock, JudgeResponse } from "../game/types";

const API = process.env.JUDGE_URL ?? "http://localhost:1337/api/judge";

type Action =
  | { beforeWave: number; type: "place"; tower: string; x: number; y: number; as?: string }
  | { beforeWave: number; type: "fuse"; into: string; from: string; as?: string }
  | { beforeWave: number; type: "sell"; name: string }
  /** Invent a concept (goes through the same police screening as the real client);
   * on success it becomes placeable via its "as" id. */
  | { beforeWave: number; type: "invent"; text: string; as: string };

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = arg("--seed") ?? todaySeed();
const config = getDailyConfig(seed);

async function judge(concept: Concept, police = false): Promise<JudgeResponse> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      doc: concept.doc,
      daySeed: seed,
      police,
      enemies: config.enemies.map((e) => ({ id: e.id, doc: e.doc })),
    }),
  });
  if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text()}`);
  return (await res.json()) as JudgeResponse;
}

function statLine(stats: StatBlock): string {
  const per = config.enemies
    .map((e) => {
      const m = stats.perEnemy[e.id];
      if (!m) return `${e.id}:?`;
      if (feedsHealFor(m.feeds) > 0) return `${e.id}:FEEDS!`;
      return `${e.id}:${m.method}/${damagePerShot(m.eff, m.pNone)}dmg`;
    })
    .join("  ");
  const traits = [
    `range ${Math.round(rangeFor(stats.reach))}`,
    `${fireRateFor(stats.rapid).toFixed(1)}/s`,
    splashRadiusFor(stats.splash) > 0 ? "SPLASH" : "",
    slowFactorFor(stats.slows) > 0 ? "SLOWS" : "",
    misfireChanceFor(stats.wild) > 0
      ? `WILD ${Math.round(misfireChanceFor(stats.wild) * 100)}%`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${per}\n      [${traits}]`;
}

/** Suggested placement spots: valid points ranked by how much path they cover. */
function suggestSpots(): { x: number; y: number; coverage: number }[] {
  const engine = new Engine(config);
  const pathSamples: { x: number; y: number }[] = [];
  for (let i = 0; i < engine.paths.length; i++) {
    for (let d = 0; d < engine.paths[i].len; d += 25) pathSamples.push(engine.pathPos(d, i));
  }
  const spots: { x: number; y: number; coverage: number }[] = [];
  for (let x = 60; x < 920; x += 30) {
    for (let y = 60; y < 520; y += 30) {
      if (!engine.canPlaceAt({ x, y })) continue;
      const coverage = pathSamples.filter((p) => Math.hypot(p.x - x, p.y - y) <= 130).length;
      spots.push({ x, y, coverage });
    }
  }
  spots.sort((a, b) => b.coverage - a.coverage);
  // de-cluster
  const picked: typeof spots = [];
  for (const s of spots) {
    if (picked.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > 70)) picked.push(s);
    if (picked.length >= 14) break;
  }
  return picked;
}

if (process.argv.includes("--info")) {
  console.log(`=== THINGS vs STUFF · seed ${seed} · day #${config.dayNumber} ===\n`);
  console.log(`TOWERS: none dealt — invent them (hand holds ${ECONOMY.HAND_SIZE}).`);
  console.log("\nENEMIES:");
  for (const e of config.enemies)
    console.log(
      `  ${e.id.padEnd(16)} ${e.emoji} ${e.name}${e.boss ? " [BOSS]" : ""} — hp ${e.baseHp}, speed ${e.speed}, bounty ${e.bounty}`
    );
  console.log("\nWAVES:");
  config.waves.forEach((w, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)}: ` +
        w.map((g) => `${g.enemyId} x${g.count} (hp×${g.hpScale})`).join(" + ")
    )
  );
  console.log(`\nECONOMY: start ⚡${ECONOMY.START_ENERGY}, tower prices judged per-concept, fuse ${ECONOMY.FUSE_COST}, lives ${ECONOMY.START_LIVES}`);
  console.log("\nSUGGESTED SPOTS (x,y — ranked by path coverage):");
  for (const s of suggestSpots()) console.log(`  (${s.x}, ${s.y}) covers ${s.coverage}`);
  process.exit(0);
}

const stratPath = arg("--strategy");
if (!stratPath) {
  console.error("need --info or --strategy <file.json>");
  process.exit(1);
}
const strategy: { actions: Action[] } = JSON.parse(readFileSync(stratPath, "utf8"));

const engine = new Engine(config);
const customs = new Map<string, Concept>(); // invented concepts by id
const named = new Map<string, number>(); // name -> tower uid
const towerLabel = new Map<number, string>();
const warnings: string[] = [];
const waveLog: { wave: number; leaks: number; clearedAt: number }[] = [];
let leaksThisWave = 0;
let waveStartTime = 0;

async function runActions(beforeWave: number) {
  for (const a of strategy.actions.filter((x) => x.beforeWave === beforeWave)) {
    if (a.type === "place") {
      const concept = customs.get(a.tower);
      if (!concept) {
        warnings.push(`place: unknown tower id "${a.tower}" (invent it first with an "invent" action)`);
        continue;
      }
      // cards are pre-judged and judge-priced, mirroring the real client
      const stats = (await judge(concept)).stats;
      const price = priceFor(stats);
      const t = engine.placeTower(concept, [concept], { x: a.x, y: a.y }, price);
      if (!t) {
        warnings.push(
          `place ${a.tower} (⚡${price}) at (${a.x},${a.y}) FAILED — energy ${engine.energy} or invalid spot (distToPath=${Math.round(engine.distToPath({ x: a.x, y: a.y }))}, needs >42)`
        );
        continue;
      }
      engine.setTowerStats(t.uid, stats);
      if (a.as) named.set(a.as, t.uid);
      towerLabel.set(t.uid, a.as ?? a.tower);
      console.log(`▶ before wave ${beforeWave}: placed ${a.tower} (⚡${price}) at (${a.x},${a.y}) as "${a.as ?? a.tower}" — ⚡${engine.energy} left`);
      console.log(`      ${statLine(t.stats!)}`);
    } else if (a.type === "fuse") {
      const intoUid = named.get(a.into);
      const fromUid = named.get(a.from);
      if (intoUid === undefined || fromUid === undefined) {
        warnings.push(`fuse: unknown names ${a.into}/${a.from}`);
        continue;
      }
      const fused = engine.fuseTowers(intoUid, fromUid);
      if (!fused) {
        warnings.push(`fuse ${a.from}→${a.into} FAILED (energy ${engine.energy} or >3 components)`);
        continue;
      }
      engine.setTowerStats(fused.uid, (await judge(fused.concept)).stats);
      if (a.as) named.set(a.as, fused.uid);
      towerLabel.set(fused.uid, a.as ?? fused.concept.name);
      console.log(`▶ before wave ${beforeWave}: FUSED "${fused.concept.name}" ("${fused.concept.doc}") ⚡${engine.energy}`);
      console.log(`      ${statLine(fused.stats!)}`);
    } else if (a.type === "invent") {
      if (customs.size >= ECONOMY.HAND_SIZE) {
        warnings.push(`invent "${a.text}" skipped — hand is full (${ECONOMY.HAND_SIZE})`);
        continue;
      }
      const concept: Concept = { id: a.as, name: a.text.slice(0, 26), emoji: "✏️", doc: a.text.slice(0, 60) };
      const res = await judge(concept, true);
      const pol = res.police;
      if (pol && (pol.absurd > POLICE.ABSURD_MAX || pol.vague > POLICE.VAGUE_MAX)) {
        warnings.push(
          `invent "${a.text}" OVERRULED (absurd=${pol.absurd.toFixed(2)}, vague=${pol.vague.toFixed(2)})`
        );
        continue;
      }
      customs.set(a.as, concept);
      console.log(
        `▶ before wave ${beforeWave}: invented "${a.text}" as "${a.as}" (⚡${priceFor(res.stats)})` +
          (pol ? ` [absurd=${pol.absurd.toFixed(2)} vague=${pol.vague.toFixed(2)}]` : "")
      );
      console.log(`      ${statLine(res.stats)}`);
    } else if (a.type === "sell") {
      const uid = named.get(a.name);
      if (uid === undefined) {
        warnings.push(`sell: unknown name ${a.name}`);
        continue;
      }
      engine.sellTower(uid);
      console.log(`▶ before wave ${beforeWave}: sold ${a.name} ⚡${engine.energy}`);
    }
  }
}

async function main() {
  await runActions(1);
  engine.startCombat();

  const DT = 0.05;
  let simTime = 0;
  let nextActionsWave = 2;

  while (engine.phase !== "won" && engine.phase !== "lost" && simTime < 3600) {
    engine.update(DT);
    simTime += DT;
    for (const ev of engine.drainEvents()) {
      if (ev.type === "leak") leaksThisWave += ev.livesLost;
      if (ev.type === "wave_start") {
        waveStartTime = simTime;
        leaksThisWave = 0;
      }
    }
    if (engine.phase === "break") {
      const justCleared = engine.wavesCleared;
      if (!waveLog.some((w) => w.wave === justCleared)) {
        waveLog.push({ wave: justCleared, leaks: leaksThisWave, clearedAt: simTime - waveStartTime });
      }
      if (nextActionsWave === justCleared + 1) {
        await runActions(nextActionsWave);
        nextActionsWave++;
      }
    }
  }
  if (engine.phase === "won" || engine.phase === "lost") {
    waveLog.push({
      wave: engine.wavesCleared,
      leaks: leaksThisWave,
      clearedAt: simTime - waveStartTime,
    });
  }

  console.log("\n=== RESULT ===");
  console.log(`${engine.phase.toUpperCase()} — waves cleared ${engine.wavesCleared}/${config.waves.length}, lives ${engine.lives}/${ECONOMY.START_LIVES}, score ${engine.score()}, energy left ⚡${engine.energy}, sim ${Math.round(simTime)}s`);
  console.log("\nWAVES:");
  for (const w of waveLog)
    console.log(`  wave ${String(w.wave).padStart(2)}: cleared in ${w.clearedAt.toFixed(0)}s, leaked ${w.leaks}`);
  console.log("\nKILLS BY TOWER:");
  for (const t of engine.towers)
    console.log(`  ${(towerLabel.get(t.uid) ?? t.concept.name).padEnd(20)} ${t.kills} kills`);
  if (warnings.length) {
    console.log("\n⚠️ WARNINGS:");
    for (const w of warnings) console.log("  " + w);
  }
}

main().catch((e) => {
  console.error("PLAYTEST CRASHED:", e);
  process.exit(1);
});
