import { portraitUrl } from '../lib/images'

export interface PortraitProps {
  charId: number | null
  size: number
  className?: string
}

export function Portrait({ charId, size, className = '' }: PortraitProps) {
  const classes = `app-image app-portrait ${className}`
  if (charId === null) return <span className={classes} style={{ width: size, height: size }} aria-hidden="true" />
  return <img className={classes} src={portraitUrl(charId, size)} width={size} height={size} alt="" loading="lazy" />
}
