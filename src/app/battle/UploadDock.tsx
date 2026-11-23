import type { Ref } from 'react'

export interface UploadDockProps {
  pickerRef?: Ref<HTMLInputElement>
}

export function UploadDock({ pickerRef }: UploadDockProps) {
  return (
    <div className="app-placeholder">
      上传日志
      <input type="file" ref={pickerRef} hidden multiple accept=".txt,text/plain" />
    </div>
  )
}
