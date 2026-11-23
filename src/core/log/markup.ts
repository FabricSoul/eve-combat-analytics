const clientTags = 'a|b|br|color|font|fontsize|loc|localized|size|span|s|strong|em|u|url'
const escapedTag = new RegExp(`&lt;(\\/?(?:${clientTags}|i)(?=\\s|=|\\/|&gt;)(?:(?!&(?:gt|lt);)[^<>])*)&gt;`, 'gi')
const literalTag = new RegExp(`<\\/?(?:${clientTags})(?=[\\s=/>])[^<>]*>`, 'gi')
const italicTag = /<\/?i(?=[\s=/>])[^<>]*>/gi
const excessSpace = /\s{2,}|[^\S ]/g
const entities: Record<string, string> = { nbsp: ' ', amp: '&', gt: '>', lt: '<', quot: '"', apos: "'", '#34': '"', '#39': "'" }
const entity = /&(nbsp|amp|gt|lt|quot|apos|#34|#39);/g
const attributeQuote = /&(quot|apos|#34|#39);/g

interface LocalizedName {
  display: string
  english: string
}

export interface CombatMarkup {
  text: string
  names: readonly LocalizedName[]
}

export function decodeEscapedTags(raw: string): string {
  return raw.replace(escapedTag, (_, tag: string) => '<' + tag.replace(attributeQuote, decodeEntity) + '>')
}

function decodeEntity(match: string, key: string): string {
  return entities[key] ?? match
}

function stripTags(text: string): string {
  return text.replace(literalTag, '').replace(italicTag, (tag) => tag[1] === '/' ? '</i>' : '<i>')
}

function clean(text: string): string {
  return text.replace(excessSpace, ' ').trim()
}

function stripItalics(text: string): string {
  return text.includes('<') ? clean(text.replace(/<\/?i>/g, '')) : clean(text)
}

const localizedSpan = /<localized\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>(?:((?:(?!<\/?localized\b)[\s\S])*?)<\/localized\s*>|([^<]*))/gi
const hintAttribute = /(?:^|\s)hint\s*=\s*(?:"([^"]+)"|'([^']+)')/i
const localizedToken = /\u0000(\d+)\u0001/g
const wholeToken = /^\u0000(\d+)\u0001$/

export function combatText(raw: string): CombatMarkup {
  const tags = raw.includes('&lt;') ? decodeEscapedTags(raw) : raw
  const names: LocalizedName[] = []
  const text = tags.includes('\u0000') || !/<localized\b/i.test(tags) ? tags : tags.replace(
    localizedSpan,
    (match: string, attributes: string, closed: string | undefined, open: string | undefined) => {
      const hint = hintAttribute.exec(attributes)
      const english = clean((hint?.[1] ?? hint?.[2] ?? '').replace(entity, decodeEntity))
      // The game often omits the end tag. In that layout the asterisk ends
      // the localized name, leaving parentheses and grammar in the outer text.
      const star = open?.indexOf('*') ?? -1
      const body = closed ?? (star >= 0 ? open?.slice(0, star + 1) : undefined)
      if (!english || !body) return match
      const display = stripTags(body).replace(entity, decodeEntity)
      if (!stripItalics(display)) return match
      const token = '\u0000' + names.length + '\u0001'
      names.push({ display, english })
      return token + (closed === undefined ? open?.slice(star + 1) ?? '' : '')
    },
  )
  return { text: clean(stripTags(text).replace(entity, decodeEntity)), names }
}

export function localizedText(
  text: string,
  names: CombatMarkup['names'],
  render: (name: LocalizedName) => string,
): string {
  if (!names.length || !text.includes('\u0000')) return text
  return text.replace(localizedToken, (token, index: string) => {
    const name = names[Number(index)]
    return name ? render(name) : token
  })
}

export function wholeNameHint(text: string, names: CombatMarkup['names']): string | undefined {
  if (!names.length || !text.startsWith('\u0000')) return undefined
  return names[Number(wholeToken.exec(text)?.[1])]?.english
}

export function visibleText(text: string, names: CombatMarkup['names']): string {
  return stripItalics(localizedText(text, names, (name) => name.display))
}

export function canonicalText(text: string, names: CombatMarkup['names']): string {
  return stripItalics(localizedText(text, names, (name) => name.english))
}
