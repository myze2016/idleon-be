import { randomInt } from "node:crypto";

export const questItems = {
  "zugwangs-evidence": { id: "zugwangs-evidence", name: "Zugwangs Evidence", description: "A worn sheet of paper bearing a drawing of a yellow person.", quantity: 1 },
  "deepsea-moth-map": { id: "deepsea-moth-map", name: "Deepsea Moth Map", description: "A mysterious sea chart dropped by the Fishpeople Guide.", quantity: 1 },
} as const;

export function questDrops(defeated: string[], owned: string[], roll = () => randomInt(2)) {
  const sources = [
    { boss: "fishpeople-guide", item: "deepsea-moth-map" },
    { boss: "zugwang", item: "zugwangs-evidence" },
  ] as const;
  return sources.filter(({ boss, item }) => defeated.includes(boss) && !owned.includes(item) && roll() === 0)
    .map(({ item }) => questItems[item]);
}
