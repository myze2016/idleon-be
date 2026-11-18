import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { CodeChallengeMethod } from "google-auth-library";
import { googleClient, googlePlayer } from "../services/google-auth.service.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

function loginError(reason: "unavailable" | "failed" | "existing_account") {
  return `${env.corsOrigin}/login?googleError=${reason}`;
}

export const startGoogleLogin: RequestHandler = (req, res, next) => {
  let client;
  try { client = googleClient(); } catch { res.redirect(loginError("unavailable")); return; }
  const state = randomBytes(32).toString("hex"), nonce = randomBytes(32).toString("hex"), verifier = randomBytes(32).toString("base64url");
  const url = client.generateAuthUrl({ scope: ["openid", "email", "profile"], state, nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: CodeChallengeMethod.S256,
    prompt: "select_account" });
  req.session.googleOAuth = { state, nonce, verifier, expiresAt: Date.now() + 10 * 60000 };
  req.session.save((error) => { if (error) return next(error); res.redirect(url); });
};

export const finishGoogleLogin: RequestHandler = async (req, res, next) => {
  const flow = req.session.googleOAuth;
  delete req.session.googleOAuth;
  // Consume OAuth state before exchanging the code, including failed callbacks.
  await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  const { state, code } = req.query;
  if (!flow || flow.expiresAt < Date.now() || typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state) || state.length !== flow.state.length
      || !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state)) || typeof code !== "string" || code.length > 4096 || req.query.error) {
    res.redirect(loginError("failed")); return;
  }
  try {
    const client = googleClient();
    const { tokens } = await client.getToken({ code, codeVerifier: flow.verifier });
    if (!tokens.id_token) throw new HttpError(401, "Google identity token missing");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const user = await googlePlayer(ticket.getPayload(), flow.nonce);
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = user;
      req.session.save((saveError) => { if (saveError) return next(saveError); res.redirect(`${env.corsOrigin}/dashboard`); });
    });
  } catch (error) {
    res.redirect(loginError(error instanceof HttpError && error.status === 409 ? "existing_account" : "failed"));
  }
};
