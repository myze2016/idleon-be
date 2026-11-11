import type { WeaponType } from "./character.js";

export interface CharacterStats {
  hp: number; mp: number; atk: number; def: number;
  magic: number; magicDef: number; speed: number; range: "melee" | "range";
}

export const baseStats: Record<WeaponType, CharacterStats> = {
  "sword-and-shield": { hp: 100, mp: 100, atk: 10, def: 10, magic: 0, magicDef: 10, speed: 0, range: "melee" },
  bow: { hp: 100, mp: 100, atk: 10, def: 0, magic: 0, magicDef: 10, speed: 10, range: "melee" },
  wand: { hp: 50, mp: 150, atk: 0, def: 0, magic: 10, magicDef: 10, speed: 10, range: "melee" },
  staff: { hp: 50, mp: 150, atk: 0, def: 0, magic: 15, magicDef: 10, speed: 0, range: "melee" },
  book: { hp: 100, mp: 100, atk: 0, def: 0, magic: 10, magicDef: 15, speed: 10, range: "melee" },
  spear: { hp: 150, mp: 50, atk: 15, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" },
  axe: { hp: 150, mp: 50, atk: 20, def: 0, magic: 0, magicDef: 0, speed: 0, range: "melee" },
  rifle: { hp: 100, mp: 100, atk: 10, def: 0, magic: 10, magicDef: 0, speed: 0, range: "range" },
  "dual-gun": { hp: 100, mp: 100, atk: 10, def: 0, magic: 0, magicDef: 0, speed: 10, range: "range" },
  "great-sword": { hp: 125, mp: 125, atk: 10, def: 0, magic: 10, magicDef: 0, speed: 10, range: "melee" },
  "dual-knife": { hp: 100, mp: 100, atk: 10, def: 0, magic: 0, magicDef: 0, speed: 10, range: "melee" },
};
