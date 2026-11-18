import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma.js";

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
try {
  const { records } = JSON.parse(await readFile("data/database-transfer.json", "utf8"));
  const actual = {
    user: await prisma.user.findMany(), character: await prisma.character.findMany(),
    artifact: await prisma.artifact.findMany(), questItem: await prisma.questItem.findMany(),
    encounter: await prisma.encounter.findMany(), pvpRoom: await prisma.pvpRoom.findMany(),
    session: await prisma.session.findMany(), wishPayment: await prisma.wishPayment.findMany(),
  };
  for (const [table, rows] of Object.entries(actual)) {
    // Do not expose private account/session values if verification fails.
    const expectedRows = records[table].map(canonical).sort();
    const actualRows = rows.map(canonical).sort();
    assert.ok(canonical(expectedRows) === canonical(actualRows), `Snapshot mismatch in ${table}`);
    console.log(`${table}: ${rows.length} rows verified`);
  }
} finally { await prisma.$disconnect(); }
