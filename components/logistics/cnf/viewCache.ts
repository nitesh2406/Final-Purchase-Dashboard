// The last data each CNF view loaded, kept for the browser session. Leaving
// the CNF tab unmounts it (App renders one page at a time), so without this
// every return showed "Loading…" until 4-7 Apps Script calls came back. A view
// starts from its cached data and reloads in the background.
const store = new Map<string, unknown>();

export function readViewCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function writeViewCache<T>(key: string, value: T): void {
  store.set(key, value);
}
