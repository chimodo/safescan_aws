import { ScanResult } from './types';

const makeCacheKey = (url: string) =>
  new Request(`https://safescan-cache.internal/${encodeURIComponent(url)}`);

export async function getCached(url: string): Promise<ScanResult | null> {
  try {
    const cacheKey = makeCacheKey(url);
    const cached = await caches.default.match(cacheKey);
    if (!cached) return null;
    const data = (await cached.json()) as ScanResult;
    return data;
  } catch (err) {
    return null;
  }
}

export async function setCached(url: string, result: ScanResult, ttl: number): Promise<void> {
  try {
    const cacheKey = makeCacheKey(url);
    const responseToCache = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    });
    await caches.default.put(cacheKey, responseToCache);
  } catch (err) {
    // swallow cache errors
  }
}
