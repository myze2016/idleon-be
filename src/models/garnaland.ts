import type { EnemyType } from "./enemy.js";

export interface GarnalandProgress { defeated: number; target: number; chickenAt: number }
export const initialGarnalandProgress = (): GarnalandProgress => ({ defeated: 0, target: 40, chickenAt: 15 });
const regulars: EnemyType[] = ["mushroom-fighter", "mushroom-rager", "fairy"];

export function garnalandSpecial(progress: GarnalandProgress, active: string[]): EnemyType | null {
  if (active.includes("mushroom-king") || active.includes("mushroom-chicken")) return null;
  if (progress.defeated >= progress.target) return "mushroom-king";
  return progress.defeated >= progress.chickenAt ? "mushroom-chicken" : null;
}

export function advanceGarnaland(progress: GarnalandProgress, defeated: EnemyType[]): GarnalandProgress {
  if (defeated.includes("mushroom-king")) return initialGarnalandProgress();
  const kills = progress.defeated + defeated.filter((type) => regulars.includes(type)).length;
  return { ...progress, defeated: kills, chickenAt: defeated.includes("mushroom-chicken") ? kills + 15 : progress.chickenAt };
}
