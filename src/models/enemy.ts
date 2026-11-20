import type { CharacterStats } from "./character-stats.js";
import { currentBalance } from "./balance-context.js";

export interface EnemyStats extends CharacterStats {
  fishpeople?: boolean;
  skill?: { kind: "guard" | "shield" | "shot" | "heal-all" | "heal-self" | "summon"; name: string; mana: number; cooldown: number; damage?: number; magic?: boolean; farthest?: boolean; duration?: number };
  burnAll?: { damage: number; mana: number; cooldown?: number };
  slashAll?: { damage: number; mana: number; cooldown?: number };
  blockChance?: number;
  bubbleBeam?: { damage: number; mana: number; cooldown: number };
}

export const DEFAULT_ENEMY_AREA_COOLDOWN = 10;

export const defaultEnemies = {
  "mushroom-fighter": { name: "Mushroom Fighter", stats: { hp: 250, mp: 0, atk: 25, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 60 },
  "mushroom-rager": { name: "Mushroom Rager", stats: { hp: 220, mp: 0, atk: 35, def: 2, magic: 0, magicDef: 0, speed: 10, range: "melee" }, gold: 70 },
  fairy: { name: "Fairy", stats: { hp: 160, mp: 0, atk: 22, def: 0, magic: 12, magicDef: 8, speed: 15, range: "range" }, gold: 80 },
  "mushroom-chicken": { name: "Mushroom Chicken", stats: { hp: 600, mp: 0, atk: 40, def: 8, magic: 0, magicDef: 5, speed: 5, range: "melee" }, gold: 200 },
  "mushroom-king": { name: "Mushroom King", stats: { hp: 1600, mp: 0, atk: 45, def: 12, magic: 0, magicDef: 10, speed: 5, range: "melee" }, gold: 600 },
  "fishpeople-guard": { name: "Fishpeople Guard", stats: { hp: 250, mp: 50, atk: 20, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "guard", name: "Guard Mode", mana: 50, cooldown: 2, duration: 2 } }, gold: 100 },
  "fishpeople-archer": { name: "Fishpeople Archer", stats: { hp: 200, mp: 50, atk: 20, def: 5, magic: 0, magicDef: 5, speed: 0, range: "range", fishpeople: true, skill: { kind: "shot", name: "Sniper Shot", mana: 50, cooldown: 1, damage: 50 } }, gold: 100 },
  "fishpeople-rider": { name: "Fishpeople Rider", stats: { hp: 300, mp: 0, atk: 20, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true }, gold: 100 },
  "fishpeople-guardian": { name: "Fishpeople Guardian", stats: { hp: 700, mp: 50, atk: 20, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "shield", name: "Restorative Shield", mana: 50, cooldown: 5, duration: 5 } }, gold: 400 },
  baracudon: { name: "Baracudon", stats: { hp: 400, mp: 0, atk: 40, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee" }, gold: 150 },
  "fishpeople-cleric": { name: "Fishpeople Cleric", stats: { hp: 250, mp: 100, atk: 10, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "heal-all", name: "Fishpeople Heal", mana: 50, cooldown: 2 } }, gold: 150 },
  "fishpeople-researcher": { name: "Fishpeople Researcher", stats: { hp: 550, mp: 100, atk: 10, def: 5, magic: 30, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "shot", name: "Water Snipe", mana: 25, cooldown: 5, damage: 50, magic: true, farthest: true } }, gold: 600 },
  "fishpeople-knight": { name: "Fishpeople Knight", stats: { hp: 400, mp: 0, atk: 20, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, blockChance: 0.3 }, gold: 250 },
  "fishpeople-rifler": { name: "Fishpeople Rifler", stats: { hp: 300, mp: 50, atk: 40, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "shot", name: "Rifle Shot", mana: 25, cooldown: 4, damage: 40 } }, gold: 250 },
  "fishpeople-baron": { name: "Fishpeople Baron", stats: { hp: 500, mp: 50, atk: 40, def: 5, magic: 0, magicDef: 5, speed: 0, range: "melee", fishpeople: true, skill: { kind: "heal-self", name: "Baron Heal", mana: 10, cooldown: 5 } }, gold: 250 },
  "fishpeople-lord": { name: "Fish Emperor Lord", stats: { hp: 1500, mp: 50, atk: 40, def: 15, magic: 0, magicDef: 15, speed: 0, range: "melee", fishpeople: true, skill: { kind: "summon", name: "Summon Knight", mana: 25, cooldown: 10 } }, gold: 1000 },
  "demon-prince": { name: "Demon Prince", stats: { hp: 1000, mp: 100, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee", burnAll: { damage: 20, mana: 40, cooldown: DEFAULT_ENEMY_AREA_COOLDOWN } }, gold: 200 },
  gladiator: { name: "Gladiator", stats: { hp: 150, mp: 0, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 30 },
  spearman: { name: "Spearman", stats: { hp: 150, mp: 0, atk: 25, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 30 },
  assassin: { name: "Assassin", stats: { hp: 120, mp: 0, atk: 25, def: 0, magic: 0, magicDef: 0, speed: 30, range: "melee" }, gold: 30 },
  zugwang: { name: "Zugwang", stats: { hp: 1000, mp: 100, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee", slashAll: { damage: 20, mana: 40, cooldown: DEFAULT_ENEMY_AREA_COOLDOWN } }, gold: 200 },
  "crab-day": { name: "Crab", stats: { hp: 120, mp: 0, atk: 15, def: 5, magic: 0, magicDef: 0, speed: 15, range: "melee" }, gold: 20 },
  "crab-night": { name: "Crab", stats: { hp: 80, mp: 0, atk: 15, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 20 },
  hermit: { name: "Hermit", stats: { hp: 150, mp: 0, atk: 15, def: 5, magic: 0, magicDef: 15, speed: 0, range: "melee", blockChance: 0.3 }, gold: 20 },
  starfish: { name: "Starfish", stats: { hp: 120, mp: 50, atk: 10, def: 5, magic: 15, magicDef: 15, speed: 0, range: "melee", bubbleBeam: { damage: 20, mana: 25, cooldown: 1 } }, gold: 200 },
  "fishpeople-spearman": { name: "Fishpeople Spearman", stats: { hp: 120, mp: 0, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 30 },
  "fishpeople-hunter": { name: "Fishpeople Hunter", stats: { hp: 120, mp: 0, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "range" }, gold: 30 },
  "fishpeople-magos": { name: "Fishpeople Magos", stats: { hp: 120, mp: 100, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee", bubbleBeam: { damage: 15, mana: 30, cooldown: 1 } }, gold: 30 },
  "fishpeople-guide": { name: "Fishpeople Guide", stats: { hp: 700, mp: 100, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee", bubbleBeam: { damage: 15, mana: 60, cooldown: 1 } }, gold: 200 },
  "coco-klan-chief": { name: "Coco Klan Chief", stats: { hp: 500, mp: 0, atk: 40, def: 10, magic: 0, magicDef: 0, speed: 0, range: "range" }, gold: 20 },
  "mutant-boar": { name: "Mutant Boar", stats: { hp: 300, mp: 0, atk: 30, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 80 },
  boar: { name: "Boar", stats: { hp: 40, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 20 },
  slime: { name: "Slime", stats: { hp: 40, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 20 },
  plant: { name: "Plant", stats: { hp: 50, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 20 },
  warrior: { name: "Coco Klan Warrior", stats: { hp: 50, mp: 0, atk: 5, def: 5, magic: 0, magicDef: 0, speed: 0, range: "melee" }, gold: 20 },
  slinger: { name: "Coco Klan Slinger", stats: { hp: 30, mp: 0, atk: 5, def: 0, magic: 0, magicDef: 0, speed: 0, range: "range" }, gold: 20 },
} satisfies Record<string, { name: string; stats: EnemyStats; gold: number }>;
export type EnemyType = keyof typeof defaultEnemies;
export const enemies = new Proxy(defaultEnemies, {
  get(target, key: string) {
    const original = target[key as EnemyType];
    const reward = currentBalance()?.rewards?.[key];
    return original ? { ...original, stats: currentBalance()?.enemies?.[key] ?? original.stats, gold: reward?.gold ?? original.gold, experience: reward?.experience ?? 1 } : undefined;
  },
}) as Record<EnemyType, { name: string; stats: EnemyStats; gold: number; experience: number }>;
export const enemyPools = {
  garnaland: ["mushroom-fighter", "mushroom-rager", "fairy"],
  deepsea: ["fishpeople-guard", "fishpeople-archer", "fishpeople-rider"],
  "deepsea-2f": ["fishpeople-rider", "baracudon", "fishpeople-cleric"],
  "deepsea-palace": ["fishpeople-knight", "fishpeople-rifler", "fishpeople-baron"],
  meadow: ["boar", "slime", "plant"],
  forest: ["warrior", "slinger"],
  tourney: ["gladiator", "spearman", "assassin"],
  harbor: ["crab-day", "hermit", "starfish"],
} satisfies Record<string, EnemyType[]>;
export type Location = keyof typeof enemyPools;
const locationExtras: Partial<Record<Location, EnemyType[]>> = {
  meadow: ["mutant-boar"], forest: ["coco-klan-chief"],
  garnaland: ["mushroom-chicken", "mushroom-king"],
  harbor: ["crab-night", "fishpeople-spearman", "fishpeople-hunter", "fishpeople-magos", "fishpeople-guide"],
  tourney: ["zugwang", "demon-prince"],
  deepsea: ["fishpeople-guardian"], "deepsea-2f": ["fishpeople-researcher"], "deepsea-palace": ["fishpeople-lord"],
};
export function enemyLocations(type: EnemyType): Location[] {
  return (Object.keys(enemyPools) as Location[]).filter(location =>
    (enemyPools[location] as EnemyType[]).includes(type) || locationExtras[location]?.includes(type));
}
export function enemyRewards(type: EnemyType) {
  const boss = type === "mushroom-king" || type === "fishpeople-guardian" || type === "fishpeople-researcher" || type === "fishpeople-lord" || type === "demon-prince" || type === "zugwang" || type === "mutant-boar" || type === "coco-klan-chief" || type === "fishpeople-guide";
  return { ...enemies[type], type, boss, semiBoss: type === "mushroom-chicken", wishCurrency: 0 };
}

export function harborPeriod(now = new Date()): "day" | "night" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour < 12 ? "day" : "night";
}

export function encounterPool(location: Location, now = new Date()): EnemyType[] {
  if (location === "harbor" && harborPeriod(now) === "night") return ["crab-night", "fishpeople-spearman", "fishpeople-hunter", "fishpeople-magos"];
  return enemyPools[location];
}
