// Shared by the Vercel functions in this folder and by dev.mjs locally.
// Forwards a browser request to an upstream API with the server's key attached.
// Files starting with "_" are not deployed as functions.

const DROP = new Set(['host', 'connection', 'content-length', 'origin', 'referer', 'cookie', 'accept-encoding', 'x-fal-target-url', 'x-api-key', 'authorization', 'forwarded', 'x-real-ip'])

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

export function deny(message, status = 401) {
  return json({ error: { type: 'proxy', message } }, status)
}

export function isFalUrl(target) {
  let host = ''
  try {
    host = new URL(String(target)).hostname
  } catch {
    return false
  }
  return /\.(fal\.ai|fal\.run)$/.test(host) || host === 'fal.run'
}

/** @param {Request} request */
export async function forward(request, target, extraHeaders) {
  const headers = new Headers()
  request.headers.forEach((v, k) => {
    if (!DROP.has(k) && !k.startsWith('x-vercel-') && !k.startsWith('x-forwarded-')) headers.set(k, v)
  })
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
  const method = request.method
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()
  let upstream
  try {
    upstream = await fetch(target, { method, headers, body })
  } catch (err) {
    return json({ error: `Upstream unreachable: ${err.message}` }, 502)
  }
  const out = new Headers()
  upstream.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k)) out.set(k, v)
  })
  return new Response(upstream.body, { status: upstream.status, headers: out })
}
