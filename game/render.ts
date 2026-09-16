// Canvas doodle renderer: paper texture, "boiling" hand-drawn linework (the wobble
// re-seeds a few times a second like sketch animation), emoji entities, and
// method-specific particle VFX. Consumes engine events; owns all ephemeral art state.

import { Engine, TowerEntity, GameEvent, BOARD_W, BOARD_H, type Vec } from "./engine";
import { BIOMES, DEFAULT_BIOME, type BiomeStyle } from "../lib/biomes";
import { rangeFor, STATS } from "../lib/questions";
import { emoSrc, splitGraphemes } from "../lib/emo";

const FONT = "'Patrick Hand', 'Comic Sans MS', cursive";

type Shape =
  | "shard"
  | "flame"
  | "drop"
  | "strip"
  | "star"
  | "ring"
  | "crystal"
  | "puff"
  | "heart"
  | "spark";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: Shape;
  rot: number;
  vr: number;
};

type Floaty = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
};

type Beam = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  method: string;
  life: number;
};

const METHOD_COLORS: Record<string, string> = {
  shatter: "#4fc3e8",
  burn: "#f0703a",
  soak: "#3a7bd5",
  shred: "#e8a33a",
  blunt: "#8a6ad4",
  zap: "#f5c518",
  freeze: "#7ad0e8",
  repel: "#68b56d",
  none: "#9a9a92",
};

/** Deterministic wobble noise, re-seeded every ~180ms for the sketch "boil". */
function wob(i: number, bucket: number): number {
  const s = Math.sin(i * 127.1 + bucket * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export type DragState = {
  x: number;
  y: number;
  valid: boolean;
  /** True when dragging a card from the hand (shows the placement ghost). */
  placing: boolean;
  /** Fusing onto this tower uid instead of placing. */
  fuseTarget: number | null;
  /** Set when dragging an existing tower (fusion drag) — draws the tether line. */
  fromX?: number;
  fromY?: number;
  emoji: string;
} | null;

export class DoodleRenderer {
  private particles: Particle[] = [];
  private floaties: Floaty[] = [];
  private beams: Beam[] = [];
  private shake = 0;
  private time = 0;
  private imgCache = new Map<string, HTMLImageElement | null>();
  private recoil = new Map<number, number>();
  private banner: { text: string; color: string; life: number; maxLife: number } | null = null;
  private vignette: CanvasGradient | null = null;
  /** Current map's routes, captured each draw (consume() needs them for leak VFX). */
  private pathsPts: Vec[][] = [];
  private biome: BiomeStyle = BIOMES[DEFAULT_BIOME];

  constructor(private ctx: CanvasRenderingContext2D) {}

  // --- OpenMoji drawing (system-emoji text fallback while images load) --------

  private img(e: string): HTMLImageElement | null {
    let im = this.imgCache.get(e);
    if (im === undefined) {
      const src = emoSrc(e);
      if (!src) {
        this.imgCache.set(e, null);
        return null;
      }
      im = new Image();
      im.src = src;
      this.imgCache.set(e, im);
    }
    return im;
  }

  private drawOne(ctx: CanvasRenderingContext2D, e: string, x: number, y: number, size: number) {
    const im = this.img(e);
    if (im && im.complete && im.naturalWidth > 0) {
      ctx.drawImage(im, x - size / 2, y - size / 2, size, size);
    } else {
      ctx.font = `${Math.round(size * 0.82)}px serif`;
      ctx.textAlign = "center";
      ctx.fillText(e, x, y + size * 0.28);
      ctx.textAlign = "left";
    }
  }

  /** Draws one emoji, or a 2–3 emoji fusion cluster. */
  private drawEmoji(ctx: CanvasRenderingContext2D, e: string, x: number, y: number, size: number) {
    const parts = splitGraphemes(e);
    if (parts.length <= 1) {
      this.drawOne(ctx, e, x, y, size);
      return;
    }
    const s = size * (parts.length === 2 ? 0.66 : 0.52);
    const offs: [number, number][] =
      parts.length === 2
        ? [
            [-s * 0.4, 0],
            [s * 0.4, 0],
          ]
        : [
            [-s * 0.48, s * 0.26],
            [s * 0.48, s * 0.26],
            [0, -s * 0.42],
          ];
    parts.slice(0, 3).forEach((p, i) => this.drawOne(ctx, p, x + offs[i][0], y + offs[i][1], s));
  }

  private shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(61,50,38,0.13)";
    ctx.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  consume(events: GameEvent[]) {
    for (const ev of events) {
      if (ev.type === "shot") {
        this.recoil.set(ev.towerUid, 0.16);
        this.beams.push({
          fromX: ev.fromX,
          fromY: ev.fromY,
          toX: ev.toX,
          toY: ev.toY,
          method: ev.method,
          life: 0.14,
        });
        if (ev.feeds) {
          this.spawnBurst(ev.toX, ev.toY, "heart", "#5cb85c", 4);
          this.floaty(ev.toX, ev.toY - 14, "+HP!", "#5cb85c", 15);
        } else {
          this.spawnMethod(ev.toX, ev.toY, ev.method, 5);
        }
        if (ev.misfire) this.floaty(ev.fromX, ev.fromY - 30, "OOPS!", "#d4574e", 16);
        if (ev.method === "blunt") this.shake = Math.max(this.shake, 3);
      } else if (ev.type === "death") {
        this.spawnMethod(ev.x, ev.y, ev.method, 14);
        this.floaty(ev.x, ev.y - 20, `+${ev.bounty}⚡`, "#c9a227", 17);
      } else if (ev.type === "leak") {
        this.shake = 6;
        this.floaty(this.pathsPts[0]?.at(-1)?.x ?? BOARD_W / 2, BOARD_H - 60, `-${ev.livesLost} ❤️`, "#d4574e", 22);
      } else if (ev.type === "wave_start") {
        this.banner = {
          text: ev.label,
          color: ev.boss ? "#d4574e" : "#6b5b43",
          life: ev.boss ? 3 : 2,
          maxLife: ev.boss ? 3 : 2,
        };
        if (ev.boss) this.shake = 7;
      } else if (ev.type === "victory") {
        this.banner = { text: "🎉 VICTORY!", color: "#c9a227", life: 4, maxLife: 4 };
      } else if (ev.type === "defeat") {
        this.banner = { text: "💀 OVERRUN…", color: "#d4574e", life: 4, maxLife: 4 };
      }
    }
  }

  flashJudge(x: number, y: number) {
    this.spawnBurst(x, y, "spark", "#f5c518", 10);
  }

  /** Hand-drawn speech bubble over a tower — the verdict, spoken aloud. */
  speech(x: number, y: number, text: string) {
    // stagger overlapping bubbles upward so simultaneous verdicts stay readable
    let yy = y;
    while (this.bubbles.some((b) => Math.abs(b.x - x) < 240 && Math.abs(b.y - yy) < 52)) {
      yy -= 54;
    }
    this.bubbles.push({ x, y: yy, text, life: 3.2, maxLife: 3.2 });
  }

  private bubbles: { x: number; y: number; text: string; life: number; maxLife: number }[] = [];

  private drawBubbles(ctx: CanvasRenderingContext2D, dt: number) {
    for (const b of this.bubbles) {
      b.life -= dt;
      const alpha = Math.min(1, b.life / 0.4, (b.maxLife - b.life) / 0.15);
      ctx.globalAlpha = Math.max(0, alpha);

      // wrap text
      ctx.font = `14px ${FONT}`;
      const words = b.text.split(" ");
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const test = cur ? cur + " " + w : w;
        if (ctx.measureText(test).width > 200 && cur) {
          lines.push(cur);
          cur = w;
        } else cur = test;
      }
      if (cur) lines.push(cur);

      const wMax = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const bw = wMax + 20;
      const bh = lines.length * 17 + 14;
      const bx = Math.max(8, Math.min(BOARD_W - bw - 8, b.x - bw / 2));
      const by = Math.max(8, b.y - 42 - bh);

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#3d3226";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, [10, 4, 12, 5]);
      ctx.fill();
      ctx.stroke();
      // tail
      ctx.beginPath();
      ctx.moveTo(b.x - 5, by + bh - 1);
      ctx.lineTo(b.x + 7, by + bh - 1);
      ctx.lineTo(b.x, by + bh + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillRect(b.x - 4, by + bh - 2, 10, 3);

      ctx.fillStyle = "#3d3226";
      lines.forEach((l, i) => ctx.fillText(l, bx + 10, by + 20 + i * 17));
      ctx.globalAlpha = 1;
    }
    this.bubbles = this.bubbles.filter((b) => b.life > 0);
  }

  floaty(x: number, y: number, text: string, color: string, size = 15) {
    this.floaties.push({ x, y, text, color, life: 1.1, maxLife: 1.1, size });
  }

  private spawnMethod(x: number, y: number, method: string, n: number) {
    const color = METHOD_COLORS[method] ?? METHOD_COLORS.none;
    const shape: Shape =
      method === "shatter" ? "shard"
      : method === "burn" ? "flame"
      : method === "soak" ? "drop"
      : method === "shred" ? "strip"
      : method === "blunt" ? "star"
      : method === "zap" ? "spark"
      : method === "freeze" ? "crystal"
      : method === "repel" ? "ring"
      : "puff";
    this.spawnBurst(x, y, shape, color, n);
  }

  private spawnBurst(x: number, y: number, shape: Shape, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (shape === "flame" ? 55 : 15),
        life: 0.55 + Math.random() * 0.4,
        maxLife: 0.9,
        size: shape === "ring" ? 6 : 3 + Math.random() * 5,
        color,
        shape,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
      });
      if (shape === "ring") break; // one expanding ring is enough
    }
  }

  draw(
    engine: Engine,
    dt: number,
    drag: DragState,
    selectedUid: number | null,
    biome?: BiomeStyle
  ) {
    this.time += dt;
    this.biome = biome ?? BIOMES[DEFAULT_BIOME];
    const ctx = this.ctx;
    const bucket = Math.floor(this.time * 5.5); // sketch boil rate

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dt * 26);
    }

    this.pathsPts = engine.paths.map((p) => p.pts);
    this.drawPaper(ctx, engine);
    // branch first, main on top — the merge point reads as one road
    for (let i = this.pathsPts.length - 1; i >= 0; i--) this.drawPath(ctx, bucket, this.pathsPts[i], i);
    this.drawGoal(ctx, bucket);

    // range preview under everything else interactive
    const previewTower =
      selectedUid != null ? engine.towers.find((t) => t.uid === selectedUid) : null;
    if (previewTower?.stats) this.drawRange(ctx, previewTower.x, previewTower.y, rangeFor(previewTower.stats.reach));
    if (drag?.placing && !drag.fuseTarget) this.drawDropPreview(ctx, drag);
    if (drag && drag.fromX !== undefined && drag.fromY !== undefined) {
      // fusion tether
      ctx.beginPath();
      ctx.setLineDash([6, 7]);
      ctx.strokeStyle = "rgba(122,93,240,0.7)";
      ctx.lineWidth = 2.4;
      ctx.moveTo(drag.fromX, drag.fromY);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const t of engine.towers) this.drawTower(ctx, t, bucket, dt, drag?.fuseTarget === t.uid);
    this.drawEnemies(ctx, engine);
    this.drawBeams(ctx, dt);
    this.drawParticles(ctx, dt);
    this.drawFloaties(ctx, dt);
    this.drawBubbles(ctx, dt);
    this.drawBanner(ctx, dt);
    this.drawVignette(ctx);

    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, dt: number) {
    if (!this.banner) return;
    this.banner.life -= dt;
    if (this.banner.life <= 0) {
      this.banner = null;
      return;
    }
    const b = this.banner;
    const p = 1 - b.life / b.maxLife; // 0..1
    const inT = Math.min(1, p * 6); // slide in fast
    const alpha = b.life < 0.5 ? b.life * 2 : 1;
    const y = 52 - (1 - inT) * 40;
    ctx.globalAlpha = alpha;
    ctx.font = `34px ${FONT}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(251,247,236,0.9)";
    ctx.strokeText(b.text, BOARD_W / 2, y);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, BOARD_W / 2, y);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }

  private drawVignette(ctx: CanvasRenderingContext2D) {
    if (!this.vignette) {
      const g = ctx.createRadialGradient(
        BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.55,
        BOARD_W / 2, BOARD_H / 2, BOARD_H * 1.05
      );
      g.addColorStop(0, "rgba(61,50,38,0)");
      g.addColorStop(1, "rgba(61,50,38,0.14)");
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  }

  // --- layers -----------------------------------------------------------------

  private drawPaper(ctx: CanvasRenderingContext2D, engine: Engine) {
    ctx.fillStyle = this.biome.paper;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    ctx.fillStyle = "rgba(160,140,100,0.13)";
    for (let x = 24; x < BOARD_W; x += 34) {
      for (let y = 24; y < BOARD_H; y += 34) {
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    }
    // seeded doodle scenery, themed by the judged biome
    ctx.globalAlpha = 0.85;
    for (const d of engine.config.decorations) {
      const e = this.biome.decor[d.slot % this.biome.decor.length];
      this.drawOne(ctx, e, d.x, d.y, d.s);
    }
    ctx.globalAlpha = 1;
  }

  private wobblyPolyline(
    ctx: CanvasRenderingContext2D,
    pts: { x: number; y: number }[],
    bucket: number,
    amp: number,
    offset: number
  ) {
    ctx.beginPath();
    let idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.floor(len / 16));
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const j = wob(idx + offset * 1000, bucket) * amp;
        const x = a.x + (b.x - a.x) * t + nx * (offset + j);
        const y = a.y + (b.y - a.y) * t + ny * (offset + j);
        if (i === 0 && s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        idx++;
      }
    }
    ctx.stroke();
  }

  private drawPath(ctx: CanvasRenderingContext2D, bucket: number, pts: Vec[], idx: number) {
    // dirt fill
    ctx.strokeStyle = this.biome.pathFill;
    ctx.lineWidth = 34;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    this.wobblyPolyline(ctx, pts, bucket, 1.2, 0);
    // sketchy edges
    ctx.strokeStyle = this.biome.pathEdge;
    ctx.lineWidth = 2.2;
    this.wobblyPolyline(ctx, pts, bucket, 1.6, -17);
    this.wobblyPolyline(ctx, pts, bucket, 1.6, 17);
    // dashed center — dashes march toward the house (direction cue)
    ctx.strokeStyle = this.biome.dash;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([9, 11]);
    ctx.lineDashOffset = -this.time * 24;
    this.wobblyPolyline(ctx, pts, bucket, 1.2, 0);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // entry arrow
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = idx === 0 ? "#8a7551" : "#d4574e";
    const entry = pts[0];
    if (entry) {
      const label = idx === 0 ? "intruders" : "⚠ more intruders!";
      if (entry.x < 0) ctx.fillText(`→ ${label}`, 8, entry.y - 26);
      else {
        ctx.textAlign = "right";
        ctx.fillText(`${label} ←`, BOARD_W - 8, entry.y - 26);
        ctx.textAlign = "left";
      }
    }
  }

  private drawGoal(ctx: CanvasRenderingContext2D, bucket: number) {
    const end = this.pathsPts[0]?.at(-1) ?? { x: BOARD_W / 2, y: BOARD_H };
    const x = end.x;
    const y = BOARD_H - 46;
    this.shadow(ctx, x, y + 26, 26);
    this.drawEmoji(ctx, "🏠", x, y + wob(7, bucket) * 1.5, 52);
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = "#8a7551";
    ctx.textAlign = "center";
    ctx.fillText("protect!", x, y + 40);
    ctx.textAlign = "left";
  }

  private drawRange(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.beginPath();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = "rgba(120,150,220,0.55)";
    ctx.fillStyle = "rgba(120,150,220,0.08)";
    ctx.lineWidth = 1.8;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawDropPreview(ctx: CanvasRenderingContext2D, drag: NonNullable<DragState>) {
    // likely range preview (unjudged: show the midpoint of possible ranges)
    ctx.globalAlpha = 0.55;
    this.drawRange(ctx, drag.x, drag.y, STATS.RANGE_MIN + STATS.RANGE_SPAN * 0.45);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(drag.x, drag.y, 23, 0, Math.PI * 2);
    ctx.fillStyle = drag.valid ? "rgba(120,200,130,0.4)" : "rgba(220,90,80,0.35)";
    ctx.fill();
    this.drawEmoji(ctx, drag.emoji, drag.x, drag.y, 34);
    if (!drag.valid) {
      ctx.font = `15px ${FONT}`;
      ctx.fillStyle = "#c0392b";
      ctx.textAlign = "center";
      ctx.fillText("not here!", drag.x, drag.y + 40);
      ctx.textAlign = "left";
    }
    ctx.globalAlpha = 1;
  }

  private drawTower(
    ctx: CanvasRenderingContext2D,
    t: TowerEntity,
    bucket: number,
    dt: number,
    fuseHover: boolean
  ) {
    const { x, y } = t;

    // recoil: quick squash right after firing
    let rec = this.recoil.get(t.uid) ?? 0;
    if (rec > 0) {
      rec = Math.max(0, rec - dt);
      this.recoil.set(t.uid, rec);
    }
    const scale = 1 + rec * 0.9;

    this.shadow(ctx, x, y + 22, 19);

    // base: sketchy double circle
    ctx.beginPath();
    ctx.fillStyle = fuseHover ? "#fff3c6" : "#ffffff";
    ctx.strokeStyle = "#5a4a33";
    ctx.lineWidth = 2;
    ctx.arc(x + wob(t.uid, bucket) * 0.8, y + wob(t.uid + 50, bucket) * 0.8, 21 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(90,74,51,0.35)";
    ctx.lineWidth = 1.2;
    ctx.arc(x, y, (23.5 + wob(t.uid + 99, bucket) * 0.7) * scale, 0, Math.PI * 2);
    ctx.stroke();

    this.drawEmoji(ctx, t.concept.emoji, x, y, 34 * scale);

    // judging: pencil-scribble spinner
    if (!t.stats) {
      ctx.beginPath();
      ctx.strokeStyle = "#c9a227";
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 6]);
      const a0 = this.time * 5;
      ctx.arc(x, y, 29, a0, a0 + Math.PI * 1.4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = "#a08420";
      ctx.textAlign = "center";
      ctx.fillText("judging…", x, y - 32);
      ctx.textAlign = "left";
    }

    // reveal flash: expanding gold ring
    if (t.revealFlash > 0) {
      const p = 1 - t.revealFlash / 1.2;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(201,162,39,${1 - p})`;
      ctx.lineWidth = 3;
      ctx.arc(x, y, 24 + p * 34, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (fuseHover) {
      ctx.font = `15px ${FONT}`;
      ctx.fillStyle = "#7a5df0";
      ctx.textAlign = "center";
      ctx.fillText("⚡ FUSE!", x, y - 34);
      ctx.textAlign = "left";
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, engine: Engine) {
    for (const e of engine.enemies) {
      const p = engine.pathPos(e.dist, e.pathIdx);
      const bob = Math.sin(this.time * 7 + e.uid) * 2.5;
      const scale = e.spec.boss ? 1.8 : 1;
      this.shadow(ctx, p.x, p.y + 15 * scale, 15 * scale);
      this.drawEmoji(ctx, e.spec.emoji, p.x, p.y + bob, 38 * scale);

      // status indicators
      if (e.slowTimer > 0) {
        this.drawOne(ctx, "🐌", p.x + 17 * scale, p.y - 16 * scale + bob, 15);
      }
      if (e.burnTimer > 0) {
        this.drawOne(ctx, "🔥", p.x - 17 * scale, p.y - 16 * scale + bob, 15);
        if (Math.random() < 0.15) {
          this.spawnBurst(p.x, p.y, "flame", "#f0703a", 1);
        }
      }

      // sketchy hp bar
      const w = 34 * scale;
      const frac = Math.max(0, e.hp / e.maxHp);
      const bx = p.x - w / 2;
      const by = p.y - 24 * scale + bob;
      ctx.fillStyle = "rgba(90,74,51,0.25)";
      ctx.fillRect(bx, by, w, 5);
      ctx.fillStyle = frac > 0.5 ? "#6fbf73" : frac > 0.25 ? "#e8a33a" : "#d4574e";
      ctx.fillRect(bx, by, w * frac, 5);
      ctx.strokeStyle = "rgba(90,74,51,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, w, 5);
      ctx.textAlign = "left";
    }
  }

  private drawBeams(ctx: CanvasRenderingContext2D, dt: number) {
    for (const b of this.beams) {
      b.life -= dt;
      const alpha = Math.max(0, b.life / 0.14);
      const color = METHOD_COLORS[b.method] ?? METHOD_COLORS.none;
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = color;
      if (b.method === "zap") {
        // jagged lightning
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(b.fromX, b.fromY);
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mx = b.fromX + (b.toX - b.fromX) * t + (Math.random() - 0.5) * 16;
          const my = b.fromY + (b.toY - b.fromY) * t + (Math.random() - 0.5) * 16;
          ctx.lineTo(mx, my);
        }
        ctx.stroke();
      } else {
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(b.fromX, b.fromY);
        ctx.lineTo(b.toX, b.toY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.shape === "drop" ? 320 : p.shape === "flame" ? -40 : 140) * dt;
      p.rot += p.vr * dt;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      switch (p.shape) {
        case "shard":
        case "crystal":
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.7, p.size);
          ctx.lineTo(-p.size * 0.7, p.size);
          ctx.closePath();
          ctx.fill();
          break;
        case "strip":
          ctx.fillRect(-p.size, -p.size / 3, p.size * 2, p.size / 1.5);
          break;
        case "star": {
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            ctx.lineTo(Math.cos(a) * p.size, Math.sin(a) * p.size);
            ctx.lineTo(Math.cos(a + 0.63) * p.size * 0.45, Math.sin(a + 0.63) * p.size * 0.45);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "ring": {
          const grow = (1 - alpha) * 40;
          ctx.beginPath();
          ctx.lineWidth = 2.5;
          ctx.arc(0, 0, p.size + grow, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "heart":
          this.drawOne(ctx, "💚", 0, 0, p.size * 2.6);
          break;
        case "flame":
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "drop":
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.55, p.size, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "spark":
          ctx.fillRect(-p.size / 2, -1, p.size, 2);
          ctx.fillRect(-1, -p.size / 2, 2, p.size);
          break;
        default: // puff
          ctx.beginPath();
          ctx.arc(0, 0, p.size * (1.4 - alpha * 0.4), 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawFloaties(ctx: CanvasRenderingContext2D, dt: number) {
    for (const f of this.floaties) {
      f.life -= dt;
      f.y -= 34 * dt;
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.font = `bold ${f.size}px ${FONT}`;
      ctx.fillStyle = f.color;
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    }
    this.floaties = this.floaties.filter((f) => f.life > 0);
  }
}
