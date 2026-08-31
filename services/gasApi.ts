import { APPS_SCRIPT_URL } from '../constants';
import { getSessionAuthHeaders } from './authToken';

// Calls the GAS backend through /api/apps-script-proxy instead of hitting
// APPS_SCRIPT_URL directly. The proxy (server/app.ts) requires a valid
// session token (requireSession) and stamps the session-verified email onto
// the outgoing payload as user_email, overwriting anything passed here — so
// a caller can't spoof who they are just by editing this payload. Used by
// the Shipment Tracker/Finance merge, where the backend needs to trust the
// caller's identity to decide whether to include finance fields.
//
// Other screens still call APPS_SCRIPT_URL directly (unauthenticated) —
// this helper is scoped to the calls that actually need a verified identity,
// not a blanket replacement.
export async function callGasAuthed(action: string, payload: Record<string, any> = {}): Promise<any> {
  const innerBody = JSON.stringify({ action, ...payload });
  const response = await fetch('/api/apps-script-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getSessionAuthHeaders()
    },
    body: JSON.stringify({
      url: APPS_SCRIPT_URL,
      method: 'POST',
      body: innerBody
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.error || result?.message || `Request failed (${response.status})`);
  }
  return result;
}
