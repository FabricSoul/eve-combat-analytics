import { Button } from '../ui/Button'

export interface SidesPanelProps {
  onClose?(): void
}

export function SidesPanel({ onClose }: SidesPanelProps) {
  return (
    <div className="app-placeholder">
      排边
      {onClose && <Button onClick={onClose}>完成</Button>}
    </div>
  )
}
