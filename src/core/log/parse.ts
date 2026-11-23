import { GamelogFormatError, type ClientLanguage, type LogEvent, type ParseGamelog } from '../contract'
import { combatText, matchCombat, visibleText } from './combat'

const listenerLabel = /^(Listener|收听者)\s*[:：]\s*(.*)$/
const sessionLabel = /^(Session Started|进程开始|会话开始)\s*[:：]\s*(.*)$/
const envelope = /^\[([^\]]*)\]\s*\(([^)]+)\)\s*(.*)$/
const timePattern = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/

function isEntry(line: string): boolean {
  if (!line.startsWith('[')) return false
  const match = envelope.exec(line)
  return !!match && (match[2]?.trim() === 'combat' || timePattern.test(match[1]?.trim() ?? ''))
}

function utcTime(text: string): number | null {
  const match = timePattern.exec(text)
  if (!match) return null

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const year = Number(yearText)
  const month = Number(monthText) - 1
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  // Date.UTC treats 0–99 as 1900–1999. Move by a full Gregorian cycle in that case.
  const offset = year < 100 ? 400 : 0
  const date = new Date(Date.UTC(year + offset, month, day, hour, minute, second))
  if (
    date.getUTCFullYear() !== year + offset || date.getUTCMonth() !== month ||
    date.getUTCDate() !== day || date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
  ) return null
  return date.getTime() - (offset ? 146_097 * 86_400_000 : 0)
}

interface Header {
  listener: string
  sessionStart: number
  language: ClientLanguage
  end: number
}

function readHeader(lines: string[]): Header {
  let framed = false
  let title: ClientLanguage = 'unknown'
  let listener: RegExpExecArray | null = null
  let session: RegExpExecArray | null = null
  let error = new GamelogFormatError('no_header', 'Gamelog heading not found')

  function closeHeader(end: number): Header | null {
    if (title === 'unknown' && !(framed && listener && session)) return null
    const name = listener?.[2]?.trim()
    if (!name) {
      error = new GamelogFormatError('no_listener', 'Gamelog listener not found')
      return null
    }
    const start = utcTime(session?.[2]?.trim() ?? '')
    if (start === null) {
      error = new GamelogFormatError('no_session_start', 'Gamelog session start missing or invalid')
      return null
    }

    const listenerLanguage = listener?.[1] === 'Listener' ? 'en' : 'zh'
    const sessionLanguage = session?.[1] === 'Session Started' ? 'en' : 'zh'
    const fieldLanguage = listenerLanguage === sessionLanguage ? listenerLanguage : 'unknown'
    return { listener: name, sessionStart: start, language: title === 'unknown' ? fieldLanguage : title, end }
  }

  for (const [index, physicalLine] of lines.entries()) {
    const line = physicalLine.trim()
    if (isEntry(line) && (title !== 'unknown' || listener || session)) {
      const header = closeHeader(index)
      if (header) return header
      throw error
    }
    if (/^-{3,}$/.test(line)) {
      const header = closeHeader(index + 1)
      if (header) return header
      framed = true
      title = 'unknown'
      listener = null
      session = null
    } else if (line === 'Gamelog' || line === '游戏记录') {
      title = line === 'Gamelog' ? 'en' : 'zh'
      listener = null
      session = null
    } else if (framed || title !== 'unknown') {
      listener ??= listenerLabel.exec(line)
      session ??= sessionLabel.exec(line)
    }
  }

  const header = closeHeader(lines.length)
  if (header) return header
  throw error
}

export const parseGamelog: ParseGamelog = (text) => {
  const lines = text.split(/\r\n|\n|\r/)
  const { listener, sessionStart, language: headerLanguage, end } = readHeader(lines)
  let language = headerLanguage
  let previousTime: string | undefined
  let t: number | null = null
  const events: LogEvent[] = []
  const unparsed: { line: number; text: string }[] = []

  for (let index = end; index < lines.length; index++) {
    const match = envelope.exec(lines[index]?.trimStart() ?? '')
    if (match?.[2]?.trim() !== 'combat') continue

    const line = index + 1
    let raw = match[3] ?? ''
    while (index + 1 < lines.length) {
      const physicalLine = lines[index + 1] ?? ''
      if (physicalLine.startsWith('[')) break
      const continuation = physicalLine.trim()
      if (isEntry(continuation)) break
      raw += ' ' + continuation
      index++
    }
    const normalized = combatText(raw)
    const time = match[1]
    if (time !== previousTime) {
      t = utcTime(time?.trim() ?? '')
      previousTime = time
    }
    const combat = matchCombat(normalized, raw)
    if (language === 'unknown' && combat) language = combat.language
    if (t !== null && combat?.event?.other.raw) {
      events.push({ ...combat.event, t, line })
    } else {
      unparsed.push({ line, text: visibleText(normalized) })
    }
  }

  events.sort((a, b) => a.t - b.t || a.line - b.line)
  return { listener, sessionStart, language, events, unparsed }
}
