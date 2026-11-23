import type { ComponentPropsWithoutRef } from 'react'

export type TagProps = ComponentPropsWithoutRef<'span'>

export function Tag({ className = '', ...props }: TagProps) {
  return <span {...props} className={`app-tag ${className}`} />
}
