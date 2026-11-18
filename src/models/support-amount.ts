import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

export function supportAmount(input: unknown) {
  const raw = typeof input === "number" || typeof input === "string" ? String(input).trim() : "";
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw new HttpError(400, "Enter the amount sent, with up to two decimal places");
  const amount = new Prisma.Decimal(raw);
  if (!amount.gt(0) || amount.gt("9999999999.99")) throw new HttpError(400, "Enter a positive donation amount");
  const tier = amount.gte(100) ? 3 : amount.gte(50) ? 2 : amount.gte(10) ? 1 : 0;
  return { amount, tier };
}
