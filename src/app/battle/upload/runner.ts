import type { UploadedLogSummary, UploadResult } from '@/core/contract'
import { fmtDate, fmtHms } from '../../lib/format'
import { ApiFailure } from '../../api/client'
import type { FailureStatus, QueueAction } from './queue'

/** Mirrors the Worker's body limit (10 MiB); checking here avoids reading a file that cannot be accepted. */
export const maxUploadBytes = 10 * 1024 * 1024

export interface RunUploadDeps {
  id: number
  name: string
  size: number
  readText(): Promise<string>
  /** Lowercase hex sha256 of the text (the log id), or null when crypto is unavailable. */
  sha256(text: string): Promise<string | null>
  /** Log id → what to call it in the "same as" message. */
  knownLogs(): ReadonlyMap<string, string>
  /** The battle's windows, for explaining a log that does not overlap them. */
  windows?(): readonly { start: number; end: number }[]
  uploadLog(text: string, onProgress?: (fraction: number) => void): Promise<UploadResult>
  dispatch(action: QueueAction): void
}

/** How a log already in the battle is named in the "same as" message: pilot plus the time span it covers. */
export function describeLog(log: Pick<UploadedLogSummary, 'charName' | 'first' | 'last'>): string {
  const span = log.first != null && log.last != null ? `（${fmtHms(log.first)}–${fmtHms(log.last)}）` : ''
  return `${log.charName} 的日志${span}`
}

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const tooLarge = (size: number) => `文件 ${(size / 1048576).toFixed(1)} MB，超过上限 ${maxUploadBytes / 1048576} MB`

/** Just enough of a Gamelog to explain a rejection: listener, session start and the first/last combat line. */
export function readLogFacts(text: string) {
  const listener = /^\s*(?:Listener|收听者)\s*[:：]\s*(.+?)\s*$/m.exec(text)?.[1]
  const stamp = /^\s*(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
  const toTime = (value: string | undefined) => {
    const match = value ? stamp.exec(value) : null
    return match ? Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!, +match[6]!) : null
  }
  const session = toTime(/^\s*(?:Session Started|进程开始|会话开始)\s*[:：]\s*(.+?)\s*$/m.exec(text)?.[1])
  const times = Array.from(text.matchAll(/^\[ ?([\d.]+ [\d:]+) ?\]\s*\(combat\)/gm), (m) => toTime(m[1])).filter((t): t is number => t !== null)
  return { listener, session, first: times.length ? Math.min(...times) : null, last: times.length ? Math.max(...times) : null }
}

const sameDay = (a: number, b: number) => fmtDate(a) === fmtDate(b)

function noOverlapMessage(text: string, windows: readonly { start: number; end: number }[]) {
  const { session, first, last } = readLogFacts(text)
  const logStart = first ?? session
  const log = logStart === null ? '这份日志' : first !== null && last !== null
    ? `这份日志是 ${fmtDate(first)} ${fmtHms(first)}${sameDay(first, last) ? `–${fmtHms(last)}` : `–${fmtDate(last)} ${fmtHms(last)}`} 的`
    : `这份日志是 ${fmtDate(logStart)} 的`
  if (windows.length === 0) return `${log}，不在这场战斗的时间内`
  const start = Math.min(...windows.map((w) => w.start))
  const end = Math.max(...windows.map((w) => w.end))
  const hm = (t: number) => fmtHms(t).slice(0, 5)
  const range = sameDay(start, end) ? `${fmtDate(start)} ${hm(start)}–${hm(end)}` : `${fmtDate(start)} ${hm(start)}–${fmtDate(end)} ${hm(end)}`
  return `${log}，这场战斗在 ${range}`
}

export async function runUpload({ id, size, readText, sha256, knownLogs, windows, uploadLog, dispatch }: RunUploadDeps): Promise<void> {
  dispatch({ type: 'start', id })
  const fail = (status: FailureStatus, message: string, detail?: string) =>
    dispatch(detail === undefined ? { type: 'fail', id, status, message } : { type: 'fail', id, status, message, detail })
  if (size > maxUploadBytes) return fail('too_large', tooLarge(size))
  let text = ''
  try {
    text = await readText()
    const known = knownLogs()
    const hash = await sha256(text)
    const earlier = hash === null ? undefined : known.get(hash)
    if (earlier !== undefined) return dispatch({ type: 'duplicate', id, of: earlier })
    const log = await uploadLog(text, (fraction) => dispatch({ type: 'progress', id, fraction }))
    const same = known.get(log.id) ?? (log.duplicate ? describeLog(log) : undefined)
    if (same !== undefined) dispatch({ type: 'duplicate', id, of: same })
    else dispatch({ type: 'done', id, log })
  } catch (error) {
    if (error instanceof ApiFailure) {
      switch (error.code) {
        case 'no_overlap': return fail('no_overlap', noOverlapMessage(text, windows?.() ?? []))
        case 'not_a_gamelog': return fail('not_a_gamelog', '这不是 EVE 战斗日志（找不到 Gamelog 文件头）')
        case 'unknown_character': {
          const { listener } = readLogFacts(text)
          return fail('unknown_character', listener ? `查不到日志主人 ${listener} 的角色` : '查不到这份日志主人的角色')
        }
        case 'too_large': return fail('too_large', tooLarge(size))
        default: return fail('failed', '上传失败，请重试', error.code)
      }
    }
    fail('failed', '无法读取这个文件')
  }
}
