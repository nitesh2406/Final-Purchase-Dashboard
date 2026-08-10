// Reads the server session token minted at login (see LoginPage.tsx /
// server/session.ts) for calls to routes that now require it:
// /api/apps-script-proxy and the Drive upload routes.
export function getSessionAuthHeaders(): Record<string, string> {
  try {
    const stored = localStorage.getItem('auth_user');
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed?.sessionToken) return {};
    return { Authorization: `Bearer ${parsed.sessionToken}` };
  } catch {
    return {};
  }
}
