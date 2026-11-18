import type { BalanceConfig } from "../models/balance-context.js";
import { defaultSkills } from "../models/skills.js";
import { defaultEnemies } from "../models/enemy.js";

const labels: Record<string, string> = { hp: "HP", mp: "MP", atk: "Attack", def: "Defense", magic: "Magic", magicDef: "Magic defense", speed: "Speed", mpCost: "MP cost", hpCost: "HP cost", baseCastTime: "Cast time", cooldown: "Cooldown", power: "Effect amount", duration: "Effect duration", chance: "Chance", multiplier: "Critical multiplier", bounces: "Extra bounces", damage: "Base damage" };
function name(weapon: string) { return weapon.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "); }
function format(key: string, value: number) {
  if (key === "chance") return `${Number((value * 100).toFixed(2))}%`;
  return `${value}${["baseCastTime", "cooldown", "duration"].includes(key) ? "s" : key === "multiplier" ? "×" : ""}`;
}
/** Only actual numeric changes become public notes; private admin notes stay private. */
export function generatePatchNotes(before: BalanceConfig, after: BalanceConfig): string[] {
  const lines: string[] = [];
  for (const [weapon, stats] of Object.entries(after.stats)) for (const [key, value] of Object.entries(stats)) {
    const previous = before.stats[weapon]?.[key as keyof typeof stats];
    if (typeof value === "number" && value !== previous) lines.push(`${name(weapon)} — ${labels[key]}: ${previous} → ${value}`);
  }
  for (const [id, skill] of Object.entries(after.skills)) {
    const previous = before.skills[id];
    const owners = Object.entries(defaultSkills).filter(([, skills]) => skills.some(s => s.id === id)).map(([weapon]) => name(weapon)).join(" / ");
    for (const key of [...Object.keys(labels).filter(key => key in skill && typeof skill[key as keyof typeof skill] === "number"), ...(skill.damage ? ["damage"] : [])]) {
      const nextValue = key === "damage" ? skill.damage!.base : skill[key as keyof typeof skill];
      const oldValue = key === "damage" ? previous.damage!.base : previous[key as keyof typeof previous];
      if (typeof nextValue === "number" && typeof oldValue === "number" && nextValue !== oldValue) lines.push(`${owners} — ${skill.name}: ${labels[key]} ${format(key, oldValue)} → ${format(key, nextValue)}`);
    }
  }
  for (const [id, stats] of Object.entries(after.enemies ?? {})) {
    const previous = before.enemies?.[id] ?? defaultEnemies[id as keyof typeof defaultEnemies].stats;
    function compare(old: Record<string, unknown>, next: Record<string, unknown>, path: string) {
      for (const [key, value] of Object.entries(next)) {
        if (typeof value === "number" && value !== old[key]) lines.push(`${name(id)} — ${path}${labels[key] ?? name(key)}: ${old[key]} → ${value}`);
        else if (value && typeof value === "object") compare(old[key] as Record<string, unknown>, value as Record<string, unknown>, `${path}${name(key)} · `);
      }
    }
    compare(previous as unknown as Record<string, unknown>, stats as unknown as Record<string, unknown>, "");
  }
  return lines;
}
