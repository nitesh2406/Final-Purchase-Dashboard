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

// Who to record as the actor on writes that go straight to Apps Script
// (edited_by / updated_by / created_by ...), so the Audit Log and the sheets'
// last-edited columns name a real person instead of the literal 'user'.
//
// This is CLIENT-DECLARED, not verified — those calls bypass the proxy, so
// anything a caller sends is taken at face value. Fine for an audit trail
// people read; NOT something to base an authorization decision on. Anything
// that must be trusted (e.g. admin-only resolves) goes through callGasAuthed,
// where the proxy stamps the session-verified email server-side.
export function getCurrentActor(): string {
  try {
    const stored = localStorage.getItem('auth_user');
    if (!stored) return 'unknown';
    const parsed = JSON.parse(stored);
    return String(parsed?.email || parsed?.name || 'unknown');
  } catch {
    return 'unknown';
  }
}
