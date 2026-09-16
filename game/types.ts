// Shared types between the judge API route, the game engine, and the UI.

export type Concept = {
  id: string;
  name: string;
  emoji: string;
  /** The phrase sent to TypeSafe as the thing being judged, e.g. "an opera singer hitting a high note". */
  doc: string;
};

/** One judged tower-vs-enemy relationship. */
export type EnemyMatchup = {
  /** P(this defense damages/stops this enemy) — drives damage. */
  eff: number;
  /** P(this defense strengthens this enemy) — backfire; above threshold it heals them. */
  feeds: number;
  /** How the defense affects this enemy (shatter/burn/soak/...) — drives VFX. */
  method: string;
  /** Probability of the chosen method. */
  methodP: number;
  /** Probability that the defense has "no meaningful effect" — the sharpest matchup signal. */
  pNone: number;
};

/** The complete judged stat block for one tower concept — one API round trip. */
export type StatBlock = {
  perEnemy: Record<string, EnemyMatchup>;
  slows: number;
  splash: number;
  reach: number;
  rapid: number;
  wild: number;
};

export type JudgeUsage = { input_tokens: number; output_tokens: number };

export type JudgeResponse = {
  stats: StatBlock;
  /** Judge-picked icon (only when requested, for invented things). */
  icon?: string;
  /** Munchkin screening (only when requested): P(absurdly omnipotent), P(vague wish). */
  police?: { absurd: number; vague: number };
  usage: JudgeUsage;
  latencyMs: number;
  cached: boolean;
  /** Raw question/answer fan-out, rendered by the Dev Mode decision-trace panel. */
  trace: {
    document: string;
    questions: Record<string, unknown>;
    answers: Record<string, unknown>;
  };
};

/** A card in the hand: a concept plus its judged verdict and judged price.
 * stats/price are null while the judge is still reviewing it. */
export type PricedCard = {
  concept: Concept;
  stats: StatBlock | null;
  price: number | null;
  /** Always true now — every card is player-invented; kept for styling/analytics. */
  invented?: boolean;
};

export type WaveSpec = {
  enemyId: string;
  count: number;
  /** Seconds between spawns within the wave. */
  spacing: number;
  /** Multiplier on the enemy's base HP for this wave. */
  hpScale: number;
};

export type EnemySpec = Concept & {
  baseHp: number;
  /** Path speed in px/sec. */
  speed: number;
  /** Lives lost if it reaches the end. */
  damage: number;
  /** Energy awarded on kill. */
  bounty: number;
  boss?: boolean;
};

export type Decoration = { x: number; y: number; slot: number; s: number };

export type DailyConfig = {
  /** YYYY-MM-DD — also the PRNG seed and the judgment cache namespace. */
  seed: string;
  /** Daily puzzle number shown in the share text. */
  dayNumber: number;
  /** Today's STUFF. There is no tower list: every THING is player-invented. */
  enemies: EnemySpec[];
  /** waves[i] is one wave; a wave may mix several enemy groups. */
  waves: WaveSpec[][];
  /** Procedurally generated routes (1 or 2 — a branch merges into the main road).
   * Board coords; each starts off-board and ends at the house. */
  paths: { x: number; y: number }[][];
  /** Fraction of enemies that take the branch route, when one exists. */
  branchShare: number;
  /** Seeded doodle scenery (slot maps into the biome's decor set). */
  decorations: Decoration[];
};
