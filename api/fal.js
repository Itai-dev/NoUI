import { deny, forward, isFalUrl } from './_proxy.js'

/** fal.ai proxy: the @fal-ai/client sends the real URL in x-fal-target-url. */
function handler(request) {
  const key = process.env.FAL_KEY
  if (!key) return deny('No FAL_KEY on the server')
  const target = request.headers.get('x-fal-target-url')
  if (!isFalUrl(target)) return deny('Not a fal.ai URL', 400)
  return forward(request, String(target), { authorization: `Key ${key}` })
}

// Vercel runs Web-standard (Request -> Response) handlers only through method exports.
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE }
