import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { hasFal, transcribe, type Settings } from './ai'
import type { Turn } from './types'

export type AgentStatus = 'idle' | 'thinking' | 'speaking'

export interface ComposerHandle {
  listen: () => void
  stopListening: () => void
  focus: () => void
}

interface Props {
  settings: Settings
  status: AgentStatus
  talk: boolean // conversation mode: keep listening after each reply
  setTalk: (v: boolean) => void
  turns: Turn[]
  onSend: (text: string) => void
  onInterrupt: () => void // user started talking/typing while the agent speaks
  onError: (msg: string) => void
  onOpenSettings: () => void
}

type SR = { start(): void; stop(): void; abort(): void } & EventTarget
const SpeechRecognitionCtor: (new () => SR & Record<string, unknown>) | undefined =
  (window as unknown as { SpeechRecognition?: new () => SR & Record<string, unknown>; webkitSpeechRecognition?: new () => SR & Record<string, unknown> }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SR & Record<string, unknown> }).webkitSpeechRecognition

/** The one line of input: type it, or say it. */
const Composer = forwardRef<ComposerHandle, Props>(function Composer({ settings, status, talk, setTalk, turns, onSend, onInterrupt, onError, onOpenSettings }, ref) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const srRef = useRef<SR | null>(null)
  const srBroken = useRef(false) // the browser's recognizer exists but can't reach its service
  const recRef = useRef<{ rec: MediaRecorder; stop: (cancel: boolean) => void } | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    if (showLog) logRef.current?.scrollTo({ top: 1e9 })
  }, [showLog, turns])

  const send = useCallback(
    (t: string) => {
      const v = t.trim()
      if (!v) return
      setText('')
      onSend(v)
    },
    [onSend],
  )

  // --- Microphone, path B: record, then transcribe with Whisper (needs a fal.ai key) ---
  const startRecorder = useCallback(async () => {
    if (!hasFal(settingsRef.current)) {
      onError('This browser has no speech recognition of its own. Add a fal.ai key and the mic will work through Whisper.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError('Microphone access was blocked.')
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    let cancelled = false
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    let heard = false
    let quietSince = 0
    const started = Date.now()
    const stop = (cancel: boolean) => {
      cancelled = cancel
      window.clearInterval(timer)
      if (rec.state !== 'inactive') rec.stop()
    }
    // Stop by itself after ~1.4s of silence once something was said, or after 30s.
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const d = (v - 128) / 128
        sum += d * d
      }
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      if (rms > 0.02) {
        heard = true
        quietSince = 0
      } else if (heard) {
        quietSince ||= now
        if (now - quietSince > 1400) stop(false)
      }
      if (now - started > 30000) stop(false)
    }, 100)
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      ctx.close()
      recRef.current = null
      setListening(false)
      setInterim('')
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      if (cancelled || blob.size < 1500) return
      setTranscribing(true)
      try {
        const t = await transcribe(settingsRef.current, blob)
        if (t) send(t)
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      } finally {
        setTranscribing(false)
      }
    }
    recRef.current = { rec, stop }
    rec.start()
    setListening(true)
    setInterim('')
  }, [onError, send])

  // --- Microphone, path A: the browser's own recognizer (live words as you speak) ---
  const listen = useCallback(() => {
    if (srRef.current || recRef.current) return
    onInterrupt()
    if (!SpeechRecognitionCtor || srBroken.current) {
      startRecorder()
      return
    }
    const r = new SpeechRecognitionCtor()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    let final = ''
    let fallingBack = false
    r.onresult = (e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      let interimText = ''
      final = ''
      for (const res of Array.from(e.results)) {
        if (res.isFinal) final += res[0].transcript
        else interimText += res[0].transcript
      }
      setInterim(final + interimText)
    }
    r.onerror = (e: { error: string }) => {
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) {
        srBroken.current = true
        fallingBack = true
        srRef.current = null
        startRecorder()
      }
    }
    r.onend = () => {
      if (fallingBack) return
      srRef.current = null
      setListening(false)
      setInterim('')
      if (final.trim()) send(final)
    }
    srRef.current = r
    setListening(true)
    r.start()
  }, [onInterrupt, send, startRecorder])

  const stopListening = useCallback(() => {
    srRef.current?.stop()
    recRef.current?.stop(false)
  }, [])

  useImperativeHandle(ref, () => ({ listen, stopListening, focus: () => inputRef.current?.focus() }), [listen, stopListening])

  // Conversation mode: turning it on starts listening right away
  const toggleTalk = () => {
    const next = !talk
    setTalk(next)
    if (next) listen()
    else {
      srRef.current?.abort()
      recRef.current?.stop(true)
    }
  }

  const last = [...turns].reverse().find((t) => t.role === 'assistant')
  const statusText = transcribing ? 'Transcribing…' : listening ? interim || 'Listening…' : status === 'thinking' ? 'Thinking…' : status === 'speaking' ? 'Speaking… click to interrupt' : ''

  return (
    <div className="composer">
      {(last || statusText) && (
        <div className={`ribbon ${status} ${listening ? 'listening' : ''}`} onClick={() => (status === 'speaking' ? onInterrupt() : setShowLog((v) => !v))}>
          {statusText && (
            <span className="ribbon-status">
              {listening && <Waves />}
              {status === 'thinking' && <span className="spinner" />}
              {statusText}
            </span>
          )}
          {last && !listening && <span className="ribbon-reply">✦ {last.text.split('\n')[0]}</span>}
          {!statusText && turns.length > 1 && <span className="ribbon-more">{showLog ? 'hide' : 'history'}</span>}
        </div>
      )}
      {showLog && (
        <div className="log" ref={logRef}>
          {turns.map((t, i) => (
            <div key={i} className={`turn ${t.role}`}>{t.text}</div>
          ))}
        </div>
      )}
      <div className={`line ${listening ? 'is-listening' : ''}`}>
        <button className="icon settings-btn" title="Settings" onClick={onOpenSettings}>⚙</button>
        <input
          ref={inputRef}
          autoFocus
          value={text}
          placeholder={talk ? 'Conversation on. Just talk, or type.' : 'Say or type what to make… e.g. "a poster for a jazz night, then animate it"'}
          onChange={(e) => {
            setText(e.target.value)
            if (status === 'speaking') onInterrupt()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(text)
            if (e.key === 'Escape') inputRef.current?.blur()
            e.stopPropagation()
          }}
        />
        <button
          className={`icon mic ${listening ? 'on' : ''}`}
          title={listening ? 'Stop listening' : 'Hold a thought: click and speak'}
          onClick={() => (listening ? stopListening() : listen())}
          disabled={transcribing}
        >
          {listening ? '■' : '🎙'}
        </button>
        <button className={`icon talk ${talk ? 'on' : ''}`} title={talk ? 'Conversation mode on: I keep listening after each reply' : 'Conversation mode: talk back and forth'} onClick={toggleTalk}>
          🗣
        </button>
        <button className="send" disabled={!text.trim() || status === 'thinking'} onClick={() => send(text)} title="Send (Enter)">↑</button>
      </div>
    </div>
  )
})

function Waves() {
  return (
    <span className="waves">
      <i /><i /><i /><i />
    </span>
  )
}

export default Composer
