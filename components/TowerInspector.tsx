"use client";

// Sticky-note stat card for the selected tower: the judge's verdicts, in plain words.

import type { TowerEntity } from "@/game/engine";
import type { DailyConfig } from "@/game/types";
import {
  damagePerShot,
  combatEff,
  rangeFor,
  fireRateFor,
  splashRadiusFor,
  slowFactorFor,
  misfireChanceFor,
  feedsHealFor,
  STATS,
} from "@/lib/questions";
import Emo from "./Emo";

const METHOD_LABELS: Record<string, string> = {
  shatter: "shatters",
  burn: "burns",
  soak: "soaks",
  shred: "shreds",
  blunt: "clobbers",
  zap: "zaps",
  freeze: "freezes",
  repel: "repels",
  none: "does nothing to",
};

export default function TowerInspector({
  tower,
  config,
  onSell,
  onClose,
}: {
  tower: TowerEntity;
  config: DailyConfig;
  onSell: () => void;
  onClose: () => void;
}) {
  const s = tower.stats;
  return (
    <div className="inspector">
      <button className="close" onClick={onClose}>
        ✕
      </button>
      <h3>
        <Emo e={tower.concept.emoji} size={24} /> {tower.concept.name}
      </h3>
      {!s ? (
        <div style={{ padding: "8px 0" }}>🤔 the judge is deliberating…</div>
      ) : (
        <>
          {config.enemies.map((e) => {
            const m = s.perEnemy[e.id];
            if (!m) {
              return (
                <div className="matchup" key={e.id}>
                  <span className="vs">
                    <Emo e={e.emoji} size={22} />
                  </span>
                  <span className="verdict">not yet judged</span>
                </div>
              );
            }
            const feeds = feedsHealFor(m.feeds) > 0;
            // show what the engine actually deals: fusion bonus included
            const fusionMult =
              STATS.FUSION_DMG_BONUS[
                Math.min(tower.components.length, STATS.FUSION_DMG_BONUS.length) - 1
              ];
            const dmg = Math.round(damagePerShot(m.eff, m.pNone) * fusionMult);
            const pct = Math.round(combatEff(m.eff, m.pNone) * 100);
            return (
              <div className="matchup" key={e.id}>
                <span className="vs">
                  <Emo e={e.emoji} size={22} />
                </span>
                <span className="verdict">
                  {feeds ? (
                    <b style={{ color: "var(--red)" }}>⚠️ FEEDS it (+{STATS.FEEDS_HEAL} hp!)</b>
                  ) : (
                    <>
                      {METHOD_LABELS[m.method] ?? m.method} it · <b>{dmg}</b> dmg
                    </>
                  )}
                </span>
                <span className="pct" style={{ color: pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--gold)" : "var(--red)" }}>
                  {pct}%
                </span>
              </div>
            );
          })}
          <div className="trait-row">
            <span className="trait">📏 {Math.round(rangeFor(s.reach))} range</span>
            <span className="trait">🔁 {fireRateFor(s.rapid).toFixed(1)}/s</span>
            {splashRadiusFor(s.splash) > 0 && <span className="trait">💥 splash</span>}
            {slowFactorFor(s.slows) > 0 && <span className="trait">🐌 slows</span>}
            {misfireChanceFor(s.wild) > 0 && (
              <span className="trait warn">
                🎲 wild — {Math.round(misfireChanceFor(s.wild) * 100)}% misfire
              </span>
            )}
          </div>
          <div className="trait-row">
            <span className="trait">☠️ {tower.kills} kills</span>
            <button className="sketch-btn danger" style={{ fontSize: 13, padding: "1px 10px" }} onClick={onSell}>
              sell +{Math.floor(tower.paid * 0.6)}⚡
            </button>
          </div>
        </>
      )}
    </div>
  );
}
