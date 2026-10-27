/** Small line icons in the ChatGPT style (1.8px strokes, round caps). */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function Menu() {
  return (
    <svg {...base}>
      <path d="M4 7h16M4 12h10M4 17h16" />
    </svg>
  )
}
export function Plus() {
  return (
    <svg {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
export function Mic() {
  return (
    <svg {...base}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}
export function Waves() {
  return (
    <svg {...base} strokeWidth={2.2}>
      <path d="M5 10v4M9 7v10M12 4v16M15 8v8M19 10v4" />
    </svg>
  )
}
export function ArrowUp() {
  return (
    <svg {...base} strokeWidth={2.2}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}
export function NewChat() {
  return (
    <svg {...base}>
      <path d="M12 20a8 8 0 1 0-7.1-4.3L4 20l4.3-.9A8 8 0 0 0 12 20z" />
    </svg>
  )
}
export function Chevron() {
  return (
    <svg {...base} width={14} height={14}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
export function Stop() {
  return (
    <svg {...base} fill="currentColor" stroke="none">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}
export function Link() {
  return (
    <svg {...base} width={12} height={12} strokeWidth={2.4}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  )
}
