import { useEffect, useMemo, useState } from 'react'
import type { Analysis } from '@/core/contract'
import { useView, type ReplayNoiseFilter } from '@/app/state/view-store'

type Classify = typeof import('@/core/data/item-types').damageNoise
let classify: Classify | undefined
let catalog: Promise<Classify> | undefined

function loadClassifier() {
  catalog ??= import('@/core/data/item-types').then(({ damageNoise }) => {
    classify = damageNoise
    return damageNoise
  }).catch((error: unknown) => {
    catalog = undefined
    throw error
  })
  return catalog
}

export function useNoiseFilteredAnalysis(analysis: Analysis | null) {
  const { hiddenNoise } = useView()
  const needsCatalog = hiddenNoise.has('drones') || hiddenNoise.has('smartbombs')
  const [classifyDamage, setClassifyDamage] = useState<Classify | undefined>(() => classify)
  useEffect(() => {
    if (!needsCatalog || classifyDamage) return
    let mounted = true
    void loadClassifier().then((classifier) => {
      if (mounted) setClassifyDamage(() => classifier)
    }).catch(() => {})
    return () => { mounted = false }
  }, [needsCatalog, classifyDamage])

  return useMemo(() => {
    if (!analysis || !hiddenNoise.size) return analysis
    const interactions = analysis.interactions.filter(({ kind, amount, weapon }) => {
      if (kind === 'miss') return !hiddenNoise.has('misses')
      if (kind !== 'damage') return true
      if (hiddenNoise.has('small') && amount < 100) return false
      const noise = needsCatalog && weapon ? classifyDamage?.(weapon) : null
      return !noise || !hiddenNoise.has(noise)
    })
    return interactions.length === analysis.interactions.length ? analysis : { ...analysis, interactions }
  }, [analysis, hiddenNoise, needsCatalog, classifyDamage])
}

const options: readonly [ReplayNoiseFilter, string][] = [
  ['drones', '隐藏无人机/战斗机伤害'],
  ['smartbombs', '隐藏立体炸弹伤害'],
  ['small', '隐藏小额伤害（低于 100）'],
  ['misses', '隐藏未命中'],
]

export function ReplayNoiseControls() {
  const { hiddenNoise, toggleNoiseFilter } = useView()

  return (
    <details name="replay-controls" className="replay-menu replay-noise">
      <summary>伤害过滤{hiddenNoise.size > 0 && <span className="replay-number"> · {hiddenNoise.size}</span>}</summary>
      <div className="replay-popover">
        <p className="replay-noise-scope">影响回放、此刻交火和事件</p>
        {options.map(([filter, label]) => (
          <label key={filter}>
            <input type="checkbox" checked={hiddenNoise.has(filter)} onChange={() => toggleNoiseFilter(filter)} />
            {label}
          </label>
        ))}
      </div>
    </details>
  )
}
