import { parseBrUrl } from '@/core/br/url'
import { ApiFailure } from '../api/client'

export type BrInput = { ok: true; key: string } | { ok: false; message: string }

export function validateBrInput(input: string): BrInput {
  if (!input.trim()) return { ok: false, message: '先贴一个 BR 链接。' }
  const key = parseBrUrl(input)
  if (key) return { ok: true, key }
  return {
    ok: false,
    message: '这不是可识别的链接。需要 br.evetools.org/br/… 的 BR 链接，或 br.evetools / zKillboard 的 related 链接。',
  }
}

export function brErrorMessage(error: unknown): string {
  switch (error instanceof ApiFailure ? error.code : null) {
    case 'bad_br_url': return '这不是可识别的 BR 链接。'
    case 'br_not_found': return '没有找到这场战斗，请检查链接。'
    case 'br_unavailable': return 'br.evetools.org 暂时无法访问，稍后再试。'
    case 'network': return '无法连接到服务器。'
    default: return '打开失败，请稍后再试。'
  }
}
