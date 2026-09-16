"use client";

// The full invasion schedule, always visible — strategy starts with knowing
// what's coming. Hover any wave for details.

import type { DailyConfig } from "@/game/types";
import Emo from "./Emo";

export default function WaveTracker({
  config,
  currentWave,
  phase,
}: {
  config: DailyConfig;
  currentWave: number;
  phase: string;
}) {
  const enemyById = new Map(config.enemies.map((e) => [e.id, e]));
  return (
    <div className="wave-track">
      <span className="wt-label">the plan:</span>
      {config.waves.map((wave, i) => {
        const n = i + 1;
        const done = phase === "won" || ((phase !== "prep") && n < currentWave);
        const current = (phase === "combat" || phase === "break") && n === currentWave;
        const boss = wave.some((g) => enemyById.get(g.enemyId)?.boss);
        const tip =
          `wave ${n}: ` +
          wave
            .map((g) => {
              const e = enemyById.get(g.enemyId);
              if (!e) return "";
              const hp = Math.round(e.baseHp * g.hpScale);
              return `${g.count}× ${e.name} (${hp} hp${e.boss ? " — THE BOSS" : ""})`;
            })
            .join(" + ");
        return (
          <span
            key={i}
            className={`wave-cell tip-below ${done ? "done" : ""} ${current ? "current" : ""} ${boss ? "boss" : ""}`}
            data-tip={tip}
          >
            {wave.map((g, j) => (
              <span key={j} className="wt-group">
                <Emo e={enemyById.get(g.enemyId)?.emoji ?? "❓"} size={15} />
                <small>{g.count}</small>
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
