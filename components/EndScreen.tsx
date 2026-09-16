"use client";

import { useEffect, useState } from "react";
import type { GameResult } from "./GameBoard";

function msToMidnight(): number {
  const now = new Date();
  const mid = new Date(now);
  mid.setHours(24, 0, 0, 0);
  return mid.getTime() - now.getTime();
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function EndScreen({
  result,
  mode,
  dayNumber,
  practice,
  streak,
  gallery,
  onFreePlay,
  onReplayDaily,
  onClose,
}: {
  result: GameResult;
  mode: "daily" | "free";
  dayNumber: number;
  practice: boolean;
  streak: number;
  gallery: string[];
  onFreePlay: () => void;
  onReplayDaily: () => void;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(msToMidnight());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setLeft(msToMidnight()), 1000);
    return () => clearInterval(t);
  }, []);

  const header = mode === "daily" ? `🗼 THINGS vs STUFF #${dayNumber}` : "🗼 THINGS vs STUFF 🎲";
  const waveLine = result.won
    ? `✅ held all ${result.totalWaves} waves · ❤️ ${result.lives} left`
    : `❌ overrun at wave ${result.wavesCleared + 1}/${result.totalWaves}`;
  const shareText = [
    header + (practice ? " (practice)" : ""),
    `${waveLine} · ⭐ ${result.score}`,
    result.fusions > 0 ? `🧪 ${result.fusions} fusion${result.fusions === 1 ? "" : "s"} invented` : null,
    result.mvp ? `MVP: ${result.mvp.emoji} ${result.mvp.name} (${result.mvp.kills} kills)` : null,
    mode === "daily" && streak > 1 && !practice ? `🔥 ${streak}-day streak` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="overlay">
      <div className="modal">
        <button
          style={{ position: "absolute", top: 8, right: 12, border: "none", background: "none", fontSize: 20 }}
          onClick={onClose}
          title="peek at the battlefield"
        >
          ✕
        </button>
        <h1>{result.won ? "🎉 THE STUFF IS STOPPED!" : <>the stuff… <em>got through</em> 💀</>}</h1>
        <div className="score-big">
          ⭐ {result.score}
          {practice && (
            <span style={{ fontSize: 18, color: "var(--ink-soft)", marginLeft: 10 }}>
              (practice run)
            </span>
          )}
          {mode === "daily" && streak > 1 && !practice && (
            <span style={{ fontSize: 22, marginLeft: 10 }}>🔥 {streak}-day streak</span>
          )}
        </div>
        <p>
          {waveLine}
          {result.mvp && (
            <>
              <br />
              MVP: {result.mvp.emoji} <b>{result.mvp.name}</b> — {result.mvp.kills} kills
            </>
          )}
          {result.fusions > 0 && (
            <>
              <br />
              <span style={{ color: "var(--ink-soft)" }}>
                🧪 you invented {result.fusions} thing{result.fusions === 1 ? "" : "s"} that
                didn&apos;t exist this morning.
              </span>
            </>
          )}
        </p>
        {gallery.length > 0 && (
          <div style={{ borderTop: "2px dashed rgba(61,50,38,0.25)", paddingTop: 8, marginTop: 4 }}>
            {gallery.map((g) => (
              <div key={g} style={{ fontSize: 15.5, padding: "1.5px 0" }}>
                {g}
              </div>
            ))}
          </div>
        )}
        <div className="share-box">{shareText}</div>
        <div className="btn-row">
          <button className="sketch-btn primary" onClick={copy}>
            {copied ? "✓ copied!" : "📋 copy result"}
          </button>
          <button className="sketch-btn" onClick={onFreePlay}>
            🎲 new random board
          </button>
          <button className="sketch-btn" onClick={onReplayDaily}>
            📅 retry today&apos;s
          </button>
          <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>
            next daily in {fmt(left)}
          </span>
        </div>
      </div>
    </div>
  );
}
