import { createPlayer, findUserByUsername } from "../repositories/user.repository.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import type { User } from "../models/user.js";

const dummyHash = hashPassword("invalid-account");

export async function registerPlayer(username: string, password: string): Promise<User> {
  // The database unique key also handles concurrent requests for the same username.
  try {
    return await createPlayer(username.toLowerCase(), await hashPassword(password));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "That username is already taken");
    }
    throw error;
  }
}

export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = await findUserByUsername(username);
  const matches = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  if (!user || !matches) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}
