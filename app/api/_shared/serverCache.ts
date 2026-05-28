type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const serverCache = new Map<string, CacheEntry<unknown>>();
const serverCacheInflight = new Map<string, Promise<unknown>>();
const serverCacheInvalidationVersions = new Map<string, number>();
let serverCacheInvalidationVersion = 0;

const getInvalidationVersionForKey = (key: string) => {
  let version = 0;
  for (const [prefix, prefixVersion] of serverCacheInvalidationVersions) {
    if (key.startsWith(prefix)) {
      version = Math.max(version, prefixVersion);
    }
  }
  return version;
};

export async function getOrSetServerCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<{ value: T; hit: boolean }> {
  const now = Date.now();
  const cached = serverCache.get(key);
  if (cached && cached.expiresAt > now) {
    return {
      value: cached.value as T,
      hit: true
    };
  }

  const pending = serverCacheInflight.get(key);
  if (pending) {
    return {
      value: (await pending) as T,
      hit: true
    };
  }

  const request = loader();
  const invalidationVersion = getInvalidationVersionForKey(key);
  serverCacheInflight.set(key, request as Promise<unknown>);

  try {
    const value = await request;
    if (getInvalidationVersionForKey(key) === invalidationVersion) {
      serverCache.set(key, {
        value,
        expiresAt: Date.now() + Math.max(0, ttlMs)
      });
    }
    return {
      value,
      hit: false
    };
  } finally {
    serverCacheInflight.delete(key);
  }
}

export function invalidateServerCacheByPrefix(prefix: string) {
  serverCacheInvalidationVersion += 1;
  serverCacheInvalidationVersions.set(prefix, serverCacheInvalidationVersion);

  for (const key of serverCache.keys()) {
    if (key.startsWith(prefix)) {
      serverCache.delete(key);
    }
  }

  for (const key of serverCacheInflight.keys()) {
    if (key.startsWith(prefix)) {
      serverCacheInflight.delete(key);
    }
  }
}
