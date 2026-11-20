import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../config/env.js";

export type RealtimeEvent =
  | { kind: "session-ended"; sessionId: string }
  | { kind: "move"; roomId: number; userId: string; x: number; y: number; at: string }
  | { kind: "gathering"; roomId: number }
  | { kind: "lease"; userId: string; roomId: number; token?: string; invalidatedToken?: string }
  | { kind: "pvp" | "pvp-chat"; code: string }
  | { kind: "pvp-lobby" };

/** PostgreSQL notifications relay small events across Railway replicas. */
export class RealtimeBus extends EventEmitter {
  private id = randomUUID();
  private connection: pg.Client | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  active = false;
  constructor() { super(); this.setMaxListeners(0); }
  async start() {
    if (this.connection || this.stopped) return;
    const connection = new pg.Client({ connectionString: env.databaseUrl });
    this.connection = connection;
    const disconnected = () => {
      if (this.connection !== connection) return;
      this.connection = null; this.active = false; this.emit("health", false);
      void connection.end().catch(() => {});
      if (!this.stopped && !this.retry) {
        this.retry = setTimeout(() => { this.retry = undefined; void this.start(); }, 3000);
        this.retry.unref();
      }
    };
    connection.on("error", disconnected); connection.on("end", disconnected);
    connection.on("notification", message => {
      try {
        const packet = JSON.parse(message.payload ?? "");
        if (packet.source !== this.id && packet.event) this.emit("event", packet.event);
      } catch { /* Ignore malformed notifications from outside this service. */ }
    });
    try {
      await connection.connect(); await connection.query("LISTEN idleon_realtime");
      if (this.connection === connection) { this.active = true; this.emit("health", true); }
    } catch { disconnected(); }
  }
  publish(event: RealtimeEvent) {
    this.emit("event", event);
    if (this.active && this.connection) void this.connection.query("SELECT pg_notify($1, $2)", ["idleon_realtime", JSON.stringify({ source: this.id, event })]).catch(() => {});
  }
  async stop() {
    this.stopped = true; clearTimeout(this.retry);
    const connection = this.connection; this.connection = null; this.active = false;
    if (connection) await connection.end().catch(() => {});
  }
}
export const realtimeBus = new RealtimeBus();
