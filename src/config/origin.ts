import { env } from "./env.js";

export function isAllowedOrigin(value?: string) {
  if (!value) return false;
  if (value === env.corsOrigin) return true;
  if (env.nodeEnv === "production") return false;
  try {
    const url = new URL(value), host = url.hostname;
    const octets = host.split(".").map(Number);
    const privateIp = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || octets[0] === 127);
    return url.origin === value && url.protocol === "http:" && url.port === new URL(env.corsOrigin).port && (host === "localhost" || privateIp);
  } catch { return false; }
}
