import type {
  Analysis, ApiError, EntityKey, ApiErrorCode, BattleSummary, FitEntry, IdentityMerge, KillmailFit,
  SideEdit, SideOverride, SideSubject, UploadedLog, UploadedLogSummary, UploadResult,
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

const apiCodes = {
  bad_br_url: true, br_not_found: true, br_unavailable: true, not_a_gamelog: true,
  no_overlap: true, unknown_character: true, bad_eft: true, too_large: true,
  bad_request: true, killmail_unavailable: true,
} satisfies Record<ApiErrorCode, true>

function failure(payload: Partial<ApiError> | null, status: number): ApiFailure {
  const code = payload?.error
  return new ApiFailure(
    typeof code === 'string' && Object.hasOwn(apiCodes, code) ? code : 'network',
    typeof payload?.message === 'string' ? payload.message : `请求失败（${status}）`,
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

  getBattle(brId: string): Promise<BattleSummary> {
    return request(battleApiPath(brId))
  },

  async getAnalysis(brId: string, etag?: string): Promise<{ analysis: Analysis; etag: string | null } | 'not_modified'> {
    const response = await send(`${battleApiPath(brId)}/analysis`, {
      cache: 'no-store',
      headers: etag ? { 'If-None-Match': etag } : undefined,
    })
    if (response.status === 304) return 'not_modified'
    return { analysis: await read<Analysis>(response), etag: response.headers.get('ETag') }
  },

  uploadLog(brId: string, text: string, onProgress?: UploadProgress): Promise<UploadResult> {
    const path = `${battleApiPath(brId)}/logs`
    if (onProgress) return uploadWithProgress(path, text, onProgress)
    return request(path, { method: 'POST', headers: textHeaders, body: text })
  },

  putFit(brId: string, charId: number, eft: string): Promise<FitEntry> {
    return request(`${battleApiPath(brId)}/fits/${charId}`, { method: 'PUT', headers: textHeaders, body: eft })
  },

  deleteFit(brId: string, charId: number): Promise<{ removed: number }> {
    return request(`${battleApiPath(brId)}/fits/${charId}`, { method: 'DELETE' })
  },

  putSide(brId: string, subject: SideSubject, side: SideEdit['side']): Promise<SideOverride> {
    return request(`${battleApiPath(brId)}/sides`, json('PUT', { subject, side }))
  },

  putIdentity(brId: string, from: EntityKey, to: IdentityMerge['to'] | null): Promise<IdentityMerge | { removed: EntityKey }> {
    return request(`${battleApiPath(brId)}/identities`, json('PUT', { from, to }))
  },

  getKillmailFit(id: number, hash: string): Promise<KillmailFit> {
    return request(`/api/killmails/${id}/${encodeURIComponent(hash)}/fit`)
  },

  getLog(brId: string, logId: string): Promise<UploadedLog> {
    return request(`${battleApiPath(brId)}/logs/${encodeURIComponent(logId)}`)
  },
}
