// Serves the photos in the R2 bucket at a plain workers.dev address (no domain needed).
// Only "GET /l/<lot>/<name>.jpg" and "GET /a/<lot>/<name>.jpg" are answered ("l/" expires by an R2 rule, "a/" has none); nothing can be listed or uploaded through this Worker.
// Responses are cached at Cloudflare's edge, so most views never reach R2 at all.
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })

    const key = decodeURIComponent(new URL(request.url).pathname.slice(1))
    if (!/^[la]\/[a-z0-9]+\/[a-z0-9_]+\.jpg$/.test(key)) return new Response('Not found', { status: 404 })

    const cache = caches.default
    const hit = await cache.match(request)
    if (hit) return hit

    const obj = await env.PHOTOS.get(key)
    if (!obj) return new Response('Not found', { status: 404 })

    const res = new Response(request.method === 'HEAD' ? null : obj.body, {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=604800',
        'access-control-allow-origin': '*',
        etag: obj.httpEtag,
      },
    })
    if (request.method === 'GET') ctx.waitUntil(cache.put(request, res.clone()))
    return res
  },
}
