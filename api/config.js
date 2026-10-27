import { json } from './_proxy.js'

/** Tells the app which keys the server holds, never the keys themselves. */
export function GET() {
  return json({ anthropic: !!process.env.ANTHROPIC_API_KEY, fal: !!process.env.FAL_KEY })
}
