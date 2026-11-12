import { randomInt } from "node:crypto";

export function yellowSpectatorAppears(roll = () => randomInt(10)) { return roll() === 0; }
export interface TourneySpectator { available: boolean; teamIds: string[]; group?: number; summoned?: boolean }
