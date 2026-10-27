import { deny, forward } from '../_proxy.js'

/** Anthropic proxy: /api/anthropic/v1/messages -> https://api.anthropic.com/v1/messages */
export default function handler(request) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return deny('No ANTHROPIC_API_KEY on the server')
  const url = new URL(request.url)
  const rest = url.pathname.replace(/^\/api\/anthropic\/?/, '')
  return forward(request, 'https://api.anthropic.com/' + rest + url.search, { 'x-api-key': key })
}
