import type { BalanceConfig } from "../models/balance-context.js";
import { defaultSkills } from "../models/skills.js";
import { defaultEnemies } from "../models/enemy.js";
import { normalizeEconomy, upgradeStep } from "../models/economy.js";

const labels: Record<string, string> = { hp: "HP", mp: "MP", atk: "Attack", def: "Defense", magic: "Magic", magicDef: "Magic defense", speed: "Speed", mpCost: "MP cost", hpCost: "HP cost", baseCastTime: "Cast time", cooldown: "Cooldown", power: "Effect amount", duration: "Effect duration", chance: "Chance", multiplier: "Critical multiplier", bounces: "Extra bounces", damage: "Base damage" };
function name(weapon: string) { return weapon.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "); }
function format(key: string, value: number) {
  if (key === "chance") return `${Number((value * 100).toFixed(2))}%`;
  return `${value}${["baseCastTime", "cooldown", "duration"].includes(key) ? "s" : key === "multiplier" ? "×" : ""}`;
}
/** Only actual numeric changes become public notes; private admin notes stay private. */
export function generatePatchNotes(before: BalanceConfig, after: BalanceConfig): string[] {
  const lines: string[] = [];
  const oldEconomy = normalizeEconomy(before.economy), newEconomy = normalizeEconomy(after.economy);
  if (oldEconomy.skillUnlockCost !== newEconomy.skillUnlockCost) lines.push(`Skill 2 unlock cost: ${oldEconomy.skillUnlockCost} to ${newEconomy.skillUnlockCost} gold`);
  for (const [stat, price] of Object.entries(newEconomy.shopPrices)) if (oldEconomy.shopPrices[stat] !== price) lines.push(`${name(stat)} artifact shop price: ${oldEconomy.shopPrices[stat]} to ${price} gold`);
  if (oldEconomy.levelExp.length !== newEconomy.levelExp.length) lines.push(`Configured EXP level rows: ${oldEconomy.levelExp.length} to ${newEconomy.levelExp.length}`);
  for (let index = 0; index < Math.max(oldEconomy.levelExp.length, newEconomy.levelExp.length); index++) {
    const old = oldEconomy.levelExp[Math.min(index, oldEconomy.levelExp.length - 1)], next = newEconomy.levelExp[Math.min(index, newEconomy.levelExp.length - 1)];
    if (old !== next) lines.push(`Level ${index + 1} to ${index + 2} EXP: ${old} to ${next}`);
  }
  for (const [label, oldRows, nextRows] of [
    ["Artifact", oldEconomy.artifactEnhancements, newEconomy.artifactEnhancements],
    ...Object.keys(newEconomy.characterUpgrades).map(weapon => [name(weapon), oldEconomy.characterUpgrades[weapon], newEconomy.characterUpgrades[weapon]] as const),
  ] as const) {
    if (oldRows.length !== nextRows.length) lines.push(`${label} configured upgrade rows: ${oldRows.length} to ${nextRows.length}`);
    for (let index = 0; index < Math.max(oldRows.length, nextRows.length); index++) {
      const old = upgradeStep(oldRows, index), next = upgradeStep(nextRows, index);
      if (old.cost !== next.cost) lines.push(`${label} +${index} to +${index + 1} cost: ${old.cost} to ${next.cost} gold`);
      if (old.gain !== next.gain) lines.push(`${label} +${index} to +${index + 1} stat gain: ${old.gain} to ${next.gain}`);
    }
  }
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
  for (const [id, reward] of Object.entries(after.rewards ?? {})) {
    const previous = before.rewards?.[id] ?? { gold: defaultEnemies[id as keyof typeof defaultEnemies].gold, experience: 1 };
    if (reward.gold !== previous.gold) lines.push(`${name(id)} — Gold reward: ${previous.gold} → ${reward.gold}`);
    if (reward.experience !== previous.experience) lines.push(`${name(id)} — EXP reward: ${previous.experience} → ${reward.experience}`);
  }
  return lines;
}
