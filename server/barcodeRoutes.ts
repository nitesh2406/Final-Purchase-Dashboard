import { Router } from "express";
import { productMasterStore } from "./productMasterStore.js";
import { requireSession } from "./authMiddleware.js";

// Backs the Receive Shipment scanner's product lookup + duplicate-EAN
// safety check. Search/duplicate-check stay unauthenticated, same as this
// app's other read-only Apps Script calls (callGas) — they fire on every
// barcode scan and aren't sensitive. Settings writes and the alert email are
// gated behind requireSession since they change who gets notified.
export const barcodeRouter = Router();

barcodeRouter.post("/search", async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "");
    if (!identifier) {
      res.status(400).json({ error: "identifier is required." });
      return;
    }
    const product = await productMasterStore.searchProduct(identifier);
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }
    res.json(product);
  } catch (error: any) {
    console.error("[barcode/search] failed:", error);
    res.status(500).json({ error: error.message || "Product lookup failed." });
  }
});

barcodeRouter.post("/check-ean-duplicates", async (req, res) => {
  try {
    const sku = String(req.body?.sku || "");
    if (!sku) {
      res.status(400).json({ error: "sku is required." });
      return;
    }
    const products = await productMasterStore.findDuplicates(sku);
    res.json({ isDuplicate: products.length > 1, products });
  } catch (error: any) {
    console.error("[barcode/check-ean-duplicates] failed:", error);
    res.status(500).json({ error: error.message || "Duplicate check failed." });
  }
});

barcodeRouter.get("/settings", async (req, res) => {
  try {
    res.json(await productMasterStore.getSettings());
  } catch (error: any) {
    console.error("[barcode/settings GET] failed:", error);
    res.status(500).json({ error: error.message || "Failed to load settings." });
  }
});

barcodeRouter.put("/settings", requireSession, async (req, res) => {
  try {
    const { eanDuplicateEmails } = req.body || {};
    if (!Array.isArray(eanDuplicateEmails)) {
      res.status(400).json({ error: "eanDuplicateEmails must be an array." });
      return;
    }
    await productMasterStore.saveSettings(eanDuplicateEmails.map(String));
    res.json({ saved: true });
  } catch (error: any) {
    console.error("[barcode/settings PUT] failed:", error);
    res.status(500).json({ error: error.message || "Failed to save settings." });
  }
});

barcodeRouter.post("/send-duplicate-ean-email", requireSession, async (req, res) => {
  try {
    const { duplicates, module: moduleName } = req.body || {};
    if (!Array.isArray(duplicates) || duplicates.length === 0) {
      res.status(400).json({ error: "duplicates array is required." });
      return;
    }
    await productMasterStore.sendDuplicateEanEmail(duplicates, moduleName || "Receive Shipment");
    res.json({ sent: true });
  } catch (error: any) {
    console.error("[barcode/send-duplicate-ean-email] failed:", error);
    res.status(500).json({ error: error.message || "Failed to send alert email." });
  }
});
