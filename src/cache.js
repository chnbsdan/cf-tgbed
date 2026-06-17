/**
 * 缓存管理模块
 */

const CACHE = caches.default;

export function getCacheMaxAge(url) {
  const ext = (url.split('.').pop() || '').toLowerCase();
  const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'icon', 'bmp'];
  const videoTypes = ['mp4', 'webm', 'avi', 'mov'];
  const audioTypes = ['mp3', 'wav', 'ogg'];
  
  if (imageTypes.includes(ext)) return 31536000; // 1年
  if (videoTypes.includes(ext)) return 2592000;  // 30天
  if (audioTypes.includes(ext)) return 2592000;  // 30天
  return 86400; // 1天
}

export async function getFromCache(key) {
  const request = new Request(key);
  return await CACHE.match(request);
}

export async function saveToCache(key, response, maxAge = 86400) {
  const cacheKey = new Request(key);
  const cachedResponse = new Response(response.body, {
    headers: {
      ...response.headers,
      'Cache-Control': `public, max-age=${maxAge}`
    }
  });
  await CACHE.put(cacheKey, cachedResponse.clone());
  return cachedResponse;
}

export async function deleteFromCache(key) {
  const cacheKey = new Request(key);
  await CACHE.delete(cacheKey);
}

export function createCacheHeaders(maxAge) {
  return {
    'Cache-Control': `public, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*'
  };
}
