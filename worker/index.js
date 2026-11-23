// Relay for data services that do not allow calls from a web page (no CORS header).
//
// The builder's in-browser Python runs in the page, so it can only read another site's API when that
// site allows it. The Global Wind Atlas map API does not, so windkit's get_vector_map asks this
// same-origin path instead. Everything else on the site is static and never reaches this script
// (wrangler.jsonc sends only /relay/* here).
//
// Only the routes listed below are relayed: GET only, no cookies or credentials either way,
// small responses cached at Cloudflare's edge for a day.

const ROUTES = {
  // windkit.get_vector_map: CORINE land cover polygons as GeoJSON for a bounding box
  gwa: { origin: 'https://api.globalwindatlas.info', paths: [/^\/qgis-data\/v1\/corine_2018$/], params: ['points_str'], maxBytes: 40e6 },
};

const json = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/relay\/(\w+)(\/.*)$/);
    if (!url.pathname.startsWith('/relay/')) return env.ASSETS.fetch(request);
    const route = m && ROUTES[m[1]];
    if (!route) return json(404, 'No relay with this name.');
    if (request.method !== 'GET') return json(405, 'Only GET requests are relayed.');
    if (!route.paths.some(re => re.test(m[2]))) return json(404, 'This path is not relayed.');
    for (const k of url.searchParams.keys()) if (!route.params.includes(k)) return json(400, `Query parameter ${k} is not relayed.`);
    if (url.search.length > 4000) return json(414, 'Query too long.');

    const target = route.origin + m[2] + url.search;
    const cache = caches.default, key = new Request(target);
    let res = await cache.match(key);
    if (!res) {
      let up;
      try { up = await fetch(target, { headers: { accept: 'application/json' }, cf: { cacheTtl: 86400 } }); }
      catch (e) { return json(502, `Could not reach ${route.origin}: ${e.message}`); }
      const len = Number(up.headers.get('content-length') || 0);
      if (len > route.maxBytes) return json(413, 'The response is too large to relay. Use a smaller area.');
      res = new Response(up.body, { status: up.status, headers: {
        'content-type': up.headers.get('content-type') || 'application/json',
        'cache-control': up.ok ? 'public, max-age=86400' : 'no-store',
        'x-relayed-from': route.origin,
      } });
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
