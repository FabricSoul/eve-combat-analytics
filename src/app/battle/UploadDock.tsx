import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type Ref } from 'react'
import { api } from '../api/client'
import { useBattleContext } from '../state/battle-store'
import { collectFiles, hasFiles } from './upload/files'
import { Icon } from './upload/icons'
import { initialQueue, queueReducer } from './upload/queue'
import { describeLog, runUpload, sha256Hex } from './upload/runner'
import { UploadTray } from './upload/UploadTray'
import type { UploadedLogSummary } from '@/core/contract'
import './upload/upload.css'

export interface UploadDockProps {
  pickerRef?: Ref<HTMLInputElement>
}

export function UploadDock({ pickerRef }: UploadDockProps) {
  const { summary, analysis } = useBattleContext()
  const brId = summary?.meta.brId
  const [queue, dispatch] = useReducer(queueReducer, initialQueue)
  const [dragging, setDragging] = useState(false)
  const latest = useRef({ queue, summary })
  latest.current = { queue, summary }
  const started = useRef(new Set<number>())
  const depth = useRef(0)

  // The File travels inside the same reducer action as its row, so ids are allocated once, in order.
  const enqueue = useCallback((list: readonly File[]) => {
    if (list.length > 0) dispatch({ type: 'add', files: list.map((file) => ({ name: file.name, size: file.size, file })) })
  }, [])

  useEffect(() => {
    function enter(event: DragEvent) {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current += 1
      setDragging(true)
    }
    function over(event: DragEvent) {
      if (!hasFiles(event.dataTransfer)) return
      event.preventDefault()
    }
    function leave(event: DragEvent) {
      if (!dragging && depth.current === 0) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0 || event.relatedTarget === null) {
        depth.current = 0
        setDragging(false)
      }
    }
    function drop(event: DragEvent) {
      if (!event.dataTransfer || !hasFiles(event.dataTransfer)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      void collectFiles(event.dataTransfer).then(({ files, problems }) => {
        enqueue(files)
        if (problems.length > 0) dispatch({ type: 'reject', problems })
      })
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [dragging, enqueue])

  // One file at a time: the Worker parses each log inside the battle's single Durable Object.
  const next = queue.items.find(({ status }) => status === 'queued')
  const busy = queue.items.some(({ status }) => status === 'uploading' || status === 'parsing')
  useEffect(() => {
    if (!next || busy || !brId || started.current.has(next.id)) return
    started.current.add(next.id)
    const { id, name, size, file } = next
    if (!file) {
      dispatch({ type: 'start', id })
      dispatch({ type: 'fail', id, status: 'failed', message: '找不到这个文件，请重新添加' })
      return
    }
    void runUpload({
      id, name, size,
      readText: () => file.text(),
      sha256: sha256Hex,
      knownLogs: () => {
        const known = new Map<string, string>()
        for (const log of latest.current.summary?.logs ?? []) known.set(log.id, describeLog(log))
        for (const item of latest.current.queue.items) if (item.log) known.set(item.log.id, item.name)
        return known
      },
      uploadLog: (text, onProgress) => api.uploadLog(brId, text, onProgress),
      dispatch,
    })
  }, [next, busy, brId])

  function pick(event: ChangeEvent<HTMLInputElement>) {
    enqueue(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const corrected = (log: UploadedLogSummary) =>
    analysis?.sideOverrides.some(({ subject }) => subject === `char:${log.charId}`) ?? false

  return (
    <>
      <input type="file" ref={pickerRef} hidden multiple accept=".txt,text/plain" onChange={pick} />
      {dragging && (
        <div className="upload-overlay" aria-hidden="true">
          <div className="upload-drop">
            <Icon name="fileDown" size={28} />
            <b>松手上传</b>
            <span>可以一次拖整个文件夹；不在这场时间段的文件会提示并可移除</span>
          </div>
        </div>
      )}
      {queue.items.length > 0 && (
        <UploadTray items={queue.items} logCorrected={corrected} onRemove={(id) => dispatch({ type: 'remove', id })} />
      )}
    </>
  )
}
