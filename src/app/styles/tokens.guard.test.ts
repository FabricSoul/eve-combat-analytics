// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseSync, Visitor, type ESTree } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, BattleSummary, ServerMessage } from '@/core/contract'
import { tokenGroups } from '../gallery/TokensPage'
import { defaultOursSide, sideColor, sideLetter, sideOrder } from '../lib/sides'
import { useBattle } from '../state/battle-store'
import { usePlayback, useView, ViewProvider } from '../state/view-store'

const appDirectory = resolve('src/app')

function channels(value: string) {
  const values = value.match(/[\d.]+/g)?.map(Number) ?? []
  return /^color\(srgb /.test(value) ? values.map((channel, index) => index < 3 ? channel * 255 : channel) : values
}

function composite(foreground: number[], background: number[], opacity = 1): number[] {
  const alpha = foreground.length < 3 ? 0 : (foreground[3] ?? 1) * opacity
  return alpha === 0 ? background : background.map((channel, i) => foreground[i]! * alpha + channel * (1 - alpha))
}

function paintedBackground(element: Element | null): number[] {
  if (!element) return []
  const color = channels(getComputedStyle(element).backgroundColor)
  if (color.length === 3 || color[3] === 1) return color.slice(0, 3)
  return composite(color, paintedBackground(element.parentElement))
}

function luminance(channels: number[]) {
  const [r, g, b] = channels.map((byte) => {
    const channel = byte / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: number[], background: number[]) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function contrastBacking(element: Element, background: Element | null) {
  const { outlineStyle, outlineWidth, outlineColor } = getComputedStyle(element)
  return outlineStyle === 'solid' && parseFloat(outlineWidth) >= 1
    ? channels(outlineColor) : paintedBackground(background)
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  })
}

const originalColorLiteral = /(?<![\w-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\brgba?\s*\(/i
const colorFunction = /\b(?:hsla?|hwb|lch|lab|oklab|oklch|color|device-cmyk)\s*\(/i
const colorProperty = /^(?:--|background(?:-|$)|border(?:-|$)|outline(?:-|$)|column-rule(?:-|$)|text-decoration(?:-|$)|box-shadow$|text-shadow$|fill$|stroke$|fill-style$|stroke-style$|filter$|drop-shadow$|(?:.*-)?color$)/
const nonPaletteWords = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const colorProbe = document.createElement('span').style
const namedColors = new Map<string, boolean>()

function isColorProperty(name: string): boolean {
  return colorProperty.test(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).toLowerCase())
}

function hasNamedColor(value: string): boolean {
  const css = value.replace(/\burl\([^)]*\)/gi, '')
  return (css.toLowerCase().match(/[-\w]+/g) ?? []).some((word) => {
    if (!/^[a-z]+$/.test(word) || nonPaletteWords.has(word)) return false
    const cached = namedColors.get(word)
    if (cached !== undefined) return cached
    colorProbe.color = ''
    colorProbe.color = word
    const named = colorProbe.color !== ''
    namedColors.set(word, named)
    return named
  })
}

function hasCssColor(source: string): boolean {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return Array.from(css.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)/g)).some(([, property, value]) =>
    value !== undefined && (colorFunction.test(value)
      || (property !== undefined && isColorProperty(property.toLowerCase()) && hasNamedColor(value))))
}

function propertyName(node: ESTree.Node): string {
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  return ''
}

function namedExpression(node: ESTree.Node): boolean {
  switch (node.type) {
    case 'Literal': return typeof node.value === 'string' && hasNamedColor(node.value)
    case 'TemplateLiteral': return node.quasis.some(({ value }) => hasNamedColor(value.raw))
    case 'JSXExpressionContainer':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression': return namedExpression(node.expression)
    case 'ConditionalExpression': return namedExpression(node.consequent) || namedExpression(node.alternate)
    case 'LogicalExpression': return namedExpression(node.left) || namedExpression(node.right)
    default: return false
  }
}

function hasScriptColor(source: string, path: string): boolean {
  let found = false
  function check(property: string, value: ESTree.Node) {
    found ||= isColorProperty(property) && namedExpression(value)
  }
  const { program } = parseSync(path, source)
  new Visitor({
    Literal(node) {
      if (typeof node.value === 'string') found ||= colorFunction.test(node.value)
    },
    TemplateElement(node) {
      found ||= colorFunction.test(node.value.raw)
    },
    Property(node) {
      check(propertyName(node.key), node.value)
    },
    JSXAttribute(node) {
      if (node.value) check(propertyName(node.name), node.value)
    },
    AssignmentExpression(node) {
      if (node.left.type === 'MemberExpression') check(propertyName(node.left.property), node.right)
    },
    VariableDeclarator(node) {
      if (node.init) check(propertyName(node.id), node.init)
    },
    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression') return
      const method = propertyName(node.callee.property)
      const [property, value] = node.arguments
      if ((method === 'setAttribute' || method === 'setProperty') && property?.type === 'Literal' && value) {
        check(propertyName(property), value)
      }
    },
  }).visit(program)
  return found
}

function hasMarkupColor(source: string): boolean {
  const document = new DOMParser().parseFromString(source, 'text/html')
  return [...document.querySelectorAll('style')].some((style) => hasCssColor(style.textContent ?? ''))
    || [...document.querySelectorAll('*')].some((element) => [...element.attributes].some(({ name, value }) =>
      name === 'style' ? hasCssColor(value) : isColorProperty(name) && (colorFunction.test(value) || hasNamedColor(value))))
}

function hasColorLiteral(source: string, path: string): boolean {
  if (originalColorLiteral.test(source)) return true
  if (path.endsWith('.css')) return hasCssColor(source)
  if (/\.(?:html|svg)$/.test(path)) return hasMarkupColor(source)
  if (/\.[cm]?[jt]sx?$/.test(path)) return hasScriptColor(source, path)
  return false
}

describe('design tokens', () => {
  it.each(['light', 'dark'])('keeps Compare side marks at 3:1 in %s appearance', (theme) => {
    const style = document.createElement('style')
    style.textContent = ['styles/tokens.css', 'battle/compare/compare.css', 'battle/compare/hit-quality.css']
      .map((file) => readFileSync(resolve(appDirectory, file), 'utf8')).join('\n')
      .replaceAll(':hover', '[data-test-hover]')
    document.head.appendChild(style)
    const compare = document.createElement('section')
    compare.className = 'u7-compare'
    compare.dataset.appearance = theme
    document.body.appendChild(compare)
    try {
      // Use the shared selectors for the large and compact table bars, side-by-side track, and distribution rings.
      compare.innerHTML = `
        <table><tbody>
          <tr><td><span class="u7-compare-bar"><i></i></span></td></tr>
          <tr data-test-hover><td><span class="u7-compare-bar"><i></i></span></td></tr>
          <tr data-pinned="true"><td><span class="u7-compare-bar"><i></i></span></td></tr>
        </tbody></table>
        <div class="u7-compare-cards"><section><div class="u7-compare-pair"><span class="u7-compare-bar"><i></i></span></div></section></div>
        <div class="u7-distribution-axis"><button class="u7-distribution-point"></button></div>`
      const bars = compare.querySelectorAll<HTMLElement>('.u7-compare-bar > i')
      const point = compare.querySelector<HTMLButtonElement>('.u7-distribution-point')!
      for (const side of [0, 1, 2, -1]) {
        const token = sideColor(side, [0, 1, 2])
        for (const [i, fill] of [...bars].entries()) {
          fill.style.background = token
          const backing = paintedBackground(fill.parentElement)
          const computed = getComputedStyle(fill)
          const color = composite(channels(computed.backgroundColor), backing, Number(computed.opacity || 1))
          expect.soft(contrast(color, backing), `side ${side} on Compare track ${i + 1}`).toBeGreaterThanOrEqual(3)
          const track = fill.parentElement!
          const edge = contrastBacking(track, track.parentElement)
          expect.soft(contrast(color, edge), `side ${side} at the edge of Compare track ${i + 1}`).toBeGreaterThanOrEqual(3)
        }
        point.style.setProperty('--point-side', token)
        for (const highlighted of [false, true]) {
          point.dataset.highlighted = String(highlighted)
          const computed = getComputedStyle(point)
          const backing = paintedBackground(point)
          const color = composite(channels(computed.borderTopColor), backing, Number(computed.opacity || 1))
          expect.soft(contrast(color, backing), `side ${side} distribution ring, pinned=${highlighted}`).toBeGreaterThanOrEqual(3)
        }
      }
    } finally {
      style.remove()
      compare.remove()
    }
  })

  it.each(['light', 'dark'])('keeps pilot bars and battle side swatches at 3:1 in %s appearance', (theme) => {
    const style = document.createElement('style')
    // Tailwind Preflight removes the browser's default button background.
    style.textContent = 'button { background: transparent; }\n' + [
      'styles/tokens.css',
      'shell/workspace.css',
      'battle/roster/roster.css',
      'battle/person/person.css',
      'battle/compare/compare.css',
      'battle/upload/kills.css',
      'battle/feed/feed.css',
      'battle/hits/hits.css',
    ].map((file) => readFileSync(resolve(appDirectory, file), 'utf8')).join('\n')
      .replaceAll(':hover', '[data-test-hover]').replaceAll(':focus-visible', '[data-test-focus]')
    const root = document.createElement('div')
    root.dataset.appearance = theme
    root.style.background = 'var(--color-bg)'
    root.innerHTML = `
      <div class="u7-person"><div class="u7-person-card">
        <span class="u7-top-track"><i></i></span>
        <span class="u7-fit-track"><i></i></span><span class="u7-fit-track"><i data-theory="true"></i></span>
      </div><i class="u7-side-dot" data-side-swatch="pilot header"></i></div>
      <div class="u7-compare-options"><i class="u7-side-dot" data-side-swatch="Compare side filter"></i></div>
      <div class="hit-analysis">
        <div class="hit-analysis-controls"><i class="hit-side-dot" data-side-swatch="Hits side filter"></i></div>
        <div class="hit-card"><i class="hit-side-dot" data-side-swatch="Hits side card"></i></div>
        <div class="hit-trend"><i class="hit-side-dot" data-side-swatch="Hits trend legend"></i></div>
      </div>
      <h3 class="roster-head"><i class="side-dot" data-side-swatch="roster header"></i></h3>
      <div class="battle-rail"><div class="battle-rail-side"><i class="side-dot" data-side-swatch="roster rail"></i></div></div>
      <section class="sides-col"><header class="sides-col-head"><i class="side-dot" data-side-swatch="side panel"></i></header></section>
      <div class="side-menu">
        <button class="side-menu-item"><i class="side-dot" data-side-swatch="side menu"></i></button>
        <button class="side-menu-item" data-test-focus><i class="side-dot" data-side-swatch="focused side menu"></i></button>
      </div>
      <div class="feed-row" aria-current="true"><span><i class="side-dot" data-side-swatch="current event"></i></span></div>
      <div style="background: var(--color-raised)"><i class="app-side-picker-dot" data-side-swatch="side picker trigger"></i></div>
      <ul class="app-side-picker-options">
        <li><i class="app-side-picker-dot" data-side-swatch="side picker option"></i></li>
        <li data-test-hover><i class="app-side-picker-dot" data-side-swatch="hovered side picker option"></i></li>
        <li aria-selected="true"><i class="app-side-picker-dot" data-side-swatch="selected side picker option"></i></li>
      </ul>
      <div class="kills">
        <button class="kills-row" data-test-hover><span class="kills-name"><i class="kills-dot" data-side-swatch="hovered kill"></i></span></button>
        <button class="kills-row kills-row--sel"><span class="kills-name"><i class="kills-dot" data-side-swatch="selected kill"></i></span></button>
      </div>`
    document.head.appendChild(style)
    document.body.appendChild(root)
    try {
      const fill = root.querySelector<HTMLElement>('.u7-top-track i')!
      const track = fill.parentElement!
      for (const side of [0, 1, 2, -1]) {
        const token = sideColor(side, [0, 1, 2])
        fill.style.background = token
        const color = channels(getComputedStyle(fill).backgroundColor)
        expect.soft(contrast(color, paintedBackground(track)), `side ${side} on pilot damage track`).toBeGreaterThanOrEqual(3)
        expect.soft(contrast(color, contrastBacking(track, track.parentElement)), `side ${side} at the edge of pilot damage track`).toBeGreaterThanOrEqual(3)
        for (const dot of root.querySelectorAll<HTMLElement>('[data-side-swatch]')) {
          if (dot.classList.contains('u7-side-dot')) dot.style.setProperty('--u7-side', token)
          else dot.style.background = token
          const backing = contrastBacking(dot, dot.parentElement)
          const computed = getComputedStyle(dot)
          const color = composite(channels(computed.backgroundColor), backing, Number(computed.opacity || 1))
          expect.soft(contrast(color, backing), `side ${side} on ${dot.dataset.sideSwatch}`).toBeGreaterThanOrEqual(3)
        }
      }
      for (const fill of root.querySelectorAll('.u7-fit-track i')) {
        const style = getComputedStyle(fill)
        const color = channels(style.borderTopStyle === 'dashed' ? style.borderTopColor : style.backgroundColor)
        const backing = paintedBackground(fill.parentElement)
        expect.soft(contrast(composite(color, backing), backing), 'fit stat fill or theoretical outline').toBeGreaterThanOrEqual(3)
      }
    } finally {
      root.remove()
      style.remove()
    }
  })

  it.each(['light', 'dark'])('keeps hit quality side marks at 3:1 on %s surfaces', (theme) => {
    const style = document.createElement('style')
    style.textContent = ['styles/tokens.css', 'battle/compare/hit-quality.css']
      .map((file) => readFileSync(resolve(appDirectory, file), 'utf8')).join('\n')
    const root = document.createElement('div')
    root.dataset.appearance = theme
    root.innerHTML = '<div class="u7-hit-quality"><span data-quality="Grazes" style="--quality-strength: 30%"></span></div>'
    document.head.appendChild(style)
    document.body.appendChild(root)
    try {
      const bar = root.querySelector<HTMLElement>('.u7-hit-quality')!
      const segment = bar.querySelector('span')!
      for (const surface of ['bg', 'surface', 'raised']) {
        root.style.background = `var(--color-${surface})`
        for (const side of [0, 1, 2, -1]) {
          bar.style.setProperty('--quality-side', sideColor(side, [0, 1, 2]))
          const computed = getComputedStyle(segment)
          const backing = paintedBackground(bar)
          const mark = computed.borderTopStyle === 'solid' && parseFloat(computed.borderTopWidth) >= 1
            ? computed.borderTopColor : computed.backgroundColor
          expect.soft(contrast(composite(channels(mark), backing), backing), `side ${side} on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    } finally {
      root.remove()
      style.remove()
    }
  })

  it('keeps the design guide aligned with individual events and sampled ranks', () => {
    const design = readFileSync(resolve('DESIGN.md'), 'utf8')
    expect.soft(design).not.toMatch(/\bdefaults?(?: to| is)? (?:the )?merged\b|\bmerged\b[^.\n]*\b(?:by default|(?:is|as) the default)\b/i)
    expect.soft(design).not.toMatch(/\b(?:bans?|forbids?|avoid|no|never)\b[^.\n]*\brank(?:ing)? columns?\b/i)
    expect.soft(design).not.toMatch(/\brank(?:ing)? columns? (?:are|is) (?:banned|forbidden|disallowed)\b/i)
    for (const name of ['--row-compact', '--fs-compact-table', '--fs-compact-body']) expect.soft(design).toContain(name)
  })

  it('uses a flat upload tray and a stroke for replay label legibility', () => {
    const upload = readFileSync(resolve(appDirectory, 'battle/upload/upload.css'), 'utf8')
    const replay = readFileSync(resolve(appDirectory, 'battle/replay/replay.css'), 'utf8')
    const tray = upload.match(/\.upload-tray\s*\{([^}]+)\}/)?.[1]
    const label = replay.match(/\.replay-pilot-label\s*\{([^}]+)\}/)?.[1]
    expect.soft(tray).not.toMatch(/box-shadow\s*:/)
    expect.soft(label).not.toMatch(/text-shadow\s*:/)
    expect.soft(label).toMatch(/-webkit-text-stroke\s*:\s*\d+px var\(--color-bg\)/)
    expect.soft(label).toMatch(/paint-order\s*:\s*stroke\b/)
  })

  it('lists every CSS token once and describes its use', () => {
    const css = readFileSync(resolve(appDirectory, 'styles/tokens.css'), 'utf8')
    const declared = [...new Set(Array.from(css.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]))]
    const listed = tokenGroups.flatMap(({ tokens }) => tokens.map(({ name }) => name))
    expect(listed.sort()).toEqual(declared.sort())
    expect(tokenGroups.every(({ tokens }) => tokens.every(({ use }) => use.trim()))).toBe(true)
  })

  it('keeps color literals in tokens.css', () => {
    const violations = filesIn(appDirectory)
      .filter((path) => /\.(?:[cm]?[jt]sx?|css|html|json|svg)$/.test(path) && !path.endsWith('/styles/tokens.css'))
      .filter((path) => hasColorLiteral(readFileSync(path, 'utf8'), path))
    expect(violations).toEqual([])
  })

  it.each(['hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'])('rejects the %s function', (name) => {
    expect(hasColorLiteral(`.sample { color: ${name}(0 0 0); }`, 'sample.css')).toBe(true)
  })

  it('rejects CSS named colors in declarations and JSX or canvas color properties', () => {
    const named = 'RebeccaPurple'
    expect({
      css: hasColorLiteral(`.sample { background: linear-gradient(var(--color-bg), ${named}); }`, 'sample.css'),
      jsx: hasColorLiteral(`<path fill="${named}" />`, 'sample.tsx'),
      style: hasColorLiteral(`<div style={{ backgroundColor: '${named}' }} />`, 'sample.tsx'),
      canvas: hasColorLiteral(`ctx.strokeStyle = '${named}'`, 'sample.ts'),
      variable: hasColorLiteral(`const fillColor = '${named}'`, 'sample.ts'),
      canvasAttribute: hasColorLiteral(`path.setAttribute('stroke', '${named}')`, 'sample.ts'),
      svg: hasColorLiteral(`<path fill="${named}" />`, 'sample.svg'),
    }).toEqual({ css: true, jsx: true, style: true, canvas: true, variable: true, canvasAttribute: true, svg: true })
  })

  it('declares the approved compact battle tokens', () => {
    const css = readFileSync(resolve(appDirectory, 'styles/tokens.css'), 'utf8')
    for (const [name, value] of [['--row-compact', '24px'], ['--fs-compact-table', '11px'], ['--fs-compact-body', '12px']]) {
      expect(css).toContain(`${name}: ${value}`)
      expect(tokenGroups.flatMap(({ tokens }) => tokens.map((token) => token.name))).toContain(name)
    }
  })

  it('allows token references, transparent and inherited values, and non-color text', () => {
    expect(hasColorLiteral('.white { background: color-mix(in srgb, var(--white) 50%, transparent); fill: currentColor; }', 'sample.css')).toBe(false)
    expect(hasColorLiteral('<span className="red">white</span>', 'sample.tsx')).toBe(false)
    expect(hasColorLiteral('.sample { background-image: url("/images/blue.png"); }', 'sample.css')).toBe(false)
    const tokenLookup = 'color'
    expect(hasColorLiteral(`ctx.fillStyle = ${tokenLookup}('bg')`, 'sample.ts')).toBe(false)
  })
})

const summary: BattleSummary = {
  meta: { brId: 'test', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], killmails: [], names: {} },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
}
const analysis: Analysis = {
  entities: {}, sideOverrides: [], interactions: [], ewarSpans: [], primaries: [], stats: [], coverage: [],
  timeline: { start: 0, damageBySide: {} },
}

describe('side display', () => {
  it('starts with our side, then sorts opponents by population and breaks ties by side ID', () => {
    const coverage = [11, 7, 11, 4].map((known, side) => ({ side, known, withLog: 0 }))
    const order = sideOrder({ ...analysis, coverage }, 3)
    expect(order).toEqual([3, 0, 2, 1])
    expect(order.map((side) => sideColor(side, order))).toEqual([
      'var(--color-side-0)', 'var(--color-side-1)', 'var(--color-side-2)', 'var(--color-side-n)',
    ])
    expect(order.map((side) => sideLetter(side, order))).toEqual([null, null, null, 'D'])
    expect(sideColor(-1, order)).toBe('var(--color-side-n)')
    expect(sideLetter(-1, order)).toBeNull()
    expect(sideOrder({ ...analysis, coverage: coverage.slice(0, 2) }, 1)).toEqual([1, 0])
  })

  it('counts distinct assigned uploaders, including manual side changes', () => {
    const log = { id: 'a', charId: 1, charName: 'Pilot', side: 0, events: 0, uploadedAt: 0 }
    expect(defaultOursSide({
      ...summary,
      logs: [log, { ...log, id: 'b' }, { ...log, id: 'c', charId: 2, side: 1 }, { ...log, id: 'd', charId: 3, side: 1 }],
    })).toBe(1)
    expect(defaultOursSide({
      ...summary,
      logs: [log],
      sideOverrides: [{ subject: 'char:1', side: 1, source: 'manual', setAt: 1 }],
    })).toBe(1)
    expect(defaultOursSide(summary)).toBe(0)
  })
})

describe('browser stores', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.history.replaceState(null, '', '/')
  })

  it('reads and writes ours, t and sel, preserving the rest of the URL', () => {
    window.history.replaceState(null, '', '/b/test?ours=1&t=1000&sel=char%3A42&x=keep#top')
    let view!: ReturnType<typeof useView> & ReturnType<typeof usePlayback>
    function Probe() {
      view = { ...useView(), ...usePlayback() }
      return null
    }
    act(() => root.render(createElement(ViewProvider, { children: createElement(Probe) })))
    expect([view.oursSide, view.t, view.selected]).toEqual([1, 1000, 'char:42'])
    expect([...view.layers]).toEqual(['dmgOurs', 'dmgTheirs', 'primary', 'kills'])
    act(() => {
      view.setOursSide(3)
      view.seek(2500)
      view.select('name:飞行员 & 舰船')
    })
    const url = new URL(window.location.href)
    expect(Object.fromEntries(url.searchParams)).toEqual({ ours: '3', t: '2500', sel: 'name:飞行员 & 舰船', x: 'keep' })
    expect(url.hash).toBe('#top')
    act(() => {
      view.setFocusOnly(true)
      view.select(null)
    })
    expect(view.focusOnly).toBe(false)
    expect(new URLSearchParams(window.location.search).has('sel')).toBe(false)
    act(() => {
      window.history.replaceState(null, '', '/b/test?ours=2&t=500&sel=ship%3A43%3A-1')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect([view.oursSide, view.t, view.selected]).toEqual([2, 500, 'ship:43:-1'])
  })

  it('applies every WebSocket message and fetches new analysis with its previous ETag', async () => {
    let socket!: FakeSocket
    class FakeSocket extends EventTarget {
      close = vi.fn()
      constructor(readonly url: string) {
        super()
        socket = this
      }
      server(message: ServerMessage) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket)
    const nextAnalysis = { ...analysis, timeline: { start: 3, damageBySide: {} } }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(summary))
      .mockResolvedValueOnce(Response.json(analysis, { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(Response.json(nextAnalysis, { headers: { ETag: '"v2"' } }))
    vi.stubGlobal('fetch', fetcher)
    let battle!: ReturnType<typeof useBattle>
    function Probe() {
      battle = useBattle('test')
      return null
    }
    await act(async () => root.render(createElement(Probe)))
    expect(socket.url).toMatch(/^ws:\/\/.*\/api\/battles\/test\/ws$/)
    expect(battle).toMatchObject({ status: 'ready', analysis, live: false })
    const log = { id: 'a', charId: 1, charName: 'Pilot', side: 0, events: 15, uploadedAt: 0 }
    const fit = { charId: 1, eft: '[Ship, Fit]', setAt: 100 }
    const override = { subject: 'char:1', side: 1, source: 'manual', setAt: 1 } as const
    const names = { Pilot: { charId: 1, side: 0 } }
    await act(async () => {
      socket.dispatchEvent(new Event('open'))
      socket.server({ type: 'snapshot', state: summary })
      socket.server({ type: 'log_added', log, names })
      socket.server({ type: 'log_added', log, names })
      socket.server({ type: 'fit_set', fit })
      socket.server({ type: 'sides_set', overrides: [override] })
      socket.server({ type: 'analysis_ready', version: 2 })
    })
    expect(battle).toMatchObject({ live: true, analysis: nextAnalysis })
    expect(battle.summary).toMatchObject({ logs: [log], fits: [fit], sideOverrides: [override], names, analysisVersion: 2 })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const [url, init] = fetcher.mock.calls[2]!
    expect(url).toBe('/api/battles/test/analysis')
    expect(new Headers(init?.headers).get('If-None-Match')).toBe('"v1"')
  })
})
