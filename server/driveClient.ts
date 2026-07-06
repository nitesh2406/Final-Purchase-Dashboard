import { google } from "googleapis";

// Lazy singleton, mirrors the getAiClient() pattern in server.ts.
// Safe to cache in-memory: this server runs as a persistent Node process
// (npm start -> node dist/server.cjs), not as stateless serverless functions.
let driveClient: ReturnType<typeof google.drive> | null = null;

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI environment variables are required for Drive access"
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getDriveClient() {
  if (!driveClient) {
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error(
        "GOOGLE_DRIVE_REFRESH_TOKEN environment variable is not set. " +
        "Complete the one-time authorization at GET /api/drive/oauth/authorize first."
      );
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    // google-auth-library transparently refreshes the access token on every
    // API call using this refresh token — no manual refresh logic needed.

    driveClient = google.drive({ version: "v3", auth: oauth2Client });
  }
  return driveClient;
}
