// Hand-authored enemy pool. The GAME ships no damage tables — these are just
// nouns with emoji. There is no tower pool at all: every THING the player
// fights with is invented by typing it, then judged live by TypeSafe.

import type { EnemySpec } from "../game/types";

// Enemy base stats are about PACE, not matchups: hp, speed, lives cost, bounty.
// Who beats them is decided entirely by the judge.
export const ENEMY_POOL: EnemySpec[] = [
  { id: "paper_planes", name: "Paper Planes", emoji: "🛩️", doc: "a squadron of paper airplanes", baseHp: 55, speed: 92, damage: 1, bounty: 5 },
  { id: "glass_golem", name: "Glass Golem", emoji: "🪟", doc: "a golem made of glass", baseHp: 130, speed: 46, damage: 1, bounty: 8 },
  { id: "plant_monster", name: "Plant Monster", emoji: "🌱", doc: "a walking plant monster", baseHp: 100, speed: 59, damage: 1, bounty: 7 },
  { id: "cardboard_knight", name: "Cardboard Knight", emoji: "📦", doc: "a knight made of cardboard", baseHp: 90, speed: 62, damage: 1, bounty: 7 },
  { id: "balloon_dog", name: "Balloon Dog", emoji: "🎈", doc: "a giant balloon animal dog", baseHp: 70, speed: 78, damage: 1, bounty: 6 },
  { id: "wax_soldier", name: "Wax Soldier", emoji: "🕯️", doc: "a soldier made of candle wax", baseHp: 110, speed: 54, damage: 1, bounty: 7 },
  { id: "rust_robot", name: "Rusty Robot", emoji: "🤖", doc: "a rusty old robot", baseHp: 140, speed: 43, damage: 1, bounty: 9 },
  { id: "gummy_bear", name: "Gummy Bear", emoji: "🐻", doc: "a giant gummy bear", baseHp: 120, speed: 51, damage: 1, bounty: 8 },
  { id: "ice_slug", name: "Ice Slug", emoji: "🐌", doc: "a giant slug made of ice", baseHp: 150, speed: 35, damage: 1, bounty: 9 },
  { id: "tumbleweeds", name: "Tumbleweeds", emoji: "🌾", doc: "a stampede of tumbleweeds", baseHp: 45, speed: 108, damage: 1, bounty: 5 },
  { id: "sheet_ghost", name: "Sheet Ghost", emoji: "👻", doc: "a bedsheet ghost", baseHp: 85, speed: 68, damage: 1, bounty: 7 },
  { id: "bubble_blob", name: "Bubble Blob", emoji: "🫧", doc: "a blob of soap bubbles", baseHp: 60, speed: 73, damage: 1, bounty: 5 },
  { id: "stone_gargoyle", name: "Stone Gargoyle", emoji: "🗿", doc: "a stone gargoyle", baseHp: 180, speed: 35, damage: 2, bounty: 11 },
  { id: "moth_swarm", name: "Moth Swarm", emoji: "🦋", doc: "a swarm of giant moths", baseHp: 65, speed: 84, damage: 1, bounty: 6 },
  { id: "sandcastle", name: "Sandcastle", emoji: "🏰", doc: "a walking sandcastle", baseHp: 115, speed: 49, damage: 1, bounty: 7 },
  { id: "vampire_bats", name: "Vampire Bats", emoji: "🦇", doc: "a cloud of vampire bats", baseHp: 75, speed: 86, damage: 1, bounty: 7 },
  { id: "yarn_beast", name: "Yarn Beast", emoji: "🧶", doc: "a beast made of tangled yarn", baseHp: 105, speed: 57, damage: 1, bounty: 7 },
  { id: "porcelain_dolls", name: "Porcelain Dolls", emoji: "🎎", doc: "an army of porcelain dolls", baseHp: 80, speed: 65, damage: 1, bounty: 7 },
  // Bosses — one closes every daily run. They should scare.
  { id: "giant_snowman", name: "Giant Snowman", emoji: "⛄", doc: "a giant angry snowman", baseHp: 1850, speed: 22, damage: 10, bounty: 45, boss: true },
  { id: "jelly_king", name: "Jelly King", emoji: "🍮", doc: "a wobbling giant jelly king", baseHp: 1800, speed: 24, damage: 10, bounty: 45, boss: true },
  { id: "origami_dragon", name: "Origami Dragon", emoji: "🐲", doc: "a giant origami dragon", baseHp: 1700, speed: 27, damage: 10, bounty: 45, boss: true },
  { id: "disco_zombie", name: "Disco Zombie", emoji: "🧟", doc: "a disco-dancing zombie king", baseHp: 1800, speed: 24, damage: 10, bounty: 45, boss: true },
  { id: "marshmallow_man", name: "Marshmallow Man", emoji: "🍡", doc: "a colossal marshmallow man", baseHp: 2050, speed: 20, damage: 10, bounty: 45, boss: true },
];
