// Deterministic daily config: the local date string seeds a PRNG that picks
// today's enemies, wave schedule and map. Same date → same puzzle for everyone.
// There are no preset towers — every THING is invented by the player.

import type { DailyConfig, Decoration, EnemySpec, WaveSpec } from "../game/types";
import { ENEMY_POOL } from "./pools";
import { BOARD_W, BOARD_H, distToPolyline, type Vec } from "../game/engine";


/** Constructive serpentine + optional merging branch: guaranteed valid &
 * readable (no crossings, real build pockets), endlessly varied via lane
 * count/positions/turn jitter/entry side — and ~45% of maps are pincer maps
 * where a second route merges into lane two from the opposite edge. */
function generatePaths(rand: () => number): Vec[][] {
  const lanes = rand() < 0.35 ? 4 : 3;
  const top = lanes === 4 ? 72 + Math.round(rand() * 18) : 82 + Math.round(rand() * 38);
  const bottom = lanes === 4 ? 452 + Math.round(rand() * 26) : 415 + Math.round(rand() * 45);
  const ys: number[] = [];
  for (let i = 0; i < lanes; i++) {
    const t = i / (lanes - 1);
    const jitter = i > 0 && i < lanes - 1 ? (rand() - 0.5) * (lanes === 4 ? 26 : 46) : 0;
    ys.push(Math.round(top + (bottom - top) * t + jitter));
  }

  const firstRight = rand() < 0.5;
  let dirRight = firstRight;
  const main: Vec[] = [{ x: dirRight ? -40 : BOARD_W + 40, y: ys[0] }];
  let x = 0;
  for (let i = 0; i < lanes; i++) {
    x = dirRight ? 690 + Math.round(rand() * 170) : 100 + Math.round(rand() * 170);
    main.push({ x, y: ys[i] });
    if (i < lanes - 1) main.push({ x, y: ys[i + 1] });
    dirRight = !dirRight;
  }
  main.push({ x, y: BOARD_H + 50 }); // exit off the bottom, home sits here

  const paths: Vec[][] = [main];
  if (rand() < 0.45) {
    // branch: a side road merging where the LAST lane begins — branch enemies
    // skip most of the gauntlet, so ignoring the second front is deadly.
    const joinIdx = main.length - 3;
    const junction = main[joinIdx];
    const stubEntry: Vec = { x: junction.x < BOARD_W / 2 ? -40 : BOARD_W + 40, y: junction.y };
    paths.push([stubEntry, ...main.slice(joinIdx)]);
  }
  return paths;
}

function generateDecorations(rand: () => number, paths: Vec[][]): Decoration[] {
  const out: Decoration[] = [];
  const target = 10 + Math.floor(rand() * 6);
  let tries = 0;
  while (out.length < target && tries++ < 240) {
    const x = 45 + rand() * (BOARD_W - 90);
    const y = 45 + rand() * (BOARD_H - 110);
    if (paths.some((p) => distToPolyline({ x, y }, p) < 62)) continue;
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < 74)) continue;
    out.push({
      x: Math.round(x),
      y: Math.round(y),
      slot: Math.floor(rand() * 6),
      s: Math.round(20 + rand() * 16),
    });
  }
  return out;
}

const LAUNCH_EPOCH_UTC = Date.UTC(2026, 6, 20); // day #1 = 2026-07-20

/** mulberry32 — tiny seeded PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Local date as YYYY-MM-DD — the daily seed. */
export function todaySeed(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDailyConfig(seed: string): DailyConfig {
  const rand = mulberry32(hashString(seed));

  const normals = shuffled(ENEMY_POOL.filter((e) => !e.boss), rand).slice(0, 3);
  const boss = shuffled(ENEMY_POOL.filter((e) => e.boss), rand)[0];
  const enemies: EnemySpec[] = [...normals, boss];

  const [e1, e2, e3] = normals.map((e) => e.id);
  const g = (
    enemyId: string,
    count: number,
    hpScale: number,
    spacing = 1.1
  ): WaveSpec => ({ enemyId, count, hpScale, spacing });

  // 10 waves: introduce each enemy solo, then mix, then rush, then the boss.
  const waves: WaveSpec[][] = [
    [g(e1, 5, 1.0, 1.4)],
    [g(e1, 7, 1.0, 1.1)],
    [g(e2, 6, 1.0, 1.3)],
    [g(e1, 6, 1.15, 1.0), g(e2, 4, 1.15, 1.6)],
    [g(e3, 6, 1.0, 1.3)],
    [g(e2, 6, 1.35, 1.1), g(e3, 5, 1.35, 1.4)],
    [g(e1, 12, 1.9, 0.65)], // rush!
    [g(e2, 7, 2.1, 1.0), g(e3, 6, 2.1, 1.2)],
    [g(e1, 8, 2.4, 0.8), g(e2, 8, 2.4, 1.0)],
    [g(boss.id, 1, 1.0, 0), g(e1, 6, 1.8, 1.6)],
  ];

  const dayNumber =
    Math.floor((Date.parse(seed + "T00:00:00Z") - LAUNCH_EPOCH_UTC) / 86400000) + 1;

  const paths = generatePaths(rand);
  const decorations = generateDecorations(rand, paths);
  const branchShare = 0.3 + rand() * 0.2;

  return { seed, dayNumber, enemies, waves, paths, branchShare, decorations };
}
