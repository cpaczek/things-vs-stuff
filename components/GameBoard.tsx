"use client";

// The board: canvas + engine + rAF loop + all pointer interaction.
// Cards are all player-invented and arrive PRE-JUDGED (stats + price), so
// placement is instant. Fusions are judged live — the grammar menu pre-judges
// all five phrasings in parallel so the choice is informed. The Engine lives
// behind a ref (created in the mount effect, touched only from effects/handlers);
// render reads snapshots.

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine, ECONOMY, BOARD_W, BOARD_H, type TowerEntity } from "@/game/engine";
import { DoodleRenderer, type DragState } from "@/game/render";
import { BIOMES } from "@/lib/biomes";
import type {
  Concept,
  DailyConfig,
  EnemySpec,
  JudgeResponse,
  PricedCard,
  StatBlock,
} from "@/game/types";
import {
  FUSION_GRAMMARS,
  combatEff,
  splashRadiusFor,
  slowFactorFor,
  misfireChanceFor,
  feedsHealFor,
  STATS,
} from "@/lib/questions";
import Hand from "./Hand";
import TowerInspector from "./TowerInspector";
import InventModal from "./InventModal";
import WaveTracker from "./WaveTracker";
import Emo from "./Emo";

export type GameResult = {
  won: boolean;
  wavesCleared: number;
  totalWaves: number;
  lives: number;
  score: number;
  fusions: number;
  mvp: { name: string; emoji: string; kills: number } | null;
};

// What a freshly-placed tower blurts out (the wow moment, in-fiction).
const VERDICT_VERBS: Record<string, string> = {
  shatter: "shatter",
  burn: "torch",
  soak: "drench",
  shred: "shred",
  blunt: "clobber",
  zap: "zap",
  freeze: "freeze",
  repel: "scare off",
  none: "do nothing to",
};

function pickBlurt(stats: StatBlock, enemies: EnemySpec[]): string | null {
  let best: { score: number; txt: string } | null = null;
  for (const e of enemies) {
    const m = stats.perEnemy[e.id];
    if (!m) continue;
    const ce = combatEff(m.eff, m.pNone);
    const name = e.name.toLowerCase();
    if (m.feeds > STATS.FEEDS_THRESHOLD) {
      const s = m.feeds + 0.35; // backfires are the best stories — surface them first
      if (!best || s > best.score)
        best = { score: s, txt: `uh oh… I think I make ${name}s STRONGER 😬` };
    } else if (ce >= 0.72) {
      if (!best || ce > best.score)
        best = {
          score: ce,
          txt: `${name}s? I ${VERDICT_VERBS[m.method] ?? "fight"} those. ${Math.round(ce * 100)}% sure.`,
        };
    } else if (ce <= 0.28) {
      const s = 1 - ce - 0.1;
      if (!best || s > best.score)
        best = { score: s, txt: `…I've got nothing against ${name}s, honestly.` };
    }
  }
  return best?.txt ?? null;
}

/** One-line verdict summary for a fusion-grammar option. */
function summarize(stats: StatBlock, enemies: EnemySpec[]): string {
  const strong: string[] = [];
  const feeds: string[] = [];
  for (const e of enemies) {
    const m = stats.perEnemy[e.id];
    if (!m) continue;
    if (feedsHealFor(m.feeds) > 0) feeds.push(e.emoji);
    else if (combatEff(m.eff, m.pNone) >= 0.55) strong.push(e.emoji);
  }
  const bits: string[] = [];
  bits.push(strong.length ? `strong vs ${strong.join("")}` : "no strong matchups");
  if (feeds.length) bits.push(`⚠️ feeds ${feeds.join("")}`);
  if (splashRadiusFor(stats.splash) > 0) bits.push("💥");
  if (slowFactorFor(stats.slows) > 0) bits.push("🐌");
  if (misfireChanceFor(stats.wild) > 0) bits.push("🎲wild");
  return bits.join(" · ");
}

type DragInfo = {
  card?: PricedCard; // set when dragging from the hand
  concept: Concept;
  placing: boolean;
  fusionFrom?: number; // dragging an existing tower
  fromX?: number;
  fromY?: number;
  x: number;
  y: number;
  overBoard: boolean;
  valid: boolean;
  fuseTarget: number | null;
  /** A fuse target exists but energy is short — show feedback on release. */
  fuseBlocked: boolean;
  downX: number;
  downY: number;
  moved: boolean;
};

type PendingFuse = {
  into: number;
  from: number;
  x: number;
  y: number;
  emoji: string;
  options: { id: string; name: string; doc: string }[];
};

type Hud = {
  lives: number;
  energy: number;
  wave: number;
  phase: string;
  judging: number;
  breakLeft: number;
  towerCount: number;
  next: { emoji: string; count: number }[] | null;
};

export default function GameBoard({
  config,
  hand,
  biome,
  ready,
  onJudge,
  onInvent,
  onGameOver,
}: {
  config: DailyConfig;
  hand: PricedCard[];
  biome: string;
  /** False while an intro overlay is up — the invent prompt waits for it. */
  ready: boolean;
  onJudge: (c: Concept) => Promise<JudgeResponse>;
  onInvent: (text: string) => Promise<void>;
  onGameOver: (r: GameResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const rendererRef = useRef<DoodleRenderer | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const selectedRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const overRef = useRef(false); // game over dispatched

  const [hud, setHud] = useState<Hud>({
    lives: ECONOMY.START_LIVES,
    energy: ECONOMY.START_ENERGY,
    wave: 0,
    phase: "prep",
    judging: 0,
    breakLeft: 0,
    towerCount: 0,
    next: null,
  });
  const [speed, setSpeed] = useState(1);
  const [selectedTower, setSelectedTower] = useState<TowerEntity | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingFuse, setPendingFuse] = useState<PendingFuse | null>(null);
  const [fuseVerdicts, setFuseVerdicts] = useState<Record<string, string>>({});
  const [showInvent, setShowInvent] = useState(false);
  const autoInvented = useRef(false); // the empty-hand prompt opens once per run
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const hoverUidRef = useRef<number | null>(null);
  const biomeRef = useRef(biome);

  useEffect(() => {
    biomeRef.current = biome;
  }, [biome]);

  const enemyById = useRef(new Map(config.enemies.map((e) => [e.id, e])));

  // A new run starts with nothing in hand — there are no preset things — so the
  // very first move is always inventing one. Open the prompt for them.
  useEffect(() => {
    if (!ready || autoInvented.current || hand.length > 0) return;
    autoInvented.current = true;
    setShowInvent(true);
  }, [ready, hand.length]);

  // --- main loop ----------------------------------------------------------------

  useEffect(() => {
    const engine = new Engine(config);
    engineRef.current = engine;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const renderer = new DoodleRenderer(ctx);
    rendererRef.current = renderer;

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;

    const tick = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000) * speedRef.current;
      last = ts;

      engine.update(dt);
      const events = engine.drainEvents();
      for (const ev of events) {
        if ((ev.type === "victory" || ev.type === "defeat") && !overRef.current) {
          overRef.current = true;
          const mvpT = [...engine.towers].sort((a, b) => b.kills - a.kills)[0];
          const result: GameResult = {
            won: ev.type === "victory",
            wavesCleared: engine.wavesCleared,
            totalWaves: config.waves.length,
            lives: engine.lives,
            score: engine.score(),
            fusions: engine.fusionsMade,
            mvp:
              mvpT && mvpT.kills > 0
                ? { name: mvpT.concept.name, emoji: mvpT.concept.emoji, kills: mvpT.kills }
                : null,
          };
          setTimeout(() => onGameOver(result), 1100);
        }
      }
      renderer.consume(events);

      const d = dragRef.current;
      const dragState: DragState =
        d && d.overBoard
          ? {
              x: d.x,
              y: d.y,
              valid: d.valid,
              placing: d.placing,
              fuseTarget: d.fuseTarget,
              fromX: d.fromX,
              fromY: d.fromY,
              emoji: d.concept.emoji,
            }
          : null;
      renderer.draw(engine, dt, dragState, selectedRef.current, BIOMES[biomeRef.current]);

      // low-frequency snapshot sync for React
      if (ts - lastHud > 120) {
        lastHud = ts;
        const preview = engine.nextWavePreview();
        const next = preview
          ? preview.map((g) => ({
              emoji: enemyById.current.get(g.enemyId)?.emoji ?? "❓",
              count: g.count,
            }))
          : null;
        const nextStr = next?.map((n) => n.emoji + n.count).join(",") ?? "";
        const target: Hud = {
          lives: engine.lives,
          energy: engine.energy,
          wave: engine.waveIndex + 1,
          phase: engine.phase,
          judging: engine.towers.filter((t) => !t.stats).length,
          breakLeft: Math.ceil(engine.breakTimer),
          towerCount: engine.towers.length,
          next,
        };
        setHud((prev) => {
          const prevNextStr = prev.next?.map((n) => n.emoji + n.count).join(",") ?? "";
          return prev.lives !== target.lives ||
            prev.energy !== target.energy ||
            prev.wave !== target.wave ||
            prev.phase !== target.phase ||
            prev.judging !== target.judging ||
            prev.breakLeft !== target.breakLeft ||
            prev.towerCount !== target.towerCount ||
            prevNextStr !== nextStr
            ? target
            : prev;
        });
        const sel =
          selectedRef.current != null
            ? engine.towers.find((t) => t.uid === selectedRef.current) ?? null
            : null;
        setSelectedTower((prev) => {
          if (!sel) return prev === null ? prev : null;
          return prev &&
            prev.uid === sel.uid &&
            prev.stats === sel.stats &&
            prev.kills === sel.kills &&
            prev.concept === sel.concept
            ? prev
            : { ...sel };
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- fusion menu: pre-judge every grammar option in parallel --------------------

  useEffect(() => {
    if (!pendingFuse) return;
    let alive = true;
    for (const opt of pendingFuse.options) {
      // verdicts are keyed by fuse-pair + option, so stale entries are harmless
      const vKey = `${pendingFuse.into}_${pendingFuse.from}_${opt.id}`;
      onJudge({ id: opt.id, name: opt.name, emoji: pendingFuse.emoji, doc: opt.doc })
        .then((res) => {
          if (!alive) return;
          setFuseVerdicts((v) => ({ ...v, [vKey]: summarize(res.stats, config.enemies) }));
        })
        .catch(() => {
          if (alive) setFuseVerdicts((v) => ({ ...v, [vKey]: "…the verdict got lost" }));
        });
    }
    return () => {
      alive = false;
    };
  }, [pendingFuse, onJudge, config]);

  const doFuse = useCallback(
    (opt: { id: string; name: string; doc: string }) => {
      const engine = engineRef.current;
      const pf = pendingFuse;
      setPendingFuse(null);
      if (!engine || !pf) return;
      const fused = engine.fuseTowers(pf.into, pf.from, { name: opt.name, doc: opt.doc });
      if (!fused) return;
      try {
        fetch("/api/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ e: "fusion" }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
      rendererRef.current?.floaty(fused.x, fused.y - 34, "⚡ FUSED!", "#7a5df0", 19);
      selectedRef.current = fused.uid;
      onJudge(fused.concept)
        .then((res) => {
          engine.setTowerStats(fused.uid, res.stats);
          rendererRef.current?.flashJudge(fused.x, fused.y);
          const blurt = pickBlurt(res.stats, config.enemies);
          if (blurt) rendererRef.current?.speech(fused.x, fused.y, blurt);
        })
        .catch(() => {
          rendererRef.current?.floaty(fused.x, fused.y, "the verdict got lost — try again", "#d4574e", 15);
        });
    },
    [pendingFuse, onJudge, config]
  );

  // --- pointer plumbing -----------------------------------------------------------

  const boardPos = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * BOARD_W) / rect.width,
      y: ((clientY - rect.top) * BOARD_H) / rect.height,
      over:
        clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    };
  }, []);

  const updateDrag = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current;
      const engine = engineRef.current;
      if (!d || !engine) return;
      const p = boardPos(clientX, clientY);
      d.x = p.x;
      d.y = p.y;
      d.overBoard = p.over;
      if (Math.hypot(p.x - d.downX, p.y - d.downY) > 7) d.moved = true;

      if (d.fusionFrom !== undefined) {
        const target = engine.towers.find((t) => Math.hypot(t.x - p.x, t.y - p.y) <= 26) ?? null;
        const from = engine.towers.find((t) => t.uid === d.fusionFrom);
        const pairOk =
          !!target &&
          !!from &&
          target.uid !== d.fusionFrom &&
          target.components.length + from.components.length <= 3;
        const energyOk = engine.energy >= ECONOMY.FUSE_COST;
        d.fuseTarget = pairOk && energyOk ? target!.uid : null;
        d.fuseBlocked = pairOk && !energyOk;
        d.valid = d.fuseTarget !== null;
      } else {
        d.valid =
          p.over &&
          engine.canPlaceAt({ x: p.x, y: p.y }) &&
          d.card?.price != null &&
          engine.energy >= d.card.price;
        d.fuseTarget = null;
      }
    },
    [boardPos]
  );

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    const engine = engineRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d || !engine) return;

    if (d.fusionFrom !== undefined) {
      if (!d.moved) {
        selectedRef.current = selectedRef.current === d.fusionFrom ? null : d.fusionFrom!;
      } else if (d.fuseBlocked) {
        rendererRef.current?.floaty(d.x, d.y - 20, `need ⚡${ECONOMY.FUSE_COST} to fuse!`, "#d4574e", 16);
      } else if (d.fuseTarget !== null) {
        const into = engine.towers.find((t) => t.uid === d.fuseTarget);
        const from = engine.towers.find((t) => t.uid === d.fusionFrom);
        if (into && from) {
          if (into.components.length + from.components.length > 2) {
            // one side is already a fusion — no grammar to pick, just merge
            const fused = engine.fuseTowers(into.uid, from.uid);
            if (fused) {
              rendererRef.current?.floaty(fused.x, fused.y - 34, "⚡ FUSED!", "#7a5df0", 19);
              selectedRef.current = fused.uid;
              onJudge(fused.concept)
                .then((res) => engine.setTowerStats(fused.uid, res.stats))
                .catch(() => {});
            }
          } else {
            // HOW they combine is the player's call — that changes what it IS
            setPendingFuse({
              into: into.uid,
              from: from.uid,
              x: into.x,
              y: into.y,
              emoji: into.concept.emoji + from.concept.emoji,
              options: FUSION_GRAMMARS.map((g) => ({
                id: g.id,
                name: g.name(into.concept.name, from.concept.name),
                doc: g.doc(into.concept.doc, from.concept.doc),
              })),
            });
          }
        }
      }
      return;
    }

    // placing from the hand — the card is pre-judged, so this is instant
    if (d.overBoard && d.valid && d.card?.stats && d.card.price != null && !overRef.current) {
      const t = engine.placeTower(d.concept, [d.concept], { x: d.x, y: d.y }, d.card.price);
      if (t) {
        engine.setTowerStats(t.uid, d.card.stats);
        rendererRef.current?.flashJudge(t.x, t.y);
        const blurt = pickBlurt(d.card.stats, config.enemies);
        if (blurt) rendererRef.current?.speech(t.x, t.y, blurt);
      }
    }
  }, [onJudge, config]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragRef.current) updateDrag(e.clientX, e.clientY);
    };
    const up = () => {
      if (dragRef.current) endDrag();
    };
    const cancel = () => {
      // touch drag hijacked by a scroll gesture — abandon cleanly, place nothing
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [updateDrag, endDrag]);

  /** Hand cards call this on pointerdown. */
  const startCardDrag = useCallback(
    (card: PricedCard, e: React.PointerEvent) => {
      const engine = engineRef.current;
      if (!engine || overRef.current) return;
      if (!card.stats || card.price == null || engine.energy < card.price) return;
      const p = boardPos(e.clientX, e.clientY);
      dragRef.current = {
        card,
        concept: card.concept,
        placing: true,
        x: p.x,
        y: p.y,
        overBoard: p.over,
        valid: false,
        fuseTarget: null,
        fuseBlocked: false,
        downX: p.x,
        downY: p.y,
        moved: false,
      };
      setDragging(true);
    },
    [boardPos]
  );

  const onCanvasDown = useCallback(
    (e: React.PointerEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const p = boardPos(e.clientX, e.clientY);
      const t = engine.towers.find((tw) => Math.hypot(tw.x - p.x, tw.y - p.y) <= 26) ?? null;
      if (t) {
        dragRef.current = {
          concept: t.concept,
          placing: false,
          fusionFrom: t.uid,
          fromX: t.x,
          fromY: t.y,
          x: p.x,
          y: p.y,
          overBoard: true,
          valid: false,
          fuseTarget: null,
          fuseBlocked: false,
          downX: p.x,
          downY: p.y,
          moved: false,
        };
        setDragging(true);
      } else {
        selectedRef.current = null;
        setSelectedTower(null);
      }
    },
    [boardPos]
  );

  const onCanvasMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current) {
        if (hoverUidRef.current !== null) {
          hoverUidRef.current = null;
          setHoverTip(null);
        }
        return;
      }
      const engine = engineRef.current;
      if (!engine) return;
      const p = boardPos(e.clientX, e.clientY);
      const t = engine.towers.find((tw) => Math.hypot(tw.x - p.x, tw.y - p.y) <= 26) ?? null;
      const uid = t?.uid ?? null;
      if (uid === hoverUidRef.current) return;
      hoverUidRef.current = uid;
      setHoverTip(
        t
          ? {
              x: t.x,
              y: t.y,
              text: `${t.concept.name} · ${t.kills} kills — click to inspect · drag onto another to FUSE`,
            }
          : null
      );
    },
    [boardPos]
  );

  const onCanvasLeave = useCallback(() => {
    hoverUidRef.current = null;
    setHoverTip(null);
  }, []);

  // --- UI -------------------------------------------------------------------------

  const rushBonus =
    ECONOMY.RUSH_BONUS_BASE + ECONOMY.RUSH_BONUS_PER_WAVE * (hud.wave + 1);
  const phaseLabel =
    hud.phase === "prep"
      ? hand.length === 0 && hud.towerCount === 0
        ? "invent a thing to fight with"
        : "place your things, then sound the alarm"
      : hud.phase === "break"
        ? `wave ${hud.wave} cleared!`
        : hud.phase === "combat"
          ? `wave ${hud.wave}/${config.waves.length}`
          : hud.phase === "won"
            ? "VICTORY!"
            : "overrun…";

  return (
    <div className="board-col">
      <div className="hud-row">
        <span className="chip" data-tip="lives — stuff that reaches your house eats these">❤️ {hud.lives}</span>
        <span className="chip" data-tip={"energy — spend it on things and fusions,\nearn it from kills and early waves"}>⚡ {hud.energy}</span>
        <span className="chip">🌊 {phaseLabel}</span>
        {hud.judging > 0 && <span className="chip wobble">🤔 sizing up {hud.judging}…</span>}
        <span style={{ flex: 1 }} />
        {hud.phase === "prep" && (
          <button
            className="sketch-btn primary"
            onClick={() => engineRef.current?.startCombat()}
            disabled={hud.towerCount === 0}
            title={hud.towerCount === 0 ? "place at least one thing first!" : ""}
          >
            ▶ SOUND THE ALARM
          </button>
        )}
        {hud.phase === "break" && (
          <button
            className="sketch-btn primary"
            onClick={() => {
              const bonus = engineRef.current?.callNextWave() ?? 0;
              if (bonus > 0)
                rendererRef.current?.floaty(BOARD_W / 2, 90, `+${bonus}⚡ bring it on!`, "#c9a227", 19);
            }}
          >
            ▶ next wave now +{rushBonus}⚡
          </button>
        )}
        {(hud.phase === "combat" || hud.phase === "break") && (
          <button
            className="sketch-btn"
            title="tap to change speed"
            onClick={() => {
              const next = speed === 1 ? 2 : speed === 2 ? 4 : 1;
              setSpeed(next);
              speedRef.current = next;
            }}
          >
            {"▶".repeat(speed === 4 ? 3 : speed)} speed {speed}x ▸
          </button>
        )}
      </div>

      <WaveTracker config={config} currentWave={hud.wave} phase={hud.phase} />

      <div className="board-wrap">
        <canvas
          ref={canvasRef}
          width={BOARD_W}
          height={BOARD_H}
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerLeave={onCanvasLeave}
          style={{ cursor: dragging ? "grabbing" : "pointer" }}
        />
        {hoverTip && (
          <div
            className="canvas-tip"
            style={{ left: `${(hoverTip.x / BOARD_W) * 100}%`, top: `${(hoverTip.y / BOARD_H) * 100}%` }}
          >
            {hoverTip.text}
          </div>
        )}
        {pendingFuse && (
          <div className="fuse-menu">
            <div className="fuse-title">
              <Emo e={pendingFuse.emoji} size={26} /> how do they combine? (⚡{ECONOMY.FUSE_COST})
            </div>
            {pendingFuse.options.map((opt) => (
              <button key={opt.id} className="fuse-opt" onClick={() => doFuse(opt)}>
                {opt.name}
                <span className="verdict-line">
                  {fuseVerdicts[`${pendingFuse.into}_${pendingFuse.from}_${opt.id}`] ??
                    "sizing it up…"}
                </span>
              </button>
            ))}
            <button className="fuse-cancel" onClick={() => setPendingFuse(null)}>
              ✕ never mind
            </button>
          </div>
        )}
        {selectedTower && (
          <TowerInspector
            tower={selectedTower}
            config={config}
            onSell={() => {
              engineRef.current?.sellTower(selectedTower.uid);
              selectedRef.current = null;
              setSelectedTower(null);
            }}
            onClose={() => {
              selectedRef.current = null;
              setSelectedTower(null);
            }}
          />
        )}
      </div>

      <Hand
        cards={hand}
        enemies={config.enemies}
        energy={hud.energy}
        slotsLeft={ECONOMY.HAND_SIZE - hand.length}
        onDragStart={startCardDrag}
        onInvent={() => setShowInvent(true)}
      />
      <div className="hand-hint">
        dots = the verdict vs today&apos;s stuff: <span className="dot-demo g" /> strong ·{" "}
        <span className="dot-demo y" /> meh · <span className="dot-demo r" /> useless ·{" "}
        <span className="dot-demo p" /> feeds them! · drag one thing onto another to{" "}
        <b style={{ color: "var(--purple)" }}>FUSE</b>
      </div>

      {showInvent && (
        <InventModal
          slotsLeft={ECONOMY.HAND_SIZE - hand.length}
          onInvent={onInvent}
          onClose={() => setShowInvent(false)}
        />
      )}
    </div>
  );
}
