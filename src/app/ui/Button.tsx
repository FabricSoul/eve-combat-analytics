import type { ComponentPropsWithRef } from 'react'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: 'default' | 'primary' | 'ghost'
}

export function Button({ variant = 'default', type = 'button', className = '', ...props }: ButtonProps) {
  return <button {...props} type={type} className={`app-button ${className}`} data-variant={variant} />
}
