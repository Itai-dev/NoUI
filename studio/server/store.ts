// Durable project storage on the local filesystem.
//
//   <data>/projects/<id>/project.json   the whole project state
//   <data>/projects/<id>/files/*        media: generated outputs, references, assembled films
//
// One Node process owns the data. Every change is made synchronously on the in-memory
// project and written with an atomic rename, so a crash never leaves a half-written file
// and two requests can never interleave inside a budget check.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { Project } from '../shared/types.ts'

/** Server-only bookkeeping stored next to the project, never sent to the browser. */
export interface Stored extends Project {
  /** Idempotency keys of accepted run requests. */
  idem: string[]
  /** fal storage URLs of local files already uploaded as references. */
  uploads: Record<string, { url: string; at: number }>
}

export const DATA_DIR = path.resolve(process.env.STUDIO_DATA_DIR || '.data/studio')
const PROJECTS = path.join(DATA_DIR, 'projects')

const cache = new Map<string, Stored>()

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
export const now = () => new Date().toISOString()

export const projectDir = (id: string) => path.join(PROJECTS, id)
export const filesDir = (id: string) => path.join(PROJECTS, id, 'files')
export const fileUrl = (projectId: string, file: string) => `/api/studio/files/${projectId}/${file}`
/** Absolute path of an asset URL made by fileUrl. */
export function filePath(projectId: string, url: string): string {
  return path.join(filesDir(projectId), path.basename(url))
}

export function loadAll(): Stored[] {
  mkdirSync(PROJECTS, { recursive: true })
  for (const id of readdirSync(PROJECTS)) {
    const file = path.join(PROJECTS, id, 'project.json')
    if (!existsSync(file)) continue
    try {
      const p = JSON.parse(readFileSync(file, 'utf8')) as Stored
      p.idem ??= []
      p.uploads ??= {}
      cache.set(p.id, p)
    } catch (err) {
      console.error(`  Studio: could not read ${file}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return [...cache.values()]
}

export const all = () => [...cache.values()]
export const get = (id: string) => cache.get(id)

export function save(p: Stored): void {
  p.updatedAt = now()
  mkdirSync(filesDir(p.id), { recursive: true })
  const file = path.join(projectDir(p.id), 'project.json')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(p, null, 1))
  renameSync(tmp, file)
  cache.set(p.id, p)
}

export function remove(id: string): void {
  cache.delete(id)
  rmSync(projectDir(id), { recursive: true, force: true })
}

export function writeFile(projectId: string, name: string, data: Buffer | string): string {
  mkdirSync(filesDir(projectId), { recursive: true })
  writeFileSync(path.join(filesDir(projectId), name), data)
  return fileUrl(projectId, name)
}
