import { useState } from 'react'
import { getMind, MAX_TEAM, MINDS, PRESETS, type Mind } from './minds'

/** Two letters, so Dalí and Duchamp don't share a "D". */
const initials = (m: Mind) => {
  const words = m.short.replace(/^The /, '').split(/\s+/)
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 2) : words[0].slice(0, 2)
}

export function Avatar({ mind, size = 26 }: { mind: Mind; size?: number }) {
  return (
    <span className="avatar" style={{ background: mind.color, width: size, height: size, fontSize: size * 0.4 }} title={mind.name}>
      {initials(mind)}
    </span>
  )
}

/** The header button: the team's faces, or a plain label when nobody is in the room. */
export function Studio({ ids }: { ids: string[] }) {
  const minds = ids.map(getMind).filter((m): m is Mind => !!m)
  if (!minds.length) return <span className="studio-empty">Studio</span>
  return (
    <span className="avatars">
      {minds.map((m) => (
        <Avatar key={m.id} mind={m} />
      ))}
    </span>
  )
}

/** Pick up to four creative minds from history to work alongside the agent. */
export default function StudioModal({ value, onSave, onClose }: { value: string[]; onSave: (ids: string[]) => void; onClose: () => void }) {
  const [team, setTeam] = useState(value)
  const toggle = (id: string) =>
    setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length < MAX_TEAM ? [...t, id] : t))
  const fields = [...new Set(MINDS.map((m) => m.field))]
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal studio" onClick={(e) => e.stopPropagation()}>
        <h2>Your studio</h2>
        <p className="muted">
          Bring up to {MAX_TEAM} creative minds into the room. Each one reacts to your project through their own way of seeing. You can also ask about anyone else by name.
        </p>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.label} className={p.ids.join() === team.join() ? 'on' : ''} onClick={() => setTeam(p.ids)}>
              {p.label}
            </button>
          ))}
          {team.length > 0 && (
            <button className="ghost" onClick={() => setTeam([])}>
              Clear
            </button>
          )}
        </div>
        <div className="minds">
          {fields.map((f) => (
            <div key={f} className="field">
              <div className="field-h">{f}</div>
              {MINDS.filter((m) => m.field === f).map((m) => {
                const on = team.includes(m.id)
                return (
                  <button key={m.id} className={`mind ${on ? 'on' : ''}`} disabled={!on && team.length >= MAX_TEAM} onClick={() => toggle(m.id)}>
                    <Avatar mind={m} size={30} />
                    <span className="mind-t">
                      <strong>
                        {m.name} <span className="years">{m.years}</span>
                      </strong>
                      <span>{m.lens}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="row end">
          <span className="grow muted">{team.length ? `${team.length} of ${MAX_TEAM} in the room` : 'Nobody in the room yet'}</span>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(team)}>Save</button>
        </div>
      </div>
    </div>
  )
}
