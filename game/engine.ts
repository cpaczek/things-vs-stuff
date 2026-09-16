// Pure game logic: fixed-timestep tower defense. No DOM, no fetch — the caller
// feeds judged stat blocks in via setTowerStats() and drains events for VFX.

import type { Concept, DailyConfig, EnemySpec, StatBlock } from "./types";
import {
  damagePerShot,
  rangeFor,
  fireRateFor,
  splashRadiusFor,
  slowFactorFor,
  misfireChanceFor,
  feedsHealFor,
  STATS,
} from "../lib/questions";

export const BOARD_W = 960;
export const BOARD_H = 560;

export const ECONOMY = {
  START_ENERGY: 100,
  START_LIVES: 10,
  /** Cards are priced individually by the judge (lib/questions.ts priceFor). */
  FUSE_COST: 15,
  /** Hand capacity. Nothing is dealt — every card is player-invented. */
  HAND_SIZE: 8,
  WAVE_BREAK_S: 2.5,
  /** Energy bonus for calling the next wave early: base + per-wave. */
  RUSH_BONUS_BASE: 5,
  RUSH_BONUS_PER_WAVE: 1,
} as const;

export type Vec = { x: number; y: number };

/** Distance from a point to the nearest spot on a polyline. */
export function distToPolyline(p: Vec, pts: Vec[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby))
    );
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
  }
  return best;
}

// ---------------------------------------------------------------------------

export type TowerEntity = {
  uid: number;
  concept: Concept;
  /** 1–3 base concepts; >1 means a fusion. */
  components: Concept[];
  x: number;
  y: number;
  stats: StatBlock | null; // null while the judgment round-trip is in flight
  cooldown: number;
  /** Seconds of "just judged" flash left, for the reveal animation. */
  revealFlash: number;
  kills: number;
  /** Energy paid for it (judged price) — sells refund a fraction of this. */
  paid: number;
};

export type EnemyEntity = {
  uid: number;
  spec: EnemySpec;
  hp: number;
  maxHp: number;
  dist: number;
  slowTimer: number;
  slowFactor: number;
  /** Which route this enemy marches (0 = main, 1 = branch). */
  pathIdx: number;
  /** Burn damage-over-time (method: burn). */
  burnTimer: number;
  burnDps: number;
  /** For kill credit + death VFX when a DoT finishes something off. */
  lastHitBy: number | null;
  lastMethod: string;
};

type PendingSpawn = { enemyId: string; hpScale: number; at: number };

export type GameEvent =
  | {
      type: "shot";
      towerUid: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      method: string;
      damage: number;
      misfire: boolean;
      feeds: boolean;
      splash: number;
    }
  | { type: "death"; x: number; y: number; method: string; bounty: number; emoji: string }
  | { type: "leak"; livesLost: number }
  | { type: "wave_start"; wave: number; enemyIds: string[]; label: string; boss: boolean }
  | { type: "victory" }
  | { type: "defeat" };

export type Phase = "prep" | "combat" | "break" | "won" | "lost";

export class Engine {
  config: DailyConfig;
  towers: TowerEntity[] = [];
  enemies: EnemyEntity[] = [];
  events: GameEvent[] = [];

  lives: number = ECONOMY.START_LIVES;
  energy: number = ECONOMY.START_ENERGY;
  phase: Phase = "prep";
  waveIndex = -1; // last started wave
  wavesCleared = 0;
  fusionsMade = 0;
  breakTimer = 0;
  time = 0;

  /** Enemy ids the player has SEEN spawn — new ids trigger the flash-judge moment. */
  seenEnemyIds = new Set<string>();

  private uidCounter = 1;
  private pendingSpawns: PendingSpawn[] = [];
  private enemyById: Map<string, EnemySpec>;

  // per-map routes (generated with the daily config); a map has 1 or 2
  readonly paths: { pts: Vec[]; segLens: number[]; len: number }[];

  constructor(config: DailyConfig) {
    this.config = config;
    this.enemyById = new Map(config.enemies.map((e) => [e.id, e]));
    this.paths = config.paths.map((pts) => {
      const segLens: number[] = [];
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        segLens.push(l);
        len += l;
      }
      return { pts, segLens, len };
    });
  }

  pathPos(dist: number, idx = 0): Vec & { angle: number } {
    const path = this.paths[idx] ?? this.paths[0];
    let d = Math.max(0, Math.min(dist, path.len - 0.001));
    for (let i = 0; i < path.segLens.length; i++) {
      if (d <= path.segLens[i]) {
        const a = path.pts[i];
        const b = path.pts[i + 1];
        const t = d / path.segLens[i];
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
        };
      }
      d -= path.segLens[i];
    }
    const last = path.pts[path.pts.length - 1];
    return { x: last.x, y: last.y, angle: 0 };
  }

  distToPath(p: Vec): number {
    return Math.min(...this.paths.map((path) => distToPolyline(p, path.pts)));
  }

  // --- player actions --------------------------------------------------------

  canPlaceAt(p: Vec): boolean {
    if (p.x < 30 || p.x > BOARD_W - 30 || p.y < 30 || p.y > BOARD_H - 30) return false;
    if (this.distToPath(p) < 42) return false;
    return this.towers.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > 48);
  }

  placeTower(concept: Concept, components: Concept[], p: Vec, cost: number): TowerEntity | null {
    if (this.energy < cost || !this.canPlaceAt(p)) return null;
    this.energy -= cost;
    const tower: TowerEntity = {
      uid: this.uidCounter++,
      concept,
      components,
      x: p.x,
      y: p.y,
      stats: null,
      cooldown: 0,
      revealFlash: 0,
      kills: 0,
      paid: cost,
    };
    this.towers.push(tower);
    return tower;
  }

  /** Merge tower b into tower a (at a's spot). Returns the new tower awaiting judgment. */
  fuseTowers(
    aUid: number,
    bUid: number,
    custom?: { name: string; doc: string }
  ): TowerEntity | null {
    const a = this.towers.find((t) => t.uid === aUid);
    const b = this.towers.find((t) => t.uid === bUid);
    if (!a || !b || a === b) return null;
    if (this.energy < ECONOMY.FUSE_COST) return null;
    const components = [...a.components, ...b.components];
    if (components.length > 3) return null;
    this.energy -= ECONOMY.FUSE_COST;
    this.fusionsMade++;

    const names = components.map((c) => c.name);
    const docs = components.map((c) => c.doc);
    const fused: Concept = {
      id: `fusion_${a.uid}_${b.uid}`,
      name: custom?.name ?? names.join(" × "),
      emoji: components.map((c) => c.emoji).join(""),
      doc: custom?.doc ?? `a fusion of ${docs.join(" and ")}`,
    };
    this.towers = this.towers.filter((t) => t !== b);
    a.concept = fused;
    a.components = components;
    a.stats = null; // re-judged as a new thing
    a.revealFlash = 0;
    return a;
  }

  setTowerStats(uid: number, stats: StatBlock) {
    const t = this.towers.find((tw) => tw.uid === uid);
    if (!t) return;
    t.stats = stats;
    t.revealFlash = 1.2;
  }

  sellRefundFor(uid: number): number {
    const t = this.towers.find((tw) => tw.uid === uid);
    return t ? Math.floor(t.paid * 0.6) : 0;
  }

  sellTower(uid: number) {
    const t = this.towers.find((tw) => tw.uid === uid);
    if (!t) return;
    this.energy += this.sellRefundFor(uid);
    this.towers = this.towers.filter((tw) => tw.uid !== uid);
  }

  startCombat() {
    if (this.phase === "prep") this.startWave(0);
  }

  /** Skip the break: start the next wave now for an energy bonus. */
  callNextWave(): number {
    if (this.phase !== "break") return 0;
    const bonus = ECONOMY.RUSH_BONUS_BASE + ECONOMY.RUSH_BONUS_PER_WAVE * (this.waveIndex + 1);
    this.energy += bonus;
    this.breakTimer = 0;
    this.startWave(this.waveIndex + 1);
    return bonus;
  }

  /** What's marching next (for the HUD preview chip). */
  nextWavePreview(): { enemyId: string; count: number }[] | null {
    const idx = this.phase === "prep" ? 0 : this.waveIndex + 1;
    const wave = this.config.waves[idx];
    if (!wave || (this.phase !== "prep" && this.phase !== "break")) return null;
    return wave.map((g) => ({ enemyId: g.enemyId, count: g.count }));
  }

  // --- simulation -------------------------------------------------------------

  private startWave(index: number) {
    this.waveIndex = index;
    this.phase = "combat";
    const wave = this.config.waves[index];
    const ids: string[] = [];
    for (const group of wave) {
      ids.push(group.enemyId);
      for (let i = 0; i < group.count; i++) {
        this.pendingSpawns.push({
          enemyId: group.enemyId,
          hpScale: group.hpScale,
          at: this.time + i * group.spacing,
        });
      }
    }
    const bossSpec = ids.map((id) => this.enemyById.get(id)).find((s) => s?.boss);
    this.events.push({
      type: "wave_start",
      wave: index + 1,
      enemyIds: ids,
      boss: !!bossSpec,
      label: bossSpec
        ? `☠️ ${bossSpec.name.toUpperCase()} APPROACHES!`
        : `wave ${index + 1} of ${this.config.waves.length}`,
    });
  }

  update(dt: number) {
    if (this.phase === "won" || this.phase === "lost") return;
    this.time += dt;

    if (this.phase === "break") {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) this.startWave(this.waveIndex + 1);
    }

    // spawn
    for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
      const s = this.pendingSpawns[i];
      if (s.at <= this.time) {
        this.pendingSpawns.splice(i, 1);
        const spec = this.enemyById.get(s.enemyId)!;
        const hp = Math.round(spec.baseHp * s.hpScale);
        this.enemies.push({
          uid: this.uidCounter++,
          spec,
          hp,
          maxHp: hp,
          dist: 0,
          slowTimer: 0,
          slowFactor: 0,
          pathIdx:
            this.paths.length > 1 && Math.random() < this.config.branchShare ? 1 : 0,
          burnTimer: 0,
          burnDps: 0,
          lastHitBy: null,
          lastMethod: "none",
        });
        this.seenEnemyIds.add(spec.id);
      }
    }

    // move enemies + burn DoT ticks
    for (const e of this.enemies) {
      const slow = e.slowTimer > 0 ? 1 - e.slowFactor : 1;
      e.slowTimer = Math.max(0, e.slowTimer - dt);
      e.dist += e.spec.speed * slow * dt;
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        e.hp -= e.burnDps * dt;
        e.lastMethod = "burn";
      }
    }
    this.sweepDeaths();

    // leaks
    const leaked = this.enemies.filter((e) => e.dist >= this.paths[e.pathIdx].len);
    if (leaked.length) {
      const lost = leaked.reduce((s, e) => s + e.spec.damage, 0);
      this.lives -= lost;
      this.events.push({ type: "leak", livesLost: lost });
      this.enemies = this.enemies.filter((e) => e.dist < this.paths[e.pathIdx].len);
      if (this.lives <= 0) {
        this.lives = 0;
        this.phase = "lost";
        this.events.push({ type: "defeat" });
        return;
      }
    }

    // towers fire
    for (const t of this.towers) {
      t.revealFlash = Math.max(0, t.revealFlash - dt);
      t.cooldown -= dt;
      if (!t.stats || t.cooldown > 0 || this.enemies.length === 0) continue;

      const range = rangeFor(t.stats.reach);
      // prefer the furthest-along enemy we DON'T feed; only heal-targets if
      // nothing else is in range (a tower never willingly waters the plants)
      let target: EnemyEntity | null = null;
      let bestDist = -1;
      let fedTarget: EnemyEntity | null = null;
      let fedBest = -1;
      for (const e of this.enemies) {
        const p = this.pathPos(e.dist, e.pathIdx);
        if (Math.hypot(p.x - t.x, p.y - t.y) > range) continue;
        const m = t.stats.perEnemy[e.spec.id];
        const feeds = m ? feedsHealFor(m.feeds) > 0 : false;
        if (feeds) {
          if (e.dist > fedBest) {
            fedBest = e.dist;
            fedTarget = e;
          }
        } else if (e.dist > bestDist) {
          bestDist = e.dist;
          target = e;
        }
      }
      target = target ?? fedTarget;
      if (!target) continue;

      t.cooldown = 1 / fireRateFor(t.stats.rapid);

      // wild towers sometimes misfire — the shot WHIFFS (a real DPS loss)
      if (Math.random() < misfireChanceFor(t.stats.wild)) {
        const tp = this.pathPos(target.dist, target.pathIdx);
        this.events.push({
          type: "shot",
          towerUid: t.uid,
          fromX: t.x,
          fromY: t.y,
          toX: tp.x + (Math.random() - 0.5) * 90,
          toY: tp.y + (Math.random() - 0.5) * 90,
          method: "none",
          damage: 0,
          misfire: true,
          feeds: false,
          splash: 0,
        });
        continue;
      }

      this.hit(t, target);
    }

    // wave complete?
    if (
      this.phase === "combat" &&
      this.pendingSpawns.length === 0 &&
      this.enemies.length === 0
    ) {
      this.wavesCleared = this.waveIndex + 1;
      if (this.waveIndex + 1 >= this.config.waves.length) {
        this.phase = "won";
        this.events.push({ type: "victory" });
      } else {
        this.phase = "break";
        this.breakTimer = ECONOMY.WAVE_BREAK_S;
      }
    }
  }

  private hit(t: TowerEntity, target: EnemyEntity) {
    const stats = t.stats!;
    const tp = this.pathPos(target.dist, target.pathIdx);
    const matchup = stats.perEnemy[target.spec.id];
    const method = matchup?.method ?? "none";
    const feedsHeal = matchup ? feedsHealFor(matchup.feeds) : 0;
    // fused concepts hit harder per component
    const fusionMult =
      STATS.FUSION_DMG_BONUS[Math.min(t.components.length, STATS.FUSION_DMG_BONUS.length) - 1];
    const dmg = matchup ? Math.round(damagePerShot(matchup.eff, matchup.pNone) * fusionMult) : 1;
    const splashR = splashRadiusFor(stats.splash);
    const slow = slowFactorFor(stats.slows);

    const victims: EnemyEntity[] = splashR
      ? this.enemies.filter((e) => {
          const p = this.pathPos(e.dist, e.pathIdx);
          return Math.hypot(p.x - tp.x, p.y - tp.y) <= splashR;
        })
      : [target];

    for (const v of victims) {
      const m = stats.perEnemy[v.spec.id];
      const heal = m ? feedsHealFor(m.feeds) : 0;
      if (heal > 0) {
        v.hp = Math.min(v.maxHp, v.hp + heal); // backfire: we FEED this enemy
        continue;
      }
      const vDmg = m ? Math.round(damagePerShot(m.eff, m.pNone) * fusionMult) : 1;
      const vMethod = m?.method ?? "none";
      v.hp -= vDmg;
      v.lastHitBy = t.uid;
      v.lastMethod = vMethod;

      // --- the judged METHOD is a real mechanic, not just VFX ------------------
      if (vMethod === "repel" && m) {
        // knockback down the path, scaled by how sure the judge was
        v.dist = Math.max(0, v.dist - STATS.REPEL_KNOCKBACK * m.methodP);
      } else if (vMethod === "burn") {
        v.burnTimer = STATS.BURN_DURATION;
        v.burnDps = Math.max(v.burnDps, vDmg * STATS.BURN_DPS_FRAC);
      } else if (vMethod === "zap") {
        // chain to the nearest other enemy
        const vp = this.pathPos(v.dist, v.pathIdx);
        let chain: EnemyEntity | null = null;
        let best: number = STATS.ZAP_CHAIN_RADIUS;
        for (const o of this.enemies) {
          if (o === v || victims.includes(o)) continue;
          const op = this.pathPos(o.dist, o.pathIdx);
          const d = Math.hypot(op.x - vp.x, op.y - vp.y);
          if (d < best) {
            best = d;
            chain = o;
          }
        }
        if (chain) {
          chain.hp -= Math.max(1, Math.round(vDmg * STATS.ZAP_CHAIN_FRAC));
          chain.lastHitBy = t.uid;
          chain.lastMethod = "zap";
        }
      }
      // freeze chills even without the slows trait; slows trait works on any method
      const freezeSlow = vMethod === "freeze" ? STATS.FREEZE_SLOW : 0;
      const appliedSlow = Math.max(slow, freezeSlow);
      if (appliedSlow > 0) {
        v.slowTimer = vMethod === "freeze" ? STATS.SLOW_DUR * 2 : STATS.SLOW_DUR;
        v.slowFactor = appliedSlow;
      }
    }

    this.events.push({
      type: "shot",
      towerUid: t.uid,
      fromX: t.x,
      fromY: t.y,
      toX: tp.x,
      toY: tp.y,
      method,
      damage: dmg,
      misfire: false,
      feeds: feedsHeal > 0,
      splash: splashR,
    });

    this.sweepDeaths();
  }

  /** Central death handling — also catches burn-DoT kills from update(). */
  private sweepDeaths() {
    const dead = this.enemies.filter((e) => e.hp <= 0);
    if (!dead.length) return;
    for (const d of dead) {
      const p = this.pathPos(d.dist, d.pathIdx);
      this.energy += d.spec.bounty;
      const killer = this.towers.find((tw) => tw.uid === d.lastHitBy);
      if (killer) killer.kills++;
      this.events.push({
        type: "death",
        x: p.x,
        y: p.y,
        method: d.lastMethod,
        bounty: d.spec.bounty,
        emoji: d.spec.emoji,
      });
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  score(): number {
    return this.wavesCleared * 100 + this.lives * 25 + this.fusionsMade * 40;
  }
}
