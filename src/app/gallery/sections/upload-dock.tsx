// Real files from fixtures/real/j125990-20250622 (names, sizes, events, spans); the failure rows' file names are
// examples, as on the c3-spec board: the time mismatch is the author's local 2026-11-21 log, "not a gamelog" is invented.
import { UploadTray } from '../../battle/upload/UploadTray'
import type { UploadItem } from '../../battle/upload/queue'
import { loadUiFixture } from '../../test/ui-fixture'

function UploadDockSection() {
  const logs = loadUiFixture().summary.logs
  const done = logs[0]!
  const row = (id: number, name: string, size: number, patch: Partial<UploadItem>): UploadItem =>
    ({ id, name, size, status: 'queued', progress: 0, ...patch })
  const items: UploadItem[] = [
    row(1, done.id, 1_270_000, { status: 'done', progress: 1, log: done }),
    row(2, logs[1]?.id ?? 'b.txt', 910_000, { status: 'parsing', progress: 1, log: undefined }),
    row(3, logs[2]?.id ?? 'c.txt', 2_400_000, { status: 'uploading', progress: 0.32 }),
    row(4, logs[3]?.id ?? 'd.txt', 380_000, {}),
    row(5, logs[4]?.id ?? 'e.txt', 640_000, { status: 'duplicate', duplicateOf: logs[5]?.id ?? 'f.txt' }),
    row(6, '20261121_075605_2117232295.txt', 1013, {
      status: 'no_overlap', message: '这份日志是 2026-11-21 的，这场战斗在 2025-06-22 15:00–18:00',
    }),
    row(7, '2025-06-22_chat_Local.txt', 41_000, { status: 'not_a_gamelog', message: '没有 “Gamelog” 文件头（示例）' }),
    row(8, '20250622_150000_1.txt', 2200, { status: 'unknown_character', message: '没有找到名为 Listener 的角色（示例）' }),
    row(9, 'archive.txt', 12_000_000, { status: 'too_large', message: '文件超过 10 MB，不是单场战斗日志' }),
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)', alignItems: 'flex-start' }}>
      <UploadTray items={items} onRemove={() => undefined} logCorrected={(log) => log.id === done.id} />
      <div className="upload-drop" style={{ width: 360, height: 200 }}>
        <b>松手上传</b>
        <span>全页拖放覆盖层里的放置框（拖文件到页面上时出现）</span>
      </div>
    </div>
  )
}

export default { title: '上传', order: 81, Component: UploadDockSection }
