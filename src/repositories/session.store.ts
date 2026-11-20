import session, { type SessionData } from "express-session";
import { prisma } from "../lib/prisma.js";
import { realtimeBus } from "../services/realtime-bus.js";

type Done = (error?: unknown) => void;

export class PrismaSessionStore extends session.Store {
  private touched = new Map<string, number>();
  private rememberTouch(id: string) {
    if (this.touched.size >= 10000) this.touched.delete(this.touched.keys().next().value!);
    this.touched.set(id, Date.now());
  }
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
      .then(() => { this.rememberTouch(id); callback(); }).catch(callback);
  }

  destroy(id: string, callback: Done = () => {}) {
    this.touched.delete(id);
    void prisma.session.deleteMany({ where: { id } }).then(() => { realtimeBus.publish({ kind: "session-ended", sessionId: id }); callback(); }).catch(callback);
  }

  touch(id: string, data: SessionData, callback: Done = () => {}) {
    // Polling should not write the same session row several times per second.
    // Authentication still reads the database on every request, so revocation
    // and logout are not cached. Expiry is refreshed at most every 30 seconds.
    if (Date.now() - (this.touched.get(id) ?? 0) < 30000) { callback(); return; }
    this.rememberTouch(id);
    void prisma.session.updateMany({ where: { id }, data: { expiresAt: this.expiry(data) } })
      .then(() => callback()).catch(error => { this.touched.delete(id); callback(error); });
  }
}
