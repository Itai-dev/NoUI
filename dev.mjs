// Dev server and build, using esbuild directly.
//   node dev.mjs          -> serve on http://localhost:5173 with live reload and a key proxy
//   node dev.mjs --build  -> production bundle in www/assets
//
// Keys: put ANTHROPIC_API_KEY and FAL_KEY in a .env file next to this script (see .env.example).
// The browser never sees them: calls go to /api/anthropic and /api/fal here and are forwarded with the key.
import * as esbuild from 'esbuild'
import { readFileSync } from 'node:fs'
import http from 'node:http'

const build = process.argv.includes('--build')
const port = Number(process.env.PORT || 5173)
const innerPort = port + 1000

// ---------- .env ----------
const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* no .env: keys can still be entered in the app */
}
const ANTHROPIC = env.ANTHROPIC_API_KEY || ''
const FAL = env.FAL_KEY || ''

const options = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'esm',
  outdir: 'www/assets',
  jsx: 'automatic',
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  sourcemap: !build,
  minify: build,
  define: { 'process.env.NODE_ENV': JSON.stringify(build ? 'production' : 'development') },
  // Reload the page whenever a rebuild finishes.
  banner: build ? {} : { js: `new EventSource('/esbuild').addEventListener('change', () => location.reload());` },
  logLevel: 'info',
}

if (build) {
  await esbuild.build(options)
  process.exit(0)
}

const ctx = await esbuild.context(options)
await ctx.watch()
await ctx.serve({ servedir: 'www', port: innerPort, fallback: 'www/index.html' })

// Headers that must not be copied between the browser and the upstream API.
const HOP = new Set(['host', 'connection', 'content-length', 'origin', 'referer', 'cookie', 'accept-encoding', 'x-fal-target-url', 'x-api-key', 'authorization'])

async function forward(req, res, url, extraHeaders) {
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v
  Object.assign(headers, extraHeaders)
  const hasBody = !['GET', 'HEAD'].includes(req.method)
  let upstream
  try {
    upstream = await fetch(url, { method: req.method, headers, body: hasBody ? req : undefined, duplex: 'half' })
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `Upstream unreachable: ${err.message}` }))
    return
  }
  const out = {}
  upstream.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k)) out[k] = v
  })
  res.writeHead(upstream.status, out)
  if (!upstream.body) return res.end()
  for await (const chunk of upstream.body) res.write(chunk)
  res.end()
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`)

  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(JSON.stringify({ anthropic: !!ANTHROPIC, fal: !!FAL }))
  }

  if (url.pathname.startsWith('/api/anthropic/')) {
    if (!ANTHROPIC) return deny(res, 'No ANTHROPIC_API_KEY on the server')
    const target = 'https://api.anthropic.com/' + url.pathname.slice('/api/anthropic/'.length) + url.search
    return forward(req, res, target, { 'x-api-key': ANTHROPIC })
  }

  if (url.pathname === '/api/fal') {
    if (!FAL) return deny(res, 'No FAL_KEY on the server')
    const target = req.headers['x-fal-target-url']
    let host = ''
    try {
      host = new URL(String(target)).hostname
    } catch {
      /* invalid */
    }
    if (!/\.(fal\.ai|fal\.run)$/.test(host) && host !== 'fal.run') return deny(res, 'Not a fal.ai URL', 400)
    return forward(req, res, String(target), { authorization: `Key ${FAL}` })
  }

  // Everything else: the esbuild dev server (assets, live reload, SPA fallback)
  const proxyReq = http.request({ hostname: 'localhost', port: innerPort, path: req.url, method: req.method, headers: req.headers }, (inner) => {
    res.writeHead(inner.statusCode, inner.headers)
    inner.pipe(res, { end: true })
  })
  proxyReq.on('error', () => {
    res.writeHead(502)
    res.end('dev server not ready')
  })
  req.pipe(proxyReq, { end: true })
})

function deny(res, message, status = 401) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'proxy', message } }))
}

server.listen(port, () => {
  console.log(`\n  Atelier running at http://localhost:${port}`)
  console.log(`  Keys: Anthropic ${ANTHROPIC ? 'yes' : 'no'} · fal.ai ${FAL ? 'yes' : 'no'}${ANTHROPIC && FAL ? '' : '  (add them to .env, see .env.example)'}\n`)
})
