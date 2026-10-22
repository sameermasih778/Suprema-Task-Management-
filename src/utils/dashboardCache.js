/**
 * In-Memory Stale-While-Revalidate (SWR) cache for workspace and dashboard data.
 *
 * Prevents redundant round-trips to the remote Supabase (PostgreSQL) database when navigating
 * between dashboard tabs (Overview, Tasks, Projects, Calendar, Analytics, Teams).
 *
 * Data is rendered instantly (0ms) from cache, while a silent background sync keeps
 * everything up-to-date without flashing loading spinners or clearing screen state.
 */

const cacheStore = new Map();
const FRESH_TTL_MS = 20 * 1000;   // Data younger than 20s skips network entirely unless forced
const MAX_AGE_MS = 10 * 60 * 1000; // Data older than 10m is discarded

/**
 * Get cached dashboard summary for a workspace
 * @param {string|number} workspaceId
 * @returns {{ data: object, isFresh: boolean } | null}
 */
export function getDashboardCache(workspaceId) {
  if (!workspaceId) return null;
  const entry = cacheStore.get(`ws_summary_${workspaceId}`);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > MAX_AGE_MS) {
    cacheStore.delete(`ws_summary_${workspaceId}`);
    return null;
  }

  return {
    data: entry.data,
    isFresh: age < FRESH_TTL_MS,
    timestamp: entry.timestamp
  };
}

/**
 * Save dashboard summary into cache
 * @param {string|number} workspaceId
 * @param {object} data
 */
export function setDashboardCache(workspaceId, data) {
  if (!workspaceId || !data) return;
  cacheStore.set(`ws_summary_${workspaceId}`, {
    data,
    timestamp: Date.now()
  });

  // Also cache individual collections so standalone pages can read them instantly
  if (Array.isArray(data.projects)) {
    setWorkspaceCollection(workspaceId, 'projects', data.projects);
  }
  if (Array.isArray(data.tasks)) {
    setWorkspaceCollection(workspaceId, 'tasks', data.tasks);
  }
  if (Array.isArray(data.teams)) {
    setWorkspaceCollection(workspaceId, 'teams', data.teams);
  }
}

/**
 * Get an individual collection (e.g. 'projects', 'tasks', 'members')
 */
export function getWorkspaceCollection(workspaceId, collectionKey) {
  if (!workspaceId || !collectionKey) return null;
  const entry = cacheStore.get(`ws_${workspaceId}_${collectionKey}`);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > MAX_AGE_MS) {
    cacheStore.delete(`ws_${workspaceId}_${collectionKey}`);
    return null;
  }

  return {
    data: entry.data,
    isFresh: age < FRESH_TTL_MS,
    timestamp: entry.timestamp
  };
}

/**
 * Store an individual collection
 */
export function setWorkspaceCollection(workspaceId, collectionKey, data) {
  if (!workspaceId || !collectionKey) return;
  cacheStore.set(`ws_${workspaceId}_${collectionKey}`, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate cache for a workspace (e.g. after task/project creation, update, or deletion)
 */
export function invalidateWorkspaceCache(workspaceId) {
  if (!workspaceId) {
    cacheStore.clear();
    return;
  }

  const prefix = `ws_${workspaceId}`;
  const summaryKey = `ws_summary_${workspaceId}`;

  cacheStore.delete(summaryKey);
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}
