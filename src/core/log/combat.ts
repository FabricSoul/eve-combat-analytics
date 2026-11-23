import type { ClientLanguage, EwarType, HitQuality, LogEvent, RepairType } from '../contract'
import { counterparty, isEnglishShipType } from './counterparty'
import { canonicalText, combatText, decodeEscapedTags, localizedText, visibleText, wholeNameHint, type CombatMarkup } from './markup'

type WithoutLocation<Event> = Event extends LogEvent ? Omit<Event, 't' | 'line'> : never

interface CombatMatch {
  language: Exclude<ClientLanguage, 'unknown'>
  event: WithoutLocation<LogEvent> | null
}

type Names = CombatMarkup['names']

function label(text: string, names: Names, raw = text, drone?: string) {
  const trimmed = text.trim()
  const hint = wholeNameHint(trimmed, names)
  const npcName = hint && !isEnglishShipType(hint) ? hint : undefined
  // Pad only known English hull hints: Chinese displays can fuse the localized
  // hull to the preceding pilot name without whitespace.
  const canonical = npcName ?? localizedText(trimmed, names, ({ english }) =>
    isEnglishShipType(english) ? ' ' + english + '* ' : english,
  )
  return counterparty(canonical, visibleText(raw, names), drone && canonicalText(drone, names), npcName)
}

function payloadParts(payload: string): string[] {
  const quoteEnd = /'\s*\([^()]+\)/.exec(payload)?.index
  const quoteStart = quoteEnd === undefined ? undefined : payload.indexOf("'")
  if (!/[()[\]<>]/.test(payload) && quoteStart === undefined) return payload.split(' - ')
  const parts: string[] = []
  let start = 0
  let parentheses = 0
  let brackets = 0
  let italicDepth = 0
  for (const match of payload.matchAll(/<\/?i>|<[^<>]+>|[()[\]]| - /g)) {
    if (quoteStart !== undefined && quoteEnd !== undefined && quoteStart < match.index && match.index < quoteEnd) continue
    if (match[0] === '<i>') italicDepth++
    else if (match[0] === '</i>') italicDepth = Math.max(0, italicDepth - 1)
    else if (italicDepth) continue
    else if (match[0] === '(') parentheses++
    else if (match[0] === ')') parentheses = Math.max(0, parentheses - 1)
    else if (match[0] === '[') brackets++
    else if (match[0] === ']') brackets = Math.max(0, brackets - 1)
    else if (match[0] === ' - ' && !parentheses && !brackets) {
      parts.push(payload.slice(start, match.index))
      start = match.index + match[0].length
    }
  }
  parts.push(payload.slice(start))
  return parts
}

function effectPayload(payload: string, names: Names) {
  const [other = '', ...parts] = payloadParts(payload)
  const module = canonicalText(parts.join(' - ').replace(/^-(?: |$)/, ''), names) || null
  return { other: label(other, names), module }
}

const qualities = new Map<string, HitQuality>([
  ['wrecks', 'Wrecks'], ['致命一击', 'Wrecks'],
  ['smashes', 'Smashes'], ['强力一击', 'Smashes'],
  ['penetrates', 'Penetrates'], ['穿透', 'Penetrates'],
  ['hits', 'Hits'], ['命中', 'Hits'],
  ['glances off', 'Glances Off'], ['擦过', 'Glances Off'],
  ['grazes', 'Grazes'], ['轻轻擦过', 'Grazes'],
  // These recorded client variants are outside the contract's quality scale.
  ['barely scratches', 'none'], ['scrapes', 'none'], ['deflected', 'none'], ['ricochet', 'none'],
])

const repairs = new Map<string, RepairType>([
  ['remote armor repaired', 'armor'], ['远程装甲维修量', 'armor'],
  ['remote shield boosted', 'shield'], ['远程护盾回充增量', 'shield'],
  ['remote hull repaired', 'hull'], ['远程结构维修量', 'hull'],
  ['remote capacitor transmitted', 'capacitor'], ['远程电容传输量', 'capacitor'],
  ['远程电容传输', 'capacitor'],
])

function damage(text: string, names: Names): CombatMatch | null {
  const m = /^(\d+)\s*(?:(to|from) |(对|来自)\s*)(.+)$/.exec(text)
  if (!m?.[4]) return null
  const language = m[2] ? 'en' : 'zh'
  const dir = m[2] === 'to' || m[3] === '对' ? 'out' : 'in'
  let amount = Number(m[1])
  if (!Number.isSafeInteger(amount)) return { language, event: null }

  // CCP prints potential damage alongside the amount prevented by the cap.
  const deflected = /\s*[(（](\d+)(?: deflected|\s*偏离)[)）]$/i.exec(m[4])
  const payload = deflected ? m[4].slice(0, deflected.index) : m[4]
  if (deflected) {
    const prevented = Number(deflected[1])
    if (!Number.isSafeInteger(prevented) || prevented > amount) return { language, event: null }
    amount -= prevented
  }

  const parts = payloadParts(payload)
  let party = parts.shift() ?? ''
  let structureName: string | undefined
  const possibleStructure = parts[0]
  if (
    deflected && possibleStructure && /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(party) &&
    /\[[^\]]{1,5}\]\s*\([^()]+\)$/.test(possibleStructure)
  ) {
    structureName = parts.shift()
    party += ' - ' + structureName
  }
  if (!party.trim()) return { language, event: null }

  const lastPart = parts.at(-1)?.toLowerCase()
  const quality = lastPart === undefined ? undefined : qualities.get(lastPart)
  if (quality !== undefined) {
    parts.pop()
    // Some structure lines repeat the same quality before the cap annotation.
    if (deflected && parts.at(-1)?.toLowerCase() === lastPart) parts.pop()
  }
  if (quality === undefined && parts.length > 1) return { language, event: null }
  const weapon = canonicalText(parts.join(' - '), names) || null
  return {
    language,
    event: {
      kind: 'damage', dir, amount, weapon, quality: quality ?? 'none',
      other: label(structureName ?? party, names, party),
    },
  }
}

function repair(text: string, names: Names): CombatMatch | null {
  const en = /^(\d+) (remote armor repaired|remote shield boosted|remote hull repaired|remote capacitor transmitted) (to|by) (.+)$/.exec(text)
  const m = en ?? /^(\d+)\s*(远程装甲维修量|远程护盾回充增量|远程结构维修量|远程电容传输量?)\s*(至|由)\s*(.+)$/.exec(text)
  if (!m?.[4]) return null
  const language = en ? 'en' : 'zh'
  const repairType = repairs.get(m[2] ?? '')
  if (!repairType) return { language, event: null }
  return repairResult(language, m[3] === 'to' || m[3] === '至' ? 'out' : 'in', Number(m[1]), repairType, m[4], names)
}

function repairResult(
  language: CombatMatch['language'], dir: 'in' | 'out', amount: number, repairType: RepairType, payload: string, names: Names,
): CombatMatch {
  const { other, module } = effectPayload(payload, names)
  const valid = Number.isSafeInteger(amount) && !!other.raw
  return { language, event: valid ? { kind: 'repair', dir, repairType, amount, other, module } : null }
}

function remoteEnergy(text: string, names: Names): CombatMatch | null {
  const en = /^\+?(\d+) GJ remote energy transferred (to|from) (.+)$/.exec(text)
  if (en?.[3]) return repairResult('en', en[2] === 'to' ? 'out' : 'in', Number(en[1]), 'capacitor', en[3], names)

  const out = /^(\d+)\s*GJ\s*远程能量传输至\s*(.+)$/.exec(text)
  if (out?.[2]) return repairResult('zh', 'out', Number(out[1]), 'capacitor', out[2], names)

  const incoming = /^\+?(\d+)\s*GJ\s*来自\s*(.+?)\s*远程能量传输(.*)$/.exec(text)
  if (incoming?.[2]) {
    return repairResult('zh', 'in', Number(incoming[1]), 'capacitor', incoming[2] + (incoming[3] ?? ''), names)
  }
  return null
}

function amountColor(raw: string): string | undefined {
  const leadingTags = /^(?:\s|<[^<>]*>)*/.exec(decodeEscapedTags(raw))?.[0] ?? ''
  return [...leadingTags.matchAll(/<color\s*=\s*(0x[\da-f]+)>/gi)].at(-1)?.[1]?.toLowerCase()
}

function capacitor(text: string, raw: string, names: Names): CombatMatch | null {
  const en = /^([+-]?\d+) GJ (energy neutralized|energy drained (from|to)) (.+)$/.exec(text)
  const m = en ?? /^([+-]?\d+)\s*GJ\s*(能量中和|被(从|吸取到))\s*(.+)$/.exec(text)
  if (!m?.[4]) return null
  const language = en ? 'en' : 'zh'
  const amount = Math.abs(Number(m[1]))
  const payload = m[3] === '从' ? m[4].replace(/吸取(?= - |$)/, '') : m[4]
  const { other, module } = effectPayload(payload, names)
  if (!Number.isSafeInteger(amount) || !other.raw) return { language, event: null }

  if (m[3]) {
    // "From" names the source of the transferred energy. The listener's NOS
    // fired, so the interaction itself is outgoing.
    const dir = m[3] === 'from' || m[3] === '从' ? 'out' : 'in'
    return { language, event: { kind: 'nos', dir, amount, other, module } }
  }
  // Both directions have identical wording in the client. Only the amount's
  // color identifies the actor in a directionless neutralization message.
  const color = amountColor(raw)
  const dir = color === '0xff7fffff' ? 'out' : color === '0xffe57f7f' ? 'in' : null
  return { language, event: dir ? { kind: 'neut', dir, amount, other, module } : null }
}

function explicitNeutralization(text: string, names: Names): CombatMatch | null {
  const en = /^(\d+) GJ from (.+) - Energy neutralized$/i.exec(text)
  const zh = /^([^被]+)被(.+?)能量中和\s*(\d+)\s*GJ$/.exec(text)
  const language = en ? 'en' : 'zh'
  if (!en?.[2] && !(zh?.[1] && zh[2])) return null

  const amount = Number(en?.[1] ?? zh?.[3])
  const { other, module } = en?.[2]
    ? effectPayload(en[2], names)
    : { other: label(zh?.[1] ?? '', names), module: canonicalText(zh?.[2] ?? '', names) || null }
  const valid = Number.isSafeInteger(amount) && !!other.raw
  return { language, event: valid ? { kind: 'neut', dir: 'in', amount, other, module } : null }
}

function misses(text: string, names: Names): CombatMatch | null {
  const enOut = /^Your (?:group of )?(.+?) misses (.+?) completely\.?(?: - (.+))?$/.exec(text)
  const zhOut = enOut ? null : /^你的(?:一组)?\s*(.+?)\s*\*?完全没有打中\s*(.+)$/.exec(text)
  const out = enOut ?? zhOut
  if (out?.[1] && out[2]) {
    const [party = '', ...suffix] = zhOut ? payloadParts(out[2]) : [out[2]]
    const weapon = canonicalText(enOut?.[3] ?? (suffix.join(' - ') || out[1]), names) || null
    return {
      language: enOut ? 'en' : 'zh',
      event: { kind: 'miss', dir: 'out', weapon, other: label(party, names) },
    }
  }

  const enIn = /^(.+?) misses you completely\.?(?: - (.+))?$/.exec(text)
  const incoming = enIn ?? /^(.+?)\s*完全没有打中\s*你。?(?: - (.+))?$/.exec(text)
  const zhDrone = /^([^的]+)的(.+?)完全没有击中你。?(?: - (.+))?$/.exec(text)
  if (!incoming && zhDrone?.[1] && zhDrone[2]) {
    return {
      language: 'zh',
      event: {
        kind: 'miss', dir: 'in', weapon: canonicalText(zhDrone[3] ?? zhDrone[2], names) || null,
        other: label(zhDrone[1], names, zhDrone[1] + '的' + zhDrone[2], zhDrone[2]),
      },
    }
  }
  if (!incoming?.[1]) return null
  const ownedDrone = enIn ? /^(.+?) belonging to (.+)$/.exec(incoming[1]) : null
  return {
    language: enIn ? 'en' : 'zh',
    event: {
      kind: 'miss', dir: 'in', weapon: canonicalText(incoming[2] ?? '', names) || null,
      other: label(ownedDrone?.[2] ?? incoming[1], names, incoming[1], ownedDrone?.[1]),
    },
  }
}

function warp(language: CombatMatch['language'], ewar: EwarType, from: string, to: string, names: Names): CombatMatch {
  const isListener = (name: string) => /^(?:you|你)(?: -)?$/i.test(name.trim())
  const fromListener = isListener(from)
  const toListener = isListener(to)
  if (!fromListener && !toListener) {
    const source = label(from, names)
    const other = label(to, names)
    return { language, event: source.raw && other.raw ? { kind: 'ewar_seen', ewar, source, other } : null }
  }
  if (fromListener && toListener) return { language, event: null }
  const dir = fromListener ? 'out' : 'in'
  const other = label(fromListener ? to : from, names)
  return { language, event: other.raw ? { kind: 'ewar', ewar, dir, other } : null }
}

function englishWarpParties(suffix: string, raw: string): [string, string] | undefined {
  const delimiters = [...suffix.matchAll(/ to /gi)]
  if (delimiters.length === 0) return [suffix, 'you']
  const match = delimiters[0]
  if (match && delimiters.length === 1) return [suffix.slice(0, match.index), suffix.slice(match.index + 4)]

  // The actual client renders the separator in a font span, independently
  // of any " to " inside a pilot or cosmetic label.
  const marked = /<font(?:size)?\b[^>]*>\s*to(?=\s|<)/i.exec(raw)
  if (marked) {
    const leading = /^Warp (?:scramble|disruption) attempt from (.+)$/i.exec(combatText(raw.slice(0, marked.index)).text)?.[1]
    if (leading && suffix.startsWith(leading + ' to ')) return [leading, suffix.slice(leading.length + 4)]
  }
  const explicit = /^(you(?: -)?) to (.+)$/i.exec(suffix) ?? /^(.+) to (you)$/i.exec(suffix)
    ?? /^(.+? -) to (.+)$/i.exec(suffix)
  if (explicit?.[1] && explicit[2]) return [explicit[1], explicit[2]]
  return undefined
}

function electronicWarfare(text: string, raw: string, names: Names): CombatMatch | null {
  const notice = text.replace(/[!！]$/, '')
  const en = /^Warp (scramble|disruption) attempt from (.+)$/i.exec(notice)
  if (en?.[2]) {
    const ewar = en[1]?.toLowerCase() === 'scramble' ? 'warp_scramble' : 'warp_disrupt'
    const parties = englishWarpParties(en[2], raw)
    return parties ? warp('en', ewar, ...parties, names) : { language: 'en', event: null }
  }

  const zh = /^(?:来自 )?(.+?)\s*试图跃迁(扰频|扰断)\s*(.+)$/.exec(notice)
  if (zh?.[1] && zh[3]) {
    return warp('zh', zh[2] === '扰频' ? 'warp_scramble' : 'warp_disrupt', zh[1], zh[3], names)
  }

  const jamIn = /^(?:Your target locks broken by|You're jammed by) (.+)$/.exec(notice)
  if (jamIn?.[1]) {
    const { other } = effectPayload(jamIn[1], names)
    return { language: 'en', event: other.raw ? { kind: 'ewar', dir: 'in', ewar: 'jam', other } : null }
  }
  const jamOut = /^(.+?)(?: -)? (?:target locks broken|jammed) - .+$/.exec(notice)
  if (jamOut?.[1]) {
    const other = label(jamOut[1], names)
    return { language: 'en', event: other.raw ? { kind: 'ewar', dir: 'out', ewar: 'jam', other } : null }
  }

  const zhJamIn = /^(?:你的\s*目标锁定丢失\s*于\s*(.+)|([^的]+)的.+?令\s*你的\s*目标锁定丢失)$/.exec(notice)
  const zhSource = zhJamIn?.[1] ?? zhJamIn?.[2]
  if (zhSource) {
    return { language: 'zh', event: { kind: 'ewar', dir: 'in', ewar: 'jam', other: label(zhSource, names) } }
  }
  const zhDroneJam = /^(.+?)的.+正在干扰你$/.exec(notice)
  if (zhDroneJam?.[1]) {
    return { language: 'zh', event: { kind: 'ewar', dir: 'in', ewar: 'jam', other: label(zhDroneJam[1], names) } }
  }
  const zhJamOut = /^[^对]+对([^对]+?)\s*目标锁定丢失$/.exec(notice)
  if (zhJamOut?.[1]) {
    return { language: 'zh', event: { kind: 'ewar', dir: 'out', ewar: 'jam', other: label(zhJamOut[1], names) } }
  }
  return null
}

export function matchCombat({ text, names }: CombatMarkup, raw: string): CombatMatch | null {
  if (/^[+\-]?\d/.test(text)) {
    const quantitative = damage(text, names) ?? repair(text, names) ?? capacitor(text, raw, names) ?? remoteEnergy(text, names)
    if (quantitative) return quantitative
  }
  return misses(text, names) ?? electronicWarfare(text, raw, names) ?? explicitNeutralization(text, names)
}
