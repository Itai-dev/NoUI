// Copies ANTHROPIC_API_KEY and FAL_KEY from the local .env into the linked Vercel project
// (production, preview and development) without printing the values.
//   node scripts/vercel-env.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
for (const key of ['ANTHROPIC_API_KEY', 'FAL_KEY']) {
  if (!env[key]) {
    console.log(`${key}: not in .env, skipped`)
    continue
  }
  for (const target of ['production', 'preview', 'development']) {
    const r = spawnSync(npx, ['--yes', 'vercel@65.4.0', 'env', 'add', key, target, '--force', '--sensitive'], { input: env[key], encoding: 'utf8', shell: true })
    const out = (r.stdout + r.stderr).split('\n').filter((l) => l.trim() && !l.includes('Vercel CLI')).slice(-1)[0] ?? ''
    console.log(`${key} (${target}): ${r.status === 0 ? 'set' : 'failed'} ${out.replace(env[key], '***').trim()}`)
  }
}
