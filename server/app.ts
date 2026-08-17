import express from "express";
import dns from "dns";
import { GoogleGenAI } from "@google/genai";
import { driveRouter } from "./driveRoutes.js";
import { requireSession, verifyGoogleIdToken } from "./authMiddleware.js";
import { issueSessionToken } from "./session.js";

// Prefer IPv4 first in DNS resolution to prevent sandboxed environment IPv6 timeout fetch failures
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

let aiClient: any = null;

function getAiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY or API_KEY environment variable is not defined");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// All API routes, with no static/SPA serving and no .listen() — shared between
// the standalone dev/production Node server (server.ts, which adds the
// static/SPA layer on top) and the Vercel serverless entry point
// (api/[...path].ts), which relies on Vercel's own static hosting for
// everything that isn't under /api.
export function createApiApp() {
  const app = express();

  // Middleware to parse JSON and text bodies
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ limit: '10mb' }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Issues a server session token from a fresh Google ID token (see
  // server/session.ts for why: Google ID tokens expire in ~1hr, this app's
  // session model expects 8hrs). Called once right after Google Sign-In
  // succeeds, before the frontend calls any route gated by requireSession.
  app.post("/api/auth/session", async (req, res) => {
    try {
      const { idToken } = req.body || {};
      if (!idToken) {
        res.status(400).json({ error: "Missing idToken" });
        return;
      }
      const email = await verifyGoogleIdToken(idToken);
      if (!email) {
        res.status(401).json({ error: "Invalid Google credential" });
        return;
      }
      const { token, exp } = issueSessionToken(email);
      res.json({ sessionToken: token, exp });
    } catch (error: any) {
      console.error("[auth] /api/auth/session failed:", error);
      res.status(500).json({ error: error.message || "Failed to issue session" });
    }
  });

  // Server-side Gemini API endpoints

  app.post("/api/gemini/insights", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        res.status(400).json({ error: "Missing prompt" });
        return;
      }
      const ai = getAiClient();
      console.log(`[Gemini Server] Requesting insights for: "${prompt}"`);
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: `You are a purchase management expert. Based on the following user query, provide a concise analysis or recommendation. Query: "${prompt}"`,
        config: {
          systemInstruction: "Analyze purchasing data and provide actionable insights for a supply chain manager. Keep responses brief and to the point.",
          temperature: 0.5,
          topP: 0.95,
        }
      });
      res.json({ text: response.text || "No insights could be generated." });
    } catch (error: any) {
      console.error("Error in server-side Gemini insights:", error);
      res.status(500).json({ error: error.message || "An error occurred calling the Gemini API" });
    }
  });

  app.post("/api/gemini/suggest-pricing", async (req, res) => {
    try {
      const { cost, name, category } = req.body;
      const prompt = `As an e-commerce pricing expert for hobbyist products like speed cubes, suggest a competitive Maximum Retail Price (MRP) for the following item. Provide only the numerical value, no currency signs or extra text.
      - Product Name: ${name}
      - Product Category: ${category}
      - Cost Price: $${(cost || 0).toFixed(2)}`;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
          temperature: 0.2,
        }
      });
      const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
      const price = parseFloat(priceText);
      res.json({ price: isNaN(price) ? "Could not determine price." : price });
    } catch (error: any) {
      console.error("Error in server-side Gemini pricing:", error);
      res.status(500).json({ error: error.message || "Pricing error." });
    }
  });

  app.post("/api/gemini/suggest-shopify-price", async (req, res) => {
    try {
      const { landingCost, name, category } = req.body;
      const prompt = `As an e-commerce expert for hobbyist products like speed cubes, suggest a competitive Shopify selling price. The landing cost in INR is provided. Return only a single numerical value, no currency signs or extra text.
      - Product Name: ${name}
      - Product Category: ${category}
      - Landing Cost: ₹${(landingCost || 0).toFixed(2)}`;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
          temperature: 0.2,
        }
      });
      const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
      const price = parseFloat(priceText);
      res.json({ price: isNaN(price) ? "Could not determine Shopify price." : price });
    } catch (error: any) {
      console.error("Error in server-side Gemini Shopify pricing:", error);
      res.status(500).json({ error: error.message || "Shopify pricing error." });
    }
  });

  // Google Drive storage endpoints (Vendor Shipment document uploads)
  app.use("/api/drive", driveRouter);

  // Apps Script Proxy Endpoint
  // Was previously unauthenticated with no URL allowlist — a classic SSRF
  // shape (arbitrary attacker-supplied url/method/headers/body, server-side
  // fetch, response echoed back). Now requires a valid session AND only
  // ever forwards to the app's own configured Apps Script exec URL.
  const ALLOWED_PROXY_URL = process.env.VITE_APPS_SCRIPT_URL || process.env.APPS_SCRIPT_URL;
  app.post("/api/apps-script-proxy", requireSession, async (req, res) => {
    try {
      const { url, method, headers, body, payload } = req.body;
      if (!url) {
        res.status(400).json({ error: "Missing required 'url' parameter in proxy body." });
        return;
      }
      if (!ALLOWED_PROXY_URL || url !== ALLOWED_PROXY_URL) {
        res.status(403).json({ error: "Proxy target not allowlisted." });
        return;
      }

      const actualBody = body !== undefined && body !== null ? body : payload;

      // Prepare request options for server-side fetch
      const fetchOptions: RequestInit = {
        method: method || 'GET',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          ...(headers || {})
        }
      };

      if (actualBody !== undefined && actualBody !== null) {
        fetchOptions.body = typeof actualBody === 'string' ? actualBody : JSON.stringify(actualBody);
      }

      console.log(`[Proxy] Routing ${method || 'GET'} request to ${url}...`);

      const response = await fetch(url, fetchOptions);
      const text = await response.text();

      // Try to parse as JSON to return standard response, or return text directly
      try {
        const jsonData = JSON.parse(text);
        res.status(response.status).json(jsonData);
      } catch (err) {
        res.status(response.status).send(text);
      }
    } catch (error: any) {
      console.error("[Proxy Error] Failed to proxy request to Apps Script:", error);
      res.status(500).json({
        error: "Failed to proxy request to Google Apps Script.",
        details: error.message,
        cause: error.cause ? (error.cause.message || String(error.cause)) : undefined
      });
    }
  });

  return app;
}
