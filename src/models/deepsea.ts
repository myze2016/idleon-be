export const deepSeaFloors = {
  deepsea: { name: "DeepSea Moot", floor: 1, boss: "fishpeople-guardian" },
  "deepsea-2f": { name: "DeepSea Moot 2F", floor: 2, boss: "fishpeople-researcher" },
  "deepsea-palace": { name: "DeepSea Moot Royal Palace", floor: 3, boss: "fishpeople-lord" },
} as const;
export type DeepSeaLocation = keyof typeof deepSeaFloors;
export type DeepSeaProgress = Partial<Record<DeepSeaLocation, { defeated: number; target: number }>>;
export function isDeepSea(location: string): location is DeepSeaLocation { return Object.hasOwn(deepSeaFloors, location); }
