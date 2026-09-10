/**
 * App-wide manual refresh.
 *
 * The header's reload button has no idea which hooks are mounted on the current
 * page, so hooks that own cached data register here and get called when the
 * user asks for fresh numbers. `refreshAll` drops the persistent cache first,
 * so a listener that reads through it can't be handed back what it just
 * invalidated.
 */

import { clearMarketCache } from './marketCache';

type RefreshListener = () => void | Promise<unknown>;

const listeners = new Set<RefreshListener>();

let lastRefreshedAt: number | null = null;

/** Registers a listener and returns its unsubscribe — call it from an effect
 * cleanup so unmounted pages stop being refreshed. */
export function onRefresh(listener: RefreshListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Clears cached market data and asks every registered listener to refetch.
 * Resolves once they have all settled, so the caller can show progress.
 */
export async function refreshAll(): Promise<void> {
  clearMarketCache();
  await Promise.allSettled([...listeners].map((listener) => listener()));
  lastRefreshedAt = Date.now();
}

export function getLastRefreshedAt(): number | null {
  return lastRefreshedAt;
}
