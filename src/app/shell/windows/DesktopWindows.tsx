import { useLayoutEffect, useState, type Dispatch, type ReactNode, type RefObject } from 'react'
import { WindowFrame } from './WindowFrame'
import { isPanel, windowIds, windowTitles, windowVisible, type Viewport, type WindowAction, type WindowId, type WindowLayout } from './layout'

export function WindowControls({ layout, dispatch }: { layout: WindowLayout; dispatch: Dispatch<WindowAction> }) {
  return <div className="app-window-controls" role="group" aria-label="窗口">
    {windowIds.map((id) => (
      <button key={id} type="button" aria-label={`${windowTitles[id]} 窗口`} aria-pressed={windowVisible(layout, id)}
        onClick={() => dispatch({ type: 'toggle', id })}>{windowTitles[id]}</button>
    ))}
    <button type="button" aria-label="恢复默认窗口布局" title="恢复默认布局" onClick={() => dispatch({ type: 'reset' })}>↺ 布局</button>
  </div>
}

export function useWindowViewport(desk: RefObject<HTMLDivElement | null>, enabled: boolean): Viewport {
  const [viewport, setViewport] = useState(() => ({
    width: Math.max(220, window.innerWidth), height: Math.max(120, window.innerHeight - 48),
  }))
  useLayoutEffect(() => {
    const element = desk.current
    if (!enabled || !element) return
    function measure() {
      if (!element) return
      const { clientWidth: width, clientHeight: height } = element
      if (width > 0 && height > 0) {
        setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [desk, enabled])
  return viewport
}

interface DesktopWindowsProps {
  desk: RefObject<HTMLDivElement | null>
  viewport: Viewport
  layout: WindowLayout
  dispatch: Dispatch<WindowAction>
  subtitles: Record<WindowId, string>
  content(id: WindowId, floating: boolean): ReactNode
}

export function DesktopWindows({ desk, viewport, layout, dispatch, subtitles, content }: DesktopWindowsProps) {
  return windowIds.filter((id) => windowVisible(layout, id)).map((id) => {
    const state = layout.windows[id]
    const region = id === 'feed' ? '事件流' : isPanel(id) && !state.floating ? '战斗数据' : windowTitles[id]
    return <WindowFrame key={id} id={id} title={windowTitles[id]} subtitle={subtitles[id]} region={region}
      kind={id === 'timeline' ? 'section' : 'aside'} desk={desk} viewport={viewport}
      state={state} zIndex={4 + layout.order.indexOf(id)} dispatch={dispatch}>
      {content(id, state.floating)}
    </WindowFrame>
  })
}
