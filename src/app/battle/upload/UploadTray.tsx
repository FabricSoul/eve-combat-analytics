import type { UploadedLogSummary } from '@/core/contract'
import { fmtHms, fmtNum } from '../../lib/format'
import { Portrait } from '../../ui/Portrait'
import { Button } from '../../ui/Button'
import { Tag } from '../../ui/Tag'
import { Icon, statusIcon } from './icons'
import { failureStatuses, summarizeQueue, type UploadItem } from './queue'
import './upload.css'

const failureLabel: Record<string, string> = {
  no_overlap: '时间对不上',
  not_a_gamelog: '不是战斗日志',
  unknown_character: '查不到角色',
  too_large: '文件太大',
  failed: '上传失败',
}

const kb = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const language = { zh: '中文客户端', en: '英文客户端' } as const

function span(log: UploadedLogSummary): string | null {
  return log.first != null && log.last != null ? `${fmtHms(log.first)}–${fmtHms(log.last)}` : null
}

function detail(item: UploadItem, logCorrected: (log: UploadedLogSummary) => boolean) {
  const { status, log } = item
  switch (status) {
    case 'queued': return '排队中'
    case 'uploading': return `上传中 · ${kb(item.size * item.progress)} / ${kb(item.size)}`
    case 'parsing': return '解析中'
    case 'duplicate': return `和已上传的 ${item.duplicateOf} 完全相同，跳过`
    case 'done': {
      if (!log) return null
      const parts = [`${fmtNum(log.events)} 条`, span(log), log.language && log.language !== 'unknown' ? language[log.language] : null]
      return <>{parts.filter(Boolean).join(' · ')}{logCorrected(log) && <> <Tag>据日志</Tag></>}</>
    }
    default: return `${failureLabel[status]}：${item.message ?? ''}`
  }
}

export interface UploadTrayProps {
  items: readonly UploadItem[]
  onRemove?(id: number): void
  /** True when the log's side was corrected from log evidence. */
  logCorrected?(log: UploadedLogSummary): boolean
}

export function UploadTray({ items, onRemove, logCorrected = () => false }: UploadTrayProps) {
  const counts = summarizeQueue({ items: [...items], nextId: 0 })
  const header = [
    counts.done > 0 && `${counts.done} 完成`,
    counts.active > 0 && `${counts.active} 进行中`,
    counts.attention > 0 && `${counts.attention} 需要处理`,
  ].filter(Boolean).join(' · ')
  return (
    <section className="upload-tray" aria-label="上传">
      <header className="upload-tray-head">
        <span>上传 · <span className="app-number">{items.length}</span> 个文件</span>
        <span className="upload-tray-counts">{header}</span>
      </header>
      <div className="upload-rows" role="list">
        {items.map((item) => {
          const failed = failureStatuses.includes(item.status)
          return (
            <div className="upload-row" role="listitem" key={item.id} data-status={item.status}>
              <span className="upload-icon" data-failed={failed || undefined}><Icon name={statusIcon[item.status]} /></span>
              <div className="upload-main">
                <div className="upload-title">
                  <span className="upload-file" title={item.name}>{item.name}</span>
                  <span className="upload-size app-number">{kb(item.size)}</span>
                </div>
                <div className="upload-detail">
                  {item.demo && <><Tag>示例</Tag>{' '}</>}
                  {item.log && <Portrait charId={item.log.charId} size={16} />}
                  {item.log && <b>{item.log.charName}</b>}
                  {item.log && ' · '}
                  {detail(item, logCorrected)}
                </div>
                {(item.status === 'uploading' || item.status === 'parsing') && (
                  <div className="upload-progress" role="progressbar" aria-label={item.status === 'parsing' ? '解析中' : '上传进度'}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.status === 'uploading' ? Math.round(item.progress * 100) : undefined}
                    data-indeterminate={item.status === 'parsing' || undefined}>
                    <i style={item.status === 'uploading' ? { width: `${Math.round(item.progress * 100)}%` } : undefined} />
                  </div>
                )}
              </div>
              {failed && onRemove ? <Button className="upload-remove" onClick={() => onRemove(item.id)}>移除</Button> : <span />}
            </div>
          )
        })}
      </div>
    </section>
  )
}
