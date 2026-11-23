import { Button } from '../ui/Button'

export interface EmptyBattleProps {
  onUpload?(): void
}

export function EmptyBattle({ onUpload }: EmptyBattleProps) {
  return (
    <div className="app-placeholder">
      等待上传日志
      {onUpload && <Button onClick={onUpload}>上传日志</Button>}
    </div>
  )
}
