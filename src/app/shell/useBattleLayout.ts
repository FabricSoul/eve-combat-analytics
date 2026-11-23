import { useEffect, useState } from 'react'

const phone = '(width < 760px)'
const tablet = '(760px <= width < 1100px)'

function readLayout() {
  if (window.matchMedia?.(phone).matches) return 'phone'
  if (window.matchMedia?.(tablet).matches) return 'tablet'
  return 'desktop'
}

export function useBattleLayout() {
  const [layout, setLayout] = useState(readLayout)
  useEffect(() => {
    const queries = [window.matchMedia?.(phone), window.matchMedia?.(tablet)]
    const update = () => setLayout(readLayout())
    for (const query of queries) query?.addEventListener('change', update)
    update()
    return () => {
      for (const query of queries) query?.removeEventListener('change', update)
    }
  }, [])
  return layout
}
