import type { CSSProperties } from 'react'

export interface BracketProps {
  className?: string
  style?: CSSProperties
}

export function Bracket({ className = '', style }: BracketProps) {
  return (
    <span className={`app-bracket ${className}`} style={style} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  )
}
