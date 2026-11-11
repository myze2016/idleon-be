import session, { type SessionData } from "express-session";
import { prisma } from "../lib/prisma.js";

type Done = (error?: unknown) => void;

export class PrismaSessionStore extends session.Store {
  private expiry(data: SessionData) {
    return data.cookie.expires ? new Date(data.cookie.expires) : new Date(Date.now() + 8 * 60 * 60 * 1000);
  }

  get(id: string, callback: (error: unknown, session?: SessionData | null) => void) {
    void prisma.session.findUnique({ where: { id } }).then(async (record) => {
      if (!record) return callback(null, null);
      if (record.expiresAt <= new Date()) {
        await prisma.session.deleteMany({ where: { id } });
        return callback(null, null);
      }
      callback(null, JSON.parse(record.data));
    }).catch((error) => callback(error));
  }

  set(id: string, data: SessionData, callback: Done = () => {}) {
    const values = { data: JSON.stringify(data), expiresAt: this.expiry(data) };
    void prisma.session.upsert({ where: { id }, create: { id, ...values }, update: values })
      .then(() => callback()).catch(callback);
  }

  destroy(id: string, callback: Done = () => {}) {
    void prisma.session.deleteMany({ where: { id } }).then(() => callback()).catch(callback);
  }

  touch(id: string, data: SessionData, callback: Done = () => {}) {
    void prisma.session.updateMany({ where: { id }, data: { expiresAt: this.expiry(data) } })
      .then(() => callback()).catch(callback);
  }
}
