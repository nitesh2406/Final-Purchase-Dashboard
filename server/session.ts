import crypto from "crypto";

// Signs lightweight, stateless session tokens for authenticated server.ts
// routes. Google ID tokens (from Sign-In) expire in ~1hr, but the app's own
// session model (see App.tsx's 8hr countdown) expects a signed-in user to
// stay authenticated for 8hrs without re-prompting Google. So we verify the
// Google ID token once, at login, then mint our own longer-lived token here.
//
// No new dependency: HMAC-SHA256 via Node's built-in crypto.
//
// SESSION_SECRET should be set in the environment for production so sessions
// survive server restarts/redeploys. If unset, a random secret is generated
// per process boot — sessions still work, they just all invalidate on the
// next restart (forcing re-login), which is a safe default, not a bug.
const SECRET = process.env.SESSION_SECRET || (() => {
  const generated = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[session] SESSION_SECRET is not set — using a random per-boot secret. " +
    "Sessions will not survive a server restart. Set SESSION_SECRET in the " +
    "environment to avoid forcing all users to re-login on every deploy."
  );
  return generated;
})();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // matches App.tsx's 8hr session window

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

// Payload is base64url-encoded JSON before signing, so a '.' in the email
// address (extremely common — every real email has one) can never be
// confused with the payload/signature delimiter.
export function issueSessionToken(email: string): { token: string; exp: number } {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString("base64url");
  const sig = sign(payload);
  return { token: `${payload}.${sig}`, exp };
}

export function verifySessionToken(token: string): { email: string } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = sign(payload);
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof email !== "string" || !Number.isFinite(exp) || Date.now() > exp) return null;
    return { email };
  } catch {
    return null;
  }
}
