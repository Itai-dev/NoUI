import { deny, forward } from './_proxy.js'

/**
 * Anthropic proxy: /api/anthropic/v1/messages -> https://api.anthropic.com/v1/messages
 * vercel.json rewrites /api/anthropic/:path* here with the path in ?path=.
 */
function handler(request) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return deny('No ANTHROPIC_API_KEY on the server')
  const url = new URL(request.url)
  const rest = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/anthropic\/?/, '')
  url.searchParams.delete('path')
  return forward(request, 'https://api.anthropic.com/' + rest.replace(/^\/+/, '') + url.search, { 'x-api-key': key })
}

// Vercel runs Web-standard (Request -> Response) handlers only through method exports.
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
