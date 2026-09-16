"use client";

// Dev Mode: the Decision Trace. Every /api/judge call rendered the way the
// TypeSafe smarthome demo does it — question rows with type chips and full
// probability distributions, plus the derived game-stat "action" row.

import type { StatBlock } from "@/game/types";
import {
  damagePerShot,
  feedsHealFor,
  rangeFor,
  fireRateFor,
  splashRadiusFor,
  slowFactorFor,
  misfireChanceFor,
} from "@/lib/questions";

export type Trace = {
  key: number;
  name: string;
  emoji: string;
  doc: string;
  latencyMs: number;
  cached: boolean;
  usage: { input_tokens: number; output_tokens: number };
  questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
  answers: Record<
    string,
    | { type: "noul"; noul: number }
    | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  >;
  stats: StatBlock;
  enemies: { id: string; name: string; emoji: string }[];
};

function noulColor(v: number) {
  return v >= 0.65 ? "#8fe28f" : v <= 0.35 ? "#e08f8f" : "#e8c15a";
}

function QuestionRow({ id, trace }: { id: string; trace: Trace }) {
  const q = trace.questions[id];
  const a = trace.answers[id];
  if (!q || !a) return null;

  return (
    <div className="qrow">
      <div className="qtext">
        <span className={`qchip ${q.type}`}>{q.type}</span>
        {q.instructions}
      </div>
      {a.type === "noul" ? (
        <div className="noul-bar">
          <div className="track">
            <div
              className="fill"
              style={{ width: `${a.noul * 100}%`, background: noulColor(a.noul) }}
            />
          </div>
          <span className="val" style={{ color: noulColor(a.noul) }}>
            {a.noul.toFixed(2)}
          </span>
        </div>
      ) : (
        <div className="dist">
          {Object.entries(a.probabilities)
            .sort(([, p1], [, p2]) => p2 - p1)
            .slice(0, 5)
            .map(([opt, p], i) => (
              <span key={opt} className={`opt ${i === 0 ? "win" : ""}`}>
                {opt} {p.toFixed(2)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({ trace }: { trace: Trace }) {
  const s = trace.stats;
  const parts: string[] = [];
  for (const e of trace.enemies) {
    const m = s.perEnemy[e.id];
    if (!m) continue;
    parts.push(
      feedsHealFor(m.feeds) > 0
        ? `${e.emoji} FEEDS(+hp!)`
        : `${e.emoji} ${m.method} ${damagePerShot(m.eff, m.pNone)}dmg`
    );
  }
  const flags = [
    `range ${Math.round(rangeFor(s.reach))}`,
    `${fireRateFor(s.rapid).toFixed(1)}/s`,
    splashRadiusFor(s.splash) > 0 ? "splash" : null,
    slowFactorFor(s.slows) > 0 ? "slows" : null,
    misfireChanceFor(s.wild) > 0 ? `wild ${Math.round(misfireChanceFor(s.wild) * 100)}%` : null,
  ].filter(Boolean);

  return (
    <div className="action-row">
      → <b>action:</b> {parts.join(" · ")}
      <br />→ <b>traits:</b> {flags.join(" · ")}
    </div>
  );
}

export default function DevPanel({ traces }: { traces: Trace[] }) {
  return (
    <aside className="dev-panel">
      <h2>⚡ Decision Trace</h2>
      <div className="sub">
        every question TypeSafe answered, live · one speculative fan-out per concept · zero
        damage tables anywhere
      </div>
      {traces.length === 0 && (
        <div style={{ color: "#746c58", padding: "16px 4px" }}>
          place a THING on the board — its full judgment lands here in ~200ms.
        </div>
      )}
      {traces.map((t) => {
        const qids = Object.keys(t.questions);
        return (
          <div className="trace" key={t.key}>
            <div className="trace-head">
              <span className="tname">
                {t.emoji} {t.name}
              </span>
              <span className="tmeta">
                {qids.length} questions · {t.latencyMs}ms · {t.usage.input_tokens}→
                {t.usage.output_tokens} tok
              </span>
              {t.cached && <span className="cached">cache</span>}
            </div>
            <div className="tmeta" style={{ color: "#746c58", fontSize: 10, marginBottom: 4 }}>
              “A defense: {t.doc}”
            </div>
            {qids.map((id) => (
              <QuestionRow key={id} id={id} trace={t} />
            ))}
            <ActionRow trace={t} />
          </div>
        );
      })}
    </aside>
  );
}
