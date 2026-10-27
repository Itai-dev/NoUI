import { useState } from 'react'
import type { Settings } from './ai'

export default function SettingsModal({ value, onSave, onClose }: { value: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(value)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="muted">The server already holds keys when it shows no demo badge. Keys typed here stay in this browser and go straight to Anthropic and fal.ai. Without any keys the agent runs a simple demo and images are placeholders.</p>
        <label>
          Anthropic API key <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">get one</a>
          <input type="password" value={s.anthropicKey} placeholder="sk-ant-…" onChange={(e) => setS({ ...s, anthropicKey: e.target.value.trim() })} />
        </label>
        <label>
          fal.ai API key (images, video, sound, 3D, microphone, voice) <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">get one</a>
          <input type="password" value={s.falKey} placeholder="key-id:secret" onChange={(e) => setS({ ...s, falKey: e.target.value.trim() })} />
        </label>
        <div className="row">
          <label className="grow">
            Agent model
            <select value={s.claudeModel} onChange={(e) => setS({ ...s, claudeModel: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
            </select>
          </label>
          <label className="grow">
            Thinking effort
            <select value={s.effort} onChange={(e) => setS({ ...s, effort: e.target.value as Settings['effort'] })}>
              <option value="low">Low (fastest)</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.speak} onChange={(e) => setS({ ...s, speak: e.target.checked })} /> Read replies aloud
        </label>
        <div className="row end">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(s)}>Save</button>
        </div>
      </div>
    </div>
  )
}
