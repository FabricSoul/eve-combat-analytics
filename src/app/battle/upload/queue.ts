import type { UploadedLogSummary } from '@/core/contract'

export type FailureStatus = 'no_overlap' | 'not_a_gamelog' | 'unknown_character' | 'too_large' | 'failed'
export type UploadStatus = 'queued' | 'uploading' | 'parsing' | 'done' | 'duplicate' | FailureStatus

export interface UploadItem {
  id: number
  name: string
  size: number
  status: UploadStatus
  /** 0–1 while uploading. */
  progress: number
  log?: UploadedLogSummary
  /** Name (or pilot) of the file this one is identical to. */
  duplicateOf?: string
  message?: string
  /** Technical detail (error code) kept for a tooltip, never as the visible text. */
  detail?: string
  /** Gallery rows built to show a state rather than a real upload. */
  demo?: boolean
  /** The file to upload, kept with its row so a row can never be paired with another batch's file. */
  file?: File
}

export interface QueueState {
  items: UploadItem[]
  nextId: number
}

export type QueueAction =
  | { type: 'add'; files: readonly { name: string; size: number; file?: File }[] }
  /** A dropped entry that could not be read: shown as a failed row with 移除. */
  | { type: 'reject'; problems: readonly { name: string; message: string }[] }
  | { type: 'start'; id: number }
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'done'; id: number; log: UploadedLogSummary }
  | { type: 'duplicate'; id: number; of: string }
  | { type: 'fail'; id: number; status: FailureStatus; message: string; detail?: string }
  | { type: 'remove'; id: number }
  /** The tray's × button: forget every settled row (done, duplicate, failed); queued and active uploads keep going. */
  | { type: 'clearSettled' }

export const initialQueue: QueueState = { items: [], nextId: 1 }

export const failureStatuses: readonly UploadStatus[] = ['no_overlap', 'not_a_gamelog', 'unknown_character', 'too_large', 'failed']
const isActive = (status: UploadStatus) => status === 'uploading' || status === 'parsing'
const isSettled = (status: UploadStatus) => status === 'done' || status === 'duplicate' || failureStatuses.includes(status)

function change(state: QueueState, id: number, allowed: (item: UploadItem) => boolean, patch: (item: UploadItem) => UploadItem): QueueState {
  const item = state.items.find((candidate) => candidate.id === id)
  if (!item || !allowed(item)) return state
  return { ...state, items: state.items.map((candidate) => candidate === item ? patch(item) : candidate) }
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'add': {
      if (action.files.length === 0) return state
      const added = action.files.map(({ name, size, file }, index): UploadItem =>
        ({ id: state.nextId + index, name, size, status: 'queued', progress: 0, file }))
      return { items: [...state.items, ...added], nextId: state.nextId + added.length }
    }
    case 'reject': {
      if (action.problems.length === 0) return state
      const added = action.problems.map(({ name, message }, index): UploadItem =>
        ({ id: state.nextId + index, name, size: 0, status: 'failed', progress: 0, message }))
      return { items: [...state.items, ...added], nextId: state.nextId + added.length }
    }
    case 'start':
      return change(state, action.id, ({ status }) => status === 'queued', (item) => ({ ...item, status: 'uploading', progress: 0 }))
    case 'progress': {
      const fraction = Math.min(1, Math.max(0, action.fraction))
      return change(state, action.id, ({ status }) => status === 'uploading',
        (item) => fraction >= 1 ? { ...item, status: 'parsing', progress: 1 } : { ...item, progress: Math.max(item.progress, fraction) })
    }
    case 'done':
      return change(state, action.id, ({ status }) => isActive(status), (item) => ({ ...item, status: 'done', progress: 1, log: action.log }))
    case 'duplicate':
      return change(state, action.id, ({ status }) => isActive(status), (item) => ({ ...item, status: 'duplicate', duplicateOf: action.of }))
    case 'fail':
      return change(state, action.id, ({ status }) => isActive(status), (item) => ({ ...item, status: action.status, message: action.message, detail: action.detail }))
    case 'clearSettled': {
      const items = state.items.filter(({ status }) => !isSettled(status))
      return items.length === state.items.length ? state : { ...state, items }
    }
    case 'remove': {
      const item = state.items.find(({ id }) => id === action.id)
      // Settled non-success rows can be dismissed; done rows stay as the record of what was added.
      if (!item || !isSettled(item.status) || item.status === 'done') return state
      return { ...state, items: state.items.filter(({ id }) => id !== action.id) }
    }
  }
}

export function summarizeQueue({ items }: QueueState) {
  return {
    total: items.length,
    done: items.filter(({ status }) => status === 'done').length,
    /** Queued or in flight, as the board's "进行中". */
    active: items.filter(({ status }) => status === 'queued' || isActive(status)).length,
    attention: items.filter(({ status }) => failureStatuses.includes(status)).length,
  }
}
