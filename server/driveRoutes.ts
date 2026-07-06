import { Router } from "express";
import multer from "multer";
import { driveStorageService, ConflictStrategy } from "./driveStorageService";
import { getOAuth2Client } from "./driveClient";

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB per file
});

export const driveRouter = Router();

// One-time, admin-only setup: grants this app Drive access under the target
// owner's account. Not linked from the regular dashboard UI.
driveRouter.get("/oauth/authorize", (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: DRIVE_SCOPES
    });
    res.redirect(url);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

driveRouter.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send("Missing 'code' query parameter");
      return;
    }

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      res.status(200).send(
        "Authorized, but Google did not return a refresh token (it only returns one the " +
        "first time consent is granted). Revoke this app's access at " +
        "https://myaccount.google.com/permissions and retry /api/drive/oauth/authorize."
      );
      return;
    }

    console.log(`[Drive OAuth] Refresh token obtained: ${tokens.refresh_token}`);
    console.log("[Drive OAuth] Copy this value into GOOGLE_DRIVE_REFRESH_TOKEN and restart the server.");

    res.status(200).send(
      "Drive access authorized. The refresh token has been printed to the server log — " +
      "copy it into the GOOGLE_DRIVE_REFRESH_TOKEN environment variable and restart the server. " +
      "This page intentionally does not display the token."
    );
  } catch (error: any) {
    console.error("[Drive OAuth] Callback failed:", error);
    res.status(500).json({ error: error.message });
  }
});

driveRouter.post("/upload-shipment-docs", upload.array("files"), async (req, res) => {
  try {
    const { batchId, shipmentId, vendorCode } = req.body || {};
    if (!batchId) {
      res.status(400).json({ error: "batchId is required" });
      return;
    }
    if (!shipmentId) {
      res.status(400).json({ error: "shipmentId is required" });
      return;
    }

    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    let conflictResolutions: Record<string, ConflictStrategy> = {};
    if (req.body.conflictResolutions) {
      try {
        conflictResolutions = JSON.parse(req.body.conflictResolutions);
      } catch {
        res.status(400).json({ error: "conflictResolutions must be valid JSON" });
        return;
      }
    }

    console.log(
      `[Drive Upload] shipment=${shipmentId} batch=${batchId} vendor=${vendorCode || "?"} files=${files.length}`
    );

    const shipmentFolder = await driveStorageService.getOrCreateShipmentFolder(batchId, shipmentId);

    const results = await Promise.allSettled(
      files.map(file =>
        driveStorageService.uploadFile({
          folderId: shipmentFolder.folderId,
          fileName: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
          onConflict: conflictResolutions[file.originalname] || "ask"
        })
      )
    );

    const files_ = results.map((result, idx) => {
      if (result.status === "fulfilled") return result.value;
      return { status: "failed" as const, fileName: files[idx].originalname, error: result.reason?.message || "Unknown error" };
    });

    res.json({
      success: true,
      folder: shipmentFolder,
      files: files_
    });
  } catch (error: any) {
    console.error("[Drive Upload] Failed:", error);
    res.status(500).json({ success: false, error: error.message || "Drive upload failed" });
  }
});
