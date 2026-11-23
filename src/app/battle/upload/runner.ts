import type { UploadedLogSummary } from '@/core/contract'
import { ApiFailure } from '../../api/client'
import type { FailureStatus, QueueAction } from './queue'

/** Mirrors the Worker's body limit (10 MiB); checking here avoids reading a file that cannot be accepted. */
export const maxUploadBytes = 10 * 1024 * 1024

const serverStatuses: readonly string[] = ['no_overlap', 'not_a_gamelog', 'unknown_character', 'too_large']

export interface RunUploadDeps {
  id: number
  name: string
  size: number
  readText(): Promise<string>
  /** Lowercase hex sha256 of the text (the log id), or null when crypto is unavailable. */
  sha256(text: string): Promise<string | null>
  /** Log id → what to call it in the "same as" message. */
  knownLogs(): ReadonlyMap<string, string>
  uploadLog(text: string, onProgress?: (fraction: number) => void): Promise<UploadedLogSummary>
  dispatch(action: QueueAction): void
}

export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function runUpload({ id, size, readText, sha256, knownLogs, uploadLog, dispatch }: RunUploadDeps): Promise<void> {
  dispatch({ type: 'start', id })
  const fail = (status: FailureStatus, message: string) => dispatch({ type: 'fail', id, status, message })
  if (size > maxUploadBytes) return fail('too_large', '文件超过 10 MB，不是单场战斗日志')
  try {
    const text = await readText()
    const known = knownLogs()
    const hash = await sha256(text)
    const earlier = hash === null ? undefined : known.get(hash)
    if (earlier !== undefined) return dispatch({ type: 'duplicate', id, of: earlier })
    const log = await uploadLog(text, (fraction) => dispatch({ type: 'progress', id, fraction }))
    const same = known.get(log.id)
    if (same !== undefined) dispatch({ type: 'duplicate', id, of: same })
    else dispatch({ type: 'done', id, log })
  } catch (error) {
    if (error instanceof ApiFailure) {
      fail(serverStatuses.includes(error.code) ? error.code as FailureStatus : 'failed', error.message)
    } else {
      fail('failed', '无法读取这个文件')
    }
  }
}
