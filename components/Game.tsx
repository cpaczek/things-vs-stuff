"use client";

// Top-level orchestrator: seed/mode, the judge service (client cache + meter +
// dev traces), the priced hand (player inventions only — there are no preset
// cards), topbar, and the modal screens. The board owns its own engine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDailyConfig, todaySeed } from "@/lib/daily";
import { combatEff, priceFor, POLICE, POLICE_REJECTIONS } from "@/lib/questions";
import { BIOMES } from "@/lib/biomes";
import { ECONOMY } from "@/game/engine";
import type { Concept, JudgeResponse, PricedCard } from "@/game/types";
import GameBoard, { type GameResult } from "./GameBoard";
import DevPanel, { type Trace } from "./DevPanel";
import HowToPlay from "./HowToPlay";
import EndScreen from "./EndScreen";

export type Meter = {
  judgments: number;
  tokens: number;
  lastMs: number;
  calls: number;
};

/** Fire-and-forget analytics beacon (browser-side, so it survives navigation). */
function track(e: string) {
  try {
    fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ e }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics never break play */
  }
}

export default function Game() {
  const [seed, setSeed] = useState<string | null>(null);
  const [mode, setMode] = useState<"daily" | "free">("daily");
  const [runKey, setRunKey] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [meter, setMeter] = useState<Meter>({ judgments: 0, tokens: 0, lastMs: 0, calls: 0 });
  const [showHowTo, setShowHowTo] = useState(false);
  const [result, setResult] = useState<GameResult | null>(null);
  const [endMeta, setEndMeta] = useState({ practice: false, streak: 0, gallery: [] as string[] });
  const [hand, setHand] = useState<PricedCard[]>([]);
  const [biome, setBiome] = useState<string>("meadow");

  const cacheRef = useRef(new Map<string, JudgeResponse>());
  const traceKey = useRef(1);

  useEffect(() => {
    // Client-only init: the seed is the player's LOCAL date and the toggles live
    // in localStorage, so none of this can be decided during SSR.
    const urlSeed = new URLSearchParams(window.location.search).get("seed");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeed(urlSeed && /^[a-z0-9-]{1,20}$/i.test(urlSeed) ? urlSeed : todaySeed());
    if (urlSeed) setMode("free");
    setDevMode(localStorage.getItem("tvs-dev") === "1");
    if (localStorage.getItem("tvs-howto") !== "1") setShowHowTo(true);
  }, []);

  const config = useMemo(() => (seed ? getDailyConfig(seed) : null), [seed]);

  const toggleDev = () => {
    setDevMode((d) => {
      localStorage.setItem("tvs-dev", d ? "0" : "1");
      return !d;
    });
  };

  const newRun = useCallback((m: "daily" | "free") => {
    setMode(m);
    setSeed(m === "daily" ? todaySeed() : `f${Math.random().toString(36).slice(2, 9)}`);
    setResult(null);
    setTraces([]);
    setRunKey((k) => k + 1);
  }, []);

  /** The judge service: one speculative fan-out per concept, cached client-side. */
  const judge = useCallback(
    async (concept: Concept, opts?: { icon?: boolean; police?: boolean }): Promise<JudgeResponse> => {
      if (!config || !seed) throw new Error("no config");
      const key = `${seed}|${concept.doc.toLowerCase()}|${opts?.icon ? "i" : ""}${opts?.police ? "p" : ""}`;

      let res = cacheRef.current.get(key) ?? null;
      const clientHit = !!res;
      if (!res) {
        const r = await fetch("/api/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doc: concept.doc,
            daySeed: seed,
            wantIcon: !!opts?.icon,
            police: !!opts?.police,
            enemies: config.enemies.map((e) => ({ id: e.id, doc: e.doc })),
          }),
        });
        if (!r.ok) throw new Error(`judge failed: ${r.status}`);
        res = (await r.json()) as JudgeResponse;
        cacheRef.current.set(key, res);
      }

      const fresh = !clientHit && !res.cached;
      const nQuestions = Object.keys(res.trace.questions).length;
      setMeter((m) => ({
        judgments: m.judgments + (fresh ? nQuestions : 0),
        tokens: m.tokens + (fresh ? res!.usage.input_tokens + res!.usage.output_tokens : 0),
        lastMs: res!.latencyMs,
        calls: m.calls + 1,
      }));
      setTraces((t) =>
        [
          {
            key: traceKey.current++,
            name: concept.name,
            emoji: concept.emoji,
            doc: concept.doc,
            latencyMs: res!.latencyMs,
            cached: !fresh,
            usage: res!.usage,
            questions: res!.trace.questions as Trace["questions"],
            answers: res!.trace.answers as Trace["answers"],
            stats: res!.stats,
            enemies: config.enemies.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji })),
          },
          ...t,
        ].slice(0, 40)
      );
      return res;
    },
    [config, seed]
  );

  /** New run: the judge picks today's biome (which landscape suits these invaders). */
  useEffect(() => {
    if (!config || !seed) return;
    let alive = true;
    track("run_start");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBiome("meadow");
    fetch("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daySeed: seed, enemies: config.enemies.map((e) => ({ doc: e.doc })) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.biome) setBiome(j.biome);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [config, seed, runKey]);

  /** New run: the hand starts EMPTY. Nothing is dealt — you invent every thing you fight with. */
  useEffect(() => {
    if (!config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHand([]);
  }, [config, runKey]);

  /** ✏️ INVENT: any typed concept becomes a card — the judge picks its icon and sets its price. */
  const invent = useCallback(
    async (text: string): Promise<void> => {
      const doc = text.trim().replace(/\s+/g, " ").slice(0, 60);
      if (doc.length < 3) throw new Error("give it a few more letters!");
      if (hand.length >= ECONOMY.HAND_SIZE)
        throw new Error(`your hand is full — ${ECONOMY.HAND_SIZE} things is plenty. fuse some!`);
      if (hand.some((c) => c.concept.doc.toLowerCase() === doc.toLowerCase()))
        throw new Error("you already have one of those!");
      const name = doc.length > 26 ? doc.slice(0, 24) + "…" : doc;
      const concept: Concept = { id: `invent_${Date.now()}`, name, emoji: "✏️", doc };
      const res = await judge(concept, { icon: true, police: true });
      // the judge screens munchkin submissions — overruled inventions never become cards
      if (res.police) {
        if (res.police.absurd > POLICE.ABSURD_MAX || res.police.vague > POLICE.VAGUE_MAX) {
          track("invent_overruled");
          throw new Error(
            res.police.absurd > POLICE.ABSURD_MAX
              ? POLICE_REJECTIONS.absurd
              : POLICE_REJECTIONS.vague
          );
        }
      }
      track("invent_ok");
      const card: PricedCard = {
        concept: { ...concept, emoji: res.icon ?? "✏️" },
        stats: res.stats,
        price: priceFor(res.stats),
        invented: true,
      };
      setHand((h) => (h.length >= ECONOMY.HAND_SIZE ? h : [...h, card]));
    },
    [judge, hand]
  );

  /** Game over: daily streak bookkeeping + mine the traces for the day's best rulings. */
  const handleGameOver = useCallback(
    (r: GameResult) => {
      let practice = false;
      let streak = 0;
      if (mode === "daily" && seed) {
        const resKey = `tvs-res-${seed}`;
        practice = !!localStorage.getItem(resKey);
        const stored = JSON.parse(localStorage.getItem("tvs-streak") ?? "null") as {
          last: string;
          count: number;
        } | null;
        if (!practice) {
          localStorage.setItem(resKey, JSON.stringify({ score: r.score, won: r.won }));
          if (r.won) {
            const prev = new Date(Date.parse(seed + "T12:00:00"));
            prev.setDate(prev.getDate() - 1);
            const prevSeed = todaySeed(prev);
            streak = stored && stored.last === prevSeed ? stored.count + 1 : 1;
            localStorage.setItem("tvs-streak", JSON.stringify({ last: seed, count: streak }));
          }
        } else {
          streak = stored?.count ?? 0;
        }
      }

      // superlatives from this run's judgments
      const gallery: string[] = [];
      let sharp: { v: number; txt: string } | null = null;
      let back: { v: number; txt: string } | null = null;
      let close: { v: number; txt: string } | null = null;
      for (const t of traces) {
        for (const e of t.enemies) {
          const m = t.stats.perEnemy[e.id];
          if (!m) continue;
          const ce = combatEff(m.eff, m.pNone);
          if (!sharp || ce > sharp.v)
            sharp = {
              v: ce,
              txt: `sharpest ruling: ${t.emoji} ${t.name} ${m.method}s ${e.emoji} ${e.name} — ${Math.round(ce * 100)}%`,
            };
          if (m.feeds > 0.5 && (!back || m.feeds > back.v))
            back = {
              v: m.feeds,
              txt: `biggest backfire: ${t.emoji} ${t.name} FEEDS ${e.emoji} ${e.name} 😬`,
            };
          const d = Math.abs(ce - 0.5);
          if (!close || d < close.v)
            close = {
              v: d,
              txt: `closest call: ${t.emoji} ${t.name} vs ${e.emoji} ${e.name} — ${Math.round(ce * 100)}/${100 - Math.round(ce * 100)}`,
            };
        }
      }
      if (sharp && sharp.v >= 0.72) gallery.push(sharp.txt);
      if (back) gallery.push(back.txt);
      if (close && close.v <= 0.07) gallery.push(close.txt);

      track(r.won ? "run_win" : "run_loss");
      setEndMeta({ practice, streak, gallery });
      setResult(r);
    },
    [mode, seed, traces]
  );

  if (!config) return null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          THINGS <em>vs</em> STUFF
          <small>
            {mode === "daily" ? `daily #${config.dayNumber}` : "🎲 free play"} · defending{" "}
            {BIOMES[biome]?.label ?? "the meadow"} · anything can fight anything
          </small>
        </div>
        <div className="spacer" />
        {devMode && (
          <span className="chip judge-meter" title="live TypeSafe judgments this session">
            ⚡ <b>{meter.judgments}</b> judgments · {(meter.tokens / 1000).toFixed(1)}k tok
            {meter.lastMs > 0 && <> · last <b>{meter.lastMs}ms</b></>}
          </span>
        )}
        <button
          className={`sketch-btn ${devMode ? "active-toggle" : ""}`}
          onClick={toggleDev}
          title="peek behind the curtain"
        >
          {"</>"} dev
        </button>
        <button className="sketch-btn" onClick={() => newRun("free")} title="new random things, right now">
          🎲 new board
        </button>
        <button className="sketch-btn" onClick={() => setShowHowTo(true)}>
          ?
        </button>
      </header>

      <div className="main-row">
        <GameBoard
          key={runKey}
          config={config}
          hand={hand}
          biome={biome}
          ready={!showHowTo}
          onJudge={judge}
          onInvent={invent}
          onGameOver={handleGameOver}
        />
        {devMode && <DevPanel traces={traces} />}
      </div>

      {showHowTo && (
        <HowToPlay
          onStart={() => {
            localStorage.setItem("tvs-howto", "1");
            setShowHowTo(false);
          }}
        />
      )}

      {result && (
        <EndScreen
          result={result}
          mode={mode}
          dayNumber={config.dayNumber}
          practice={endMeta.practice}
          streak={endMeta.streak}
          gallery={endMeta.gallery}
          onFreePlay={() => newRun("free")}
          onReplayDaily={() => newRun("daily")}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
