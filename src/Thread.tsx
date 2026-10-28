import { useEffect, useRef } from 'react'
import type { AgentStatus } from './Composer'
import { Link } from './Icons'
import { getModel, MEDIA_LABEL } from './models'
import type { Step, Turn } from './types'

interface Props {
  turns: Turn[]
  status: AgentStatus
  onInterrupt: () => void
  onSuggest: (text: string) => void
  team: string[]
}

const SUGGESTIONS = [
  'Remix: an identity for a design bookshop and café. I love Paula Scher and Dieter Rams',
  'Where did Hayao Miyazaki steal from?',
  'A poster for a jazz night, then animate it',
  'A 3D cat',
]
const CARD_LABEL: Record<string, string> = { reference: 'Reference', direction: 'Direction', voice: 'Studio voice' }

/** The conversation, laid out like a chat: your lines in bubbles, the agent's as plain text with what it put on the table. */
export default function Thread({ turns, status, onInterrupt, onSuggest, team }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: 1e9, behavior: 'smooth' })
  }, [turns, status])

  if (!turns.length && status === 'idle') {
    return (
      <div className="thread empty-thread">
        <h1>What are we making?</h1>
        <div className="suggestions">
          {(team.length ? [SUGGESTIONS[0], 'Ask the studio: how do we make a bike shop unforgettable?', ...SUGGESTIONS.slice(2)] : SUGGESTIONS).map((s) => (
            <button key={s} onClick={() => onSuggest(s)}>{s}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="thread" ref={ref}>
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <div key={i} className="msg user">
            <div className="bubble">{t.text}</div>
          </div>
        ) : (
          <div key={i} className="msg assistant">
            {t.steps?.length ? <Tool steps={t.steps} /> : null}
            <div className="reply">{t.text.replace(/\n\(added:.*\)$/, '')}</div>
          </div>
        ),
      )}
      {status === 'thinking' && (
        <div className="msg assistant">
          <span className="dot" />
        </div>
      )}
      {status === 'speaking' && (
        <button className="speaking" onClick={onInterrupt}>
          <span className="eq"><i /><i /><i /></span> Speaking · tap to stop
        </button>
      )}
    </div>
  )
}

/** "Searched for flights"-style block: what went on the table and with which models. */
function Tool({ steps }: { steps: Step[] }) {
  const counts = new Map<string, number>()
  for (const s of steps) counts.set(s.card ?? s.kind, (counts.get(s.card ?? s.kind) ?? 0) + s.count)
  const summary = [...counts].map(([k, n]) => `${n} ${plural(CARD_LABEL[k] ?? (MEDIA_LABEL as Record<string, string>)[k] ?? k, n)}`).join(' · ')
  const models = [...new Set(steps.map((s) => s.model).filter(Boolean))] as string[]
  const first = steps.find((s) => s.kind !== 'note')?.prompt ?? steps.find((s) => !s.card)?.prompt ?? ''
  return (
    <div className="tool">
      <div className="tool-h">Put on the table</div>
      <div className="tool-t">{summary}</div>
      {first && <div className="tool-s">{first}</div>}
      {models.length > 0 && (
        <div className="chips">
          {models.map((m) => (
            <span key={m} className="chip">
              <Link /> {getModel(m)?.label.replace(/\s*\(.*\)$/, '') ?? m}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function plural(label: string, n: number) {
  const l = label.toLowerCase()
  return n === 1 ? l : l.endsWith('s') ? l : `${l}s`
}
