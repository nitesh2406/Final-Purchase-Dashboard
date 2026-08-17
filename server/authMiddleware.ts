import type { Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { verifySessionToken } from "./session.js";

// Client IDs the frontend's Google Sign-In button may run under. Accepts a
// comma-separated ADDITIONAL_GOOGLE_CLIENT_IDS env var so a different client
// ID used in another deploy (e.g. production vs local) doesn't need a code
// change — just an env var. VITE_GOOGLE_CLIENT_ID is read here too since
// dotenv loads the whole .env into this Node process regardless of the
// VITE_ prefix (that prefix only controls what Vite inlines client-side).
function getAllowedAudiences(): string[] {
  const ids = [process.env.VITE_GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_ID]
    .concat((process.env.ADDITIONAL_GOOGLE_CLIENT_IDS || "").split(","))
    .map(s => (s || "").trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

/**
 * Verifies a Google-issued ID token (fresh from Sign-In) and returns the
 * verified email, or null if invalid/expired/wrong audience.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<string | null> {
  const audiences = getAllowedAudiences();
  if (audiences.length === 0) {
    console.error("[auth] No GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_ID configured — cannot verify ID tokens.");
    return null;
  }
  try {
    const client = new google.auth.OAuth2();
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    return payload?.email || null;
  } catch (err: any) {
    console.warn("[auth] Google ID token verification failed:", err.message || err);
    return null;
  }
}

/**
 * Express middleware: requires a valid server-issued session token (see
 * session.ts) in the Authorization header. Attaches req.userEmail on success.
 * This is what protects /api/apps-script-proxy and the Drive upload routes —
 * both were previously reachable by anyone on the internet with no
 * credential at all.
 */
export function requireSession(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header. Sign in and retry." });
    return;
  }
  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: "Session invalid or expired. Please sign in again." });
    return;
  }
  (req as any).userEmail = session.email;
  next();
}
