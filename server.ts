import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dns from "dns";
import { GoogleGenAI } from "@google/genai";
import { driveRouter } from "./server/driveRoutes";

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON and text bodies
  app.use(express.json({ limit: '10mb' }));
  app.use(express.text({ limit: '10mb' }));

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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
  app.post("/api/apps-script-proxy", async (req, res) => {
    try {
      const { url, method, headers, body, payload } = req.body;
      if (!url) {
        res.status(400).json({ error: "Missing required 'url' parameter in proxy body." });
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
