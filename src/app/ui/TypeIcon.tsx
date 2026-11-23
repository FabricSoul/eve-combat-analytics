import { typeIconUrl } from '../lib/images'

export interface TypeIconProps {
  typeId: number | null
  size: number
  className?: string
}

export function TypeIcon({ typeId, size, className = '' }: TypeIconProps) {
  const classes = `app-image app-type-icon ${className}`
  if (typeId === null) return <span className={classes} style={{ width: size, height: size }} aria-hidden="true" />
  return <img className={classes} src={typeIconUrl(typeId, size)} width={size} height={size} alt="" loading="lazy" />
}
