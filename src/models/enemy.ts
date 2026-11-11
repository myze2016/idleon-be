import type { CharacterStats } from "./character-stats.js";

export const enemies = {
  "coco-klan-chief": { name: "Coco Klan Chief", stats: { hp: 500, mp: 0, atk: 40, def: 10, magic: 0, magicDef: 0, speed: 0, range: "range" }, gold: 10 },
  "mutant-boar": { name: "Mutant Boar", stats: { hp: 300, mp: 0, atk: 30, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 40 },
  boar: { name: "Boar", stats: { hp: 40, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 10 },
  slime: { name: "Slime", stats: { hp: 40, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 10 },
  plant: { name: "Plant", stats: { hp: 50, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 10 },
  warrior: { name: "Coco Klan Warrior", stats: { hp: 50, mp: 0, atk: 5, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 10 },
  slinger: { name: "Coco Klan Slinger", stats: { hp: 30, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "range" }, gold: 10 },
} satisfies Record<string, { name: string; stats: CharacterStats; gold: number }>;
export type EnemyType = keyof typeof enemies;
export const enemyPools = {
  meadow: ["boar", "slime", "plant"],
  forest: ["warrior", "slinger"],
} satisfies Record<string, EnemyType[]>;
export type Location = keyof typeof enemyPools;
export function enemyRewards(type: EnemyType) {
  const boss = type === "mutant-boar" || type === "coco-klan-chief";
  return { ...enemies[type], type, boss, wishCurrency: 0 };
}
