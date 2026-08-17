// Vercel serverless entry point — every request under /api/* is routed here
// (catch-all filename convention) and handed straight to the same Express
// app used by the standalone dev/production Node server (server.ts). Vercel
// invokes this module's default export as a plain (req, res) handler, which
// an Express app satisfies directly — no adapter needed.
//
// Static assets and all non-/api SPA routes are served by Vercel's own
// static hosting per vercel.json, not by this function — this app only
// registers /api/* routes (see server/app.ts), so nothing else reaches it.
import { createApiApp } from "../server/app.js";

const app = createApiApp();

export default app;
