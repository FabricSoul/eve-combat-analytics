// The first row is a real log of J125990 (fixtures/real/j125990-20250622): its name, pilot, events, span, language and
// decompressed byte count (upload-log-sizes.json, from export-upload-sizes.mjs). Every other row is a state built to
// show the design and is marked 示例: progress values, "same as" matches and failures are simulated. The time-mismatch
// row mirrors the c3-spec board (a 2026-11-21 log of the author); the other failure names are invented.
import { useReducer } from 'react'
import { UploadTray } from '../../battle/upload/UploadTray'
import { queueReducer, type UploadItem } from '../../battle/upload/queue'
import { loadUiFixture } from '../../test/ui-fixture'
import sizes from './upload-log-sizes.json'

const realSize = (name: string) => (sizes as Record<string, number>)[name] ?? 0

function demoItems(): UploadItem[] {
  const logs = loadUiFixture().summary.logs
  const done = logs[0]!
  const demo = (id: number, name: string, size: number, patch: Partial<UploadItem>): UploadItem =>
    ({ id, name, size, status: 'queued', progress: 0, demo: true, ...patch })
  const other = (index: number) => logs[index]?.id ?? `${index}.txt`
  return [
    { id: 1, name: done.id, size: realSize(done.id), status: 'done', progress: 1, log: done },
    demo(2, other(1), realSize(other(1)), { status: 'parsing', progress: 1 }),
    demo(3, other(2), realSize(other(2)), { status: 'uploading', progress: 0.32 }),
    demo(4, other(3), realSize(other(3)), {}),
    demo(5, other(4), realSize(other(4)), { status: 'duplicate', duplicateOf: other(5) }),
    demo(6, '20261121_075605_2117232295.txt', 1013, {
      status: 'no_overlap', message: '这份日志是 2026-11-21 的，这场战斗在 2025-06-22 15:00–18:00',
    }),
    demo(7, '2025-06-22_chat_Local.txt', 41_000, { status: 'not_a_gamelog', message: '没有 “Gamelog” 文件头' }),
    demo(8, '20250622_150000_1.txt', 2200, { status: 'unknown_character', message: '没有找到名为 Listener 的角色' }),
    demo(9, 'archive.txt', 12_000_000, { status: 'too_large', message: '文件超过 10 MB，不是单场战斗日志' }),
    demo(10, '20250622_151500_2117427381.txt', 80_000, { status: 'failed', message: '无法连接到服务器' }),
  ]
}

function UploadDockSection() {
  const [queue, dispatch] = useReducer(queueReducer, undefined, () => ({ items: demoItems(), nextId: 11 }))
  const { analysis } = loadUiFixture()
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)', alignItems: 'flex-start' }}>
      <UploadTray items={queue.items} onRemove={(id) => dispatch({ type: 'remove', id })}
        logCorrected={(log) => analysis.sideOverrides.some(({ subject }) => subject === `char:${log.charId}`)} />
      <div className="upload-drop" style={{ width: 360, height: 200 }}>
        <b>松手上传</b>
        <span>全页拖放覆盖层里的放置框（拖文件到页面上时出现）</span>
      </div>
    </div>
  )
}

export default { title: '上传', order: 81, Component: UploadDockSection }
