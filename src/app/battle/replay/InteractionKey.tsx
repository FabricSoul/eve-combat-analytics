import { useEffect, useRef, useState } from 'react'
import { hitQualityScale } from '../compare/hit-quality'
import { makePainter, type ReplaySample } from './paint'

const samples = [
  ['伤害', 'damage'],
  ['维修', 'repair'],
  ['点 / 扰频', 'point'],
  ['中和 / 吸电', 'neut'],
  ['击毁', 'kill'],
  ['受击震动', 'shake'],
] as const satisfies readonly (readonly [string, ReplaySample])[]

const qualities = hitQualityScale.map(({ key, label }): readonly [string, ReplaySample] => [
  label, key === 'miss' ? 'miss' : { quality: key },
])

const previews: readonly (readonly [string, ReplaySample])[] = [...samples, ...qualities]
const width = 90
const height = 34

export function InteractionKey() {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)
  const canvases = useRef(new Map<string, HTMLCanvasElement>())

  useEffect(() => {
    if (!open || !menu.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    const scale = window.devicePixelRatio || 1
    const painters = previews.flatMap(([label, sample]) => {
      const canvas = canvases.current.get(label)
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return []
      canvas.width = width * scale
      canvas.height = height * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
      return [{ painter: makePainter(context, context, menu.current!, refresh), sample }]
    })
    let frame: number | null = null
    const start = performance.now()
    function render(now: number) {
      for (const { painter, sample } of painters) {
        painter.paintSample(sample, width, height, now - start, reduced.matches)
      }
      frame = reduced.matches ? null : requestAnimationFrame(render)
    }
    function refresh() {
      if (disposed) return
      if (frame !== null) cancelAnimationFrame(frame)
      for (const { painter } of painters) painter.refreshTokens()
      render(performance.now())
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] })
    reduced.addEventListener('change', refresh)
    render(start)
    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      reduced.removeEventListener('change', refresh)
    }
  }, [open])

  function entry([label]: readonly [string, ReplaySample]) {
    return <div key={label}>
      <canvas ref={(canvas) => {
        if (canvas) canvases.current.set(label, canvas)
        else canvases.current.delete(label)
      }} style={{ width, height }} aria-hidden="true" />
      <span>{label}</span>
    </div>
  }

  return (
    <details name="replay-controls" ref={menu} className="replay-menu replay-key" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>交互图例</summary>
      <div className="replay-popover">
        <div className="replay-key-samples">{samples.map(entry)}</div>
        <div className="replay-key-quality">命中质量 · 由强到弱</div>
        <div className="replay-key-samples">{qualities.map(entry)}</div>
      </div>
    </details>
  )
}
