// Vercel serverless entry point. vercel.json rewrites every /api/* request
// to this single function ("/api/(.*)" -> "/api"); Vercel still hands the
// function the request's original req.url (the rewrite only selects which
// function handles it, it doesn't replace the URL the handler sees), so
// Express's own internal router correctly dispatches based on the real
// path (e.g. /api/drive/upload-shipment-docs) exactly as it does locally.
//
// This is the standard, documented pattern for running an Express app on
// Vercel — a bare [...path].ts catch-all filename was tried first and,
// empirically on this project, only matched 0- and 1-segment /api paths
// (Vercel's own routing 404'd anything deeper before reaching this file).
//
// Static assets and all non-/api SPA routes are served by Vercel's own
// static hosting per vercel.json, not by this function — this app only
// registers /api/* routes (see server/app.ts), so nothing else reaches it.
import { createApiApp } from "../server/app.js";

const app = createApiApp();

export default app;
