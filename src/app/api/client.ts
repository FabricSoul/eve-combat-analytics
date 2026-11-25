import type {
  Analysis, ApiError, EntityKey, ApiErrorCode, BattleSummary, FitEntry, IdentityMerge, KillmailFit,
  SideBatchEdit, SideBatchResult, SideEdit, SideOverride, SideSubject, UploadedLog, UploadedLogSummary, UploadResult,
} from '@/core/contract'

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

export const battleApiPath = (brId: string) => `/api/battles/${encodeURIComponent(brId)}`
export type UploadProgress = (fraction: number) => void
export type EditRevision = { revision: string; sequence: number }
export type EditReceipt = { revision?: string | null; sequence?: number }
export type ObservedEdit = EditRevision & { target: string }
export type BattleSnapshot = BattleSummary & { editRevisions?: ObservedEdit[] }
export type VersionedFit = FitEntry & EditReceipt
type FitReceipt = VersionedFit & { previous?: VersionedFit | null }
export type SideReceipt = EditReceipt & {
  previousTags?: Partial<Record<SideSubject, string | null>>
  related?: SideSubject[]
}
type IdentityReceipt = (IdentityMerge | { removed: EntityKey }) & EditReceipt & {
  previous?: IdentityMerge | null
  previousTag?: string | null
}

export function normalizeRevision(revision: string): string {
  return revision.trim().replace(/^W\//i, '')
}

const apiMessages = {
  bad_br_url: '请输入有效的战斗报告链接或战斗编号',
  br_not_found: '找不到这场战斗',
  br_unavailable: '战斗数据暂时无法获取，请稍后再试',
  not_a_gamelog: '这不是 EVE 战斗日志',
  no_overlap: '这份日志的时间与战斗时间不重合',
  unknown_character: '找不到日志所属的飞行员',
  bad_eft: '配装格式有误，请检查 EFT 文本',
  too_large: '提交的内容超过大小限制',
  bad_request: '请求无效，请检查后重试',
  killmail_unavailable: '暂时无法获取这份击毁报告',
} satisfies Record<ApiErrorCode, string>

function failure(payload: Partial<ApiError> | null, status: number): ApiFailure {
  const error = payload?.error
  const code = typeof error === 'string' && Object.hasOwn(apiMessages, error) ? error : 'network'
  return new ApiFailure(
    code,
    status === 429 ? '每分钟最多改 30 次排边，请稍后再试'
      : status === 412 ? '修改已被其他编辑更改，请刷新后重试'
        : code === 'network' ? `请求失败（${status}）` : apiMessages[code],
    status,
  )
}

function networkFailure(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure('network', '无法连接到服务器')
}

async function read<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => {
    if (response.ok) throw new ApiFailure('network', '服务器返回的数据无法读取', response.status)
    return null
  })
  if (!response.ok) throw failure(payload as Partial<ApiError> | null, response.status)
  return payload as T
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init)
  } catch (error) {
    throw networkFailure(error)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return read<T>(await send(path, init))
}

function json(method: 'POST' | 'PUT', data: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
}

const textHeaders = { 'Content-Type': 'text/plain; charset=utf-8' }

async function edit<T extends object>(path: string, init: RequestInit, ifMatch?: string): Promise<T & EditReceipt> {
  const headers = new Headers(init.headers)
  headers.set('X-EVE-Undo', '1')
  if (ifMatch !== undefined) headers.set('If-Match', normalizeRevision(ifMatch))
  const body = await request<T & EditReceipt>(path, { ...init, headers })
  return typeof body.revision === 'string' ? { ...body, revision: normalizeRevision(body.revision) } : body
}

async function sideBatchMatch(tags: ReadonlyMap<string, string>): Promise<string> {
  const entries = [...tags.keys()].sort().map((subject) => [subject, normalizeRevision(tags.get(subject)!)])
  const first = entries[0]?.[1]
  if (first && entries.every(([, tag]) => tag === first)) return first
  // A single validator covers every requested subject while keeping even a large batch's header small.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)))
  return `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}"`
}

function uploadWithProgress(path: string, text: string, onProgress: UploadProgress): Promise<UploadedLogSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
    })
    xhr.upload.addEventListener('load', () => onProgress(1))
    const interrupted = () => reject(networkFailure(null))
    xhr.addEventListener('error', interrupted)
    xhr.addEventListener('abort', interrupted)
    xhr.addEventListener('timeout', interrupted)
    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(failure(xhr.response, xhr.status))
      } else if (xhr.response === null) {
        reject(new ApiFailure('network', '服务器返回的数据无法读取', xhr.status))
      } else {
        resolve(xhr.response as UploadedLogSummary)
      }
    })
    try {
      xhr.open('POST', path)
      xhr.responseType = 'json'
      xhr.setRequestHeader('Content-Type', textHeaders['Content-Type'])
      xhr.send(text)
    } catch (error) {
      reject(networkFailure(error))
    }
  })
}

export const api = {
  createBattle(brUrl: string): Promise<{ brId: string }> {
    return request('/api/battles', json('POST', { brUrl }))
  },

  getBattle(brId: string): Promise<BattleSnapshot> {
    return request(battleApiPath(brId))
  },

  async getAnalysis(brId: string, etag?: string): Promise<{ analysis: Analysis; etag: string | null } | 'not_modified'> {
    const response = await send(`${battleApiPath(brId)}/analysis`, {
      cache: 'no-store',
      headers: etag ? { 'If-None-Match': etag } : undefined,
    })
    if (response.status === 304) return 'not_modified'
    const validator = response.headers.get('ETag')
    return { analysis: await read<Analysis>(response), etag: validator && normalizeRevision(validator) }
  },

  uploadLog(brId: string, text: string, onProgress?: UploadProgress): Promise<UploadResult> {
    const path = `${battleApiPath(brId)}/logs`
    if (onProgress) return uploadWithProgress(path, text, onProgress)
    return request(path, { method: 'POST', headers: textHeaders, body: text })
  },

  putFit(brId: string, charId: number, eft: string, mutated?: FitEntry['mutated'], ifMatch?: string): Promise<FitReceipt> {
    const init = mutated?.length
      ? json('PUT', { eft, mutated })
      : { method: 'PUT', headers: textHeaders, body: eft }
    return edit(`${battleApiPath(brId)}/fits/${charId}`, init, ifMatch)
  },

  deleteFit(brId: string, charId: number, ifMatch?: string): Promise<{ removed: number } & EditReceipt> {
    return edit(`${battleApiPath(brId)}/fits/${charId}`, { method: 'DELETE' }, ifMatch)
  },

  putSide(brId: string, subject: SideSubject, side: SideEdit['side'], ifMatch?: string): Promise<SideOverride & SideReceipt & { previous?: SideBatchEdit['edits'] }> {
    return edit(`${battleApiPath(brId)}/sides`, json('PUT', { subject, side }), ifMatch)
  },

  async putSideBatch(brId: string, edits: SideBatchEdit['edits'], tags?: ReadonlyMap<string, string>): Promise<SideBatchResult & SideReceipt> {
    return edit(`${battleApiPath(brId)}/sides/batch`, json('PUT', { edits }), tags && await sideBatchMatch(tags))
  },

  async restoreSides(brId: string, restore: { subject: SideSubject; through: string }[], tags: ReadonlyMap<string, string>) {
    const normalized = restore.map(({ subject, through }) => ({ subject, through: normalizeRevision(through) }))
    return edit<{ applied: SideOverride[] }>(`${battleApiPath(brId)}/sides/batch`, json('PUT', { restore: normalized }), await sideBatchMatch(tags))
  },

  putIdentity(brId: string, from: EntityKey, to: IdentityMerge['to'] | null, ifMatch?: string): Promise<IdentityReceipt> {
    return edit(`${battleApiPath(brId)}/identities`, json('PUT', { from, to }), ifMatch)
  },

  getKillmailFit(id: number, hash: string): Promise<KillmailFit> {
    return request(`/api/killmails/${id}/${encodeURIComponent(hash)}/fit`)
  },

  getLog(brId: string, logId: string): Promise<UploadedLog> {
    return request(`${battleApiPath(brId)}/logs/${encodeURIComponent(logId)}`)
  },
}
