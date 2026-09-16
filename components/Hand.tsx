"use client";

// The hand: nothing is dealt. Every card here was typed in by the player via
// ✏️ INVENT, then judged, priced, and given matchup dots — so you can read what
// beats what BEFORE spending energy.

import type { EnemySpec, PricedCard } from "@/game/types";
import { combatEff, damagePerShot, feedsHealFor, STATS } from "@/lib/questions";
import Emo from "./Emo";

function dotClass(card: PricedCard, e: EnemySpec): string {
  const m = card.stats?.perEnemy[e.id];
  if (!m) return "u";
  if (m.feeds > STATS.FEEDS_THRESHOLD && feedsHealFor(m.feeds) > 0) return "p";
  const ce = combatEff(m.eff, m.pNone);
  return ce >= 0.55 ? "g" : ce >= 0.35 ? "y" : "r";
}

/** Hover tooltip: the full verdict, readable before you spend a thing. */
function verdictTip(card: PricedCard, enemies: EnemySpec[]): string {
  if (!card.stats) return `“${card.concept.doc}”\n⚖️ being sized up…`;
  const lines = enemies.map((e) => {
    const m = card.stats!.perEnemy[e.id];
    if (!m) return `${e.emoji} ${e.name}: ?`;
    if (m.feeds > STATS.FEEDS_THRESHOLD && feedsHealFor(m.feeds) > 0)
      return `${e.emoji} ${e.name}: FEEDS IT ⚠️`;
    const pct = Math.round(combatEff(m.eff, m.pNone) * 100);
    return `${e.emoji} ${e.name}: ${m.method} · ${damagePerShot(m.eff, m.pNone)} dmg (${pct}%)`;
  });
  return `“${card.concept.doc}”\n${lines.join("\n")}`;
}

export default function Hand({
  cards,
  enemies,
  energy,
  slotsLeft,
  onDragStart,
  onInvent,
}: {
  cards: PricedCard[];
  enemies: EnemySpec[];
  energy: number;
  slotsLeft: number;
  onDragStart: (c: PricedCard, e: React.PointerEvent) => void;
  onInvent: () => void;
}) {
  const empty = cards.length === 0;
  const full = slotsLeft <= 0;
  return (
    <div className={`hand ${empty ? "empty" : ""}`}>
      {cards.map((c) => {
        const judging = c.price == null;
        const affordable = !judging && energy >= (c.price ?? 0);
        return (
          <div
            key={c.concept.id}
            className={`card ${judging ? "judging" : ""} ${affordable ? "" : "disabled"} ${c.invented ? "invented" : ""}`}
            onPointerDown={(e) => {
              e.preventDefault();
              if (affordable) onDragStart(c, e);
            }}
            data-tip={verdictTip(c, enemies)}
          >
            <div className="emoji">
              <Emo e={c.concept.emoji} size={40} />
            </div>
            <div className="name">{c.concept.name}</div>
            <div className="dots">
              {enemies.map((e) => (
                <span key={e.id} className="dot-pair">
                  <Emo e={e.emoji} size={13} />
                  <span className={`dot ${judging ? "u" : dotClass(c, e)}`} />
                </span>
              ))}
            </div>
            <div className="cost">{judging ? "⚖️ …" : `⚡ ${c.price}`}</div>
          </div>
        );
      })}
      <div
        className={`card invent-card ${empty ? "beckon" : ""} ${full ? "disabled" : ""}`}
        onClick={() => {
          if (!full) onInvent();
        }}
        data-tip={
          full
            ? "your hand is full — fuse or sell\nsomething to make room."
            : "type ANY thing — a moat of soup,\na very judgmental owl, anything.\nIt gets sized up and priced on the spot."
        }
      >
        <div className="emoji">✏️</div>
        <div className="name">
          INVENT
          <br />
          {empty ? "a thing!" : "anything"}
        </div>
        <div className="cost">{full ? "hand full" : `${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left`}</div>
      </div>
      {empty && (
        <div className="hand-empty">
          your hand is empty. no presets, no shop —{" "}
          <b>type something</b> and see how the judge rules on it.
        </div>
      )}
    </div>
  );
}
