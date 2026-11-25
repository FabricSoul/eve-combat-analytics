import { useContext, useEffect, useMemo, useState } from 'react'
import type { CalculatedFitStats } from '@/fit/client'
import type { BattleSummary, Entity, FitEntry, FitStats, Interaction, KillmailFit, RepairType } from '@/core/contract'
import { parseEft, type EftModule, type ParsedEft } from '@/fit/eft'
import { fmtHms, fmtNum } from '../lib/format'
import { useBattleContext } from '../state/battle-store'
import { api, ApiFailure, type VersionedFit } from '../api/client'
import { useBattleUndo, useEditHistory } from './undo'
import { useView } from '../state/view-store'
import { Button } from '../ui/Button'
import { TypeIcon } from '../ui/TypeIcon'
import { FitServices, firingSummary, isSameFit, loadFitCatalog, pilotFit, type FitCatalog } from './person/fit-data'
import './person/person.css'

export interface FitTabProps {}

const eftLimit = 64 * 1024
const repairNames: Record<RepairType, string> = {
  armor: '装甲', shield: '护盾', hull: '结构', capacitor: '电容',
}
const num = (value: number | null) => fmtNum(value === null ? null : Math.round(value))
const emptyInteractions: Interaction[] = []
const warning = '深渊模块缺少变异数据时按基础属性计算，理论值会偏离实际。'
const overwritten = '已被他人的新配装覆盖，无法撤销'
type FitText = Pick<FitEntry, 'eft' | 'mutated'>

export function FitTab(_props: FitTabProps) {
  const { summary, analysis } = useBattleContext()
  const { selected, select, setDrawerTab, range } = useView()
  const pilot = selected ? analysis?.entities[selected] : undefined
  const pilots = useMemo(() => Object.values(analysis?.entities ?? {}).filter(({ charId }) => charId !== null)
    .sort((a, b) => a.name.localeCompare(b.name)), [analysis])
  const interactions = useMemo(() => {
    if (!analysis) return emptyInteractions
    return range ? analysis.interactions.filter(({ t }) => t >= range[0] && t <= range[1]) : analysis.interactions
  }, [analysis, range])

  if (!summary || !analysis) return <p className="u7-fit-hint" role="status">正在加载配装数据…</p>
  if (!pilot || pilot.charId === null) {
    return <div className="u7-fit">
      {pilot ? <p>此实体没有角色 ID，无法添加配装。</p> : <label>选择飞行员
        <select className="app-select" value="" onChange={(event) => {
          const choice = pilots.find(({ key }) => key === event.currentTarget.value)
          if (choice) {
            select(choice.key)
            setDrawerTab('fit')
          }
        }}>
          <option value="" disabled>选择飞行员</option>
          {pilots.map(({ key, name }) => <option value={key} key={key}>{name}</option>)}
        </select>
      </label>}
    </div>
  }

  return <PilotFit key={`${summary.meta.brId}/${pilot.charId}`} pilot={pilot} charId={pilot.charId}
    summary={summary} interactions={interactions} />
}

function PilotFit({ pilot, charId, summary, interactions }: {
  pilot: Entity; charId: number; summary: BattleSummary; interactions: readonly Interaction[]
}) {
  const services = useContext(FitServices)
  const beginUndo = useBattleUndo()
  const history = useEditHistory('fit')
  const remote = pilotFit(summary, charId)
  const [saved, setSaved] = useState<VersionedFit>()
  const [lastRemote, setLastRemote] = useState(remote)
  if (remote !== lastRemote) {
    setLastRemote(remote)
    if (!remote || (saved && remote.setAt >= saved.setAt)) setSaved(undefined)
  }
  const fit = remote && (!saved || remote.setAt >= saved.setAt) ? remote : saved
  const [draft, setDraft] = useState<(FitText & { source?: KillmailFit }) | null>(null)
  const [savedImport, setSavedImport] = useState<{ result: KillmailFit; setAt: number }>()
  const [killId, setKillId] = useState<number>()
  const [busy, setBusy] = useState<'import' | 'save' | null>(null)
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const editor = draft !== null || !fit
  const text = draft?.eft ?? fit?.eft ?? ''
  const tooLarge = new TextEncoder().encode(text).length > eftLimit
  const losses = useMemo(() => summary.meta.killmails.filter(({ victim, hash }) => victim.charId === charId && Boolean(hash))
    .sort((a, b) => b.t - a.t || b.id - a.id), [summary.meta.killmails, charId])
  const loss = losses.find(({ id }) => id === killId) ?? losses[0]
  const headerId = /^\[[^\r\n]+,\s*Killmail (\d+)\]/m.exec(text)?.[1]
  const currentImport = editor ? draft?.source : savedImport?.setAt === fit?.setAt ? savedImport?.result : undefined
  const importDetails = currentImport?.eft === text ? currentImport : undefined
  const sourceId = importDetails?.killmailId ?? (headerId === undefined ? undefined : Number(headerId))
  const sourceLoss = losses.find(({ id }) => id === sourceId)
  const imported = sourceId !== undefined
  const theoryEft = fit?.eft
  const [calculation, setCalculation] = useState<{ eft: string; stats?: CalculatedFitStats; failed?: boolean; retry: number }>()
  const activeCalc = calculation?.eft === theoryEft && calculation?.retry === retry ? calculation : undefined
  const actual = useMemo(() => firingSummary(interactions, pilot.key), [interactions, pilot.key])
  const parsed = useMemo(() => {
    if (!text.trim() || tooLarge) return undefined
    try { return parseEft(text) } catch { return undefined }
  }, [text, tooLarge])
  const [catalog, setCatalog] = useState<FitCatalog | null>()
  const needsCatalog = Boolean(parsed?.modules.length || parsed?.stacks.length || actual.weapons.length)
  const loadingItems = needsCatalog && catalog === undefined

  useEffect(() => {
    if (!loadingItems) return
    let active = true
    void loadFitCatalog().then(
      (items) => { if (active) setCatalog(items) },
      () => { if (active) setCatalog(null) },
    )
    return () => { active = false }
  }, [loadingItems])

  useEffect(() => {
    if (!theoryEft) return
    let active = true
    void services.compute(theoryEft).then(
      (stats) => { if (active) setCalculation({ eft: theoryEft, stats, retry }) },
      () => { if (active) setCalculation({ eft: theoryEft, failed: true, retry }) },
    )
    return () => { active = false }
  }, [services, theoryEft, retry])

  async function importFit() {
    if (!loss || busy) return
    setBusy('import')
    setError(undefined)
    try {
      const result = await services.load(loss.id, loss.hash)
      setDraft({ eft: result.eft, mutated: result.mutated ?? [], source: result })
    } catch {
      setError('无法从击毁报告带入配装，请重试。')
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (busy || tooLarge || !parsed) return
    setBusy('save')
    setError(undefined)
    const finish = beginUndo()
    try {
      const brId = summary.meta.brId
      const key = `${brId}/fit:${charId}`
      const putFit = ({ eft, mutated }: FitText) => mutated?.length
        ? services.save(brId, charId, eft, mutated)
        : services.save(brId, charId, eft)
      const { entry, edit } = await history.run(key, async () => {
        const { previous, ...entry } = await putFit({ eft: text, mutated: draft?.mutated })
        const prior = previous === undefined ? fit : previous ?? undefined
        const { revision, sequence } = entry
        const edit = revision && history.record(finish.id, [{
          key, before: { tag: prior?.revision ?? null, value: prior }, after: { tag: revision, sequence, value: entry },
        }])
        return { entry, edit }
      })
      let echoedTag: string | null = null
      finish(!edit ? { label: '已保存配装' } : {
        label: '已保存配装',
        conflict: {
          label: overwritten,
          when: (state, revisions) => {
            if (state.meta.brId !== brId) return true
            if (history.isPending(key)) return false
            if (!history.canRevert(edit, revisions)) return true
            const head = history.current(key)!
            if (head.sequence !== undefined) return false
            // A legacy summary can still identify a newer fit by its saved value.
            const current = pilotFit(state, charId)
            if (isSameFit(current, head.value)) {
              echoedTag = head.tag
              return false
            }
            if (echoedTag === head.tag) return true
            // The summary can still show the fit replaced by our save or by our undo.
            if (current === head.overwritten || isSameFit(current, head.overwritten)) return false
            if (!current) return remote !== undefined
            return current.setAt >= (head.value?.setAt ?? entry.setAt) && !isSameFit(current, remote)
          },
        },
        revert: (_version, readRevisions) => history.run(key, async () => {
          const plan = history.plan(edit, readRevisions())
          if (!plan) return { unavailable: overwritten }
          const { value: priorFit, tag } = plan.changes[0]!
          try {
            let restored: VersionedFit | undefined
            let receipt
            if (priorFit) {
              const { previous: _, ...result } = await services.save(brId, charId, priorFit.eft, priorFit.mutated, tag)
              restored = receipt = result
            } else {
              receipt = await api.deleteFit(brId, charId, tag)
            }
            plan.commit(() => ({ value: restored, tag: receipt.revision ?? null, sequence: receipt.sequence }))
            setSaved(restored)
            return { reverted: plan.reverted }
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 412) return { unavailable: overwritten }
            throw error
          }
        }),
      })
      setSaved(entry)
      setSavedImport(importDetails ? { result: importDetails, setAt: entry.setAt } : undefined)
      setDraft(null)
    } catch {
      finish()
      setError('无法保存配装，请检查 EFT 文本后重试。')
    } finally {
      setBusy(null)
    }
  }

  const skippedLines = theoryEft === text ? activeCalc?.stats?.skippedLines ?? [] : []
  const substitutions = (editor ? draft?.mutated : fit?.mutated) ?? importDetails?.mutated
  const mutated = substitutions ?? [
    ...(parsed?.modules ?? []),
    ...(parsed?.stacks.flat() ?? []),
  ].filter(({ name, mutated }) =>
    (mutated || /\bAbyssal\b|深渊/i.test(name)) && !skippedLines.includes(name))
    .map(({ name }) => name)
  const skippedCount = importDetails?.skippedTypeIds?.length ?? 0
  return <div className="u7-fit">
    <div className="u7-fit-actions">
      {(!editor || loss) && <Button disabled={busy !== null} onClick={() => {
        setDraft({ eft: fit?.eft ?? '', mutated: fit?.mutated })
        setError(undefined)
      }}>粘贴 EFT</Button>}
      {losses.length > 1 && <label>击毁时间 <select className="app-select" disabled={busy !== null}
        value={loss?.id} onChange={(event) => setKillId(Number(event.currentTarget.value))}>
        {losses.map(({ id, t, victim }) => <option key={id} value={id}>
          {fmtHms(t)} · {victim.shipTypeId === null ? '未知舰船' : summary.meta.names[victim.shipTypeId]?.name ?? victim.shipTypeId}
        </option>)}
      </select></label>}
      {loss && <Button disabled={busy !== null} onClick={() => void importFit()}>
        {busy === 'import' ? '正在带入…' : '从击毁报告带入'}
      </Button>}
    </div>
    {error && <p role="alert" className="u7-fit-hint">{error}</p>}
    {editor && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>EFT 配装
        <textarea value={text} placeholder="[Ship, Fit name]" disabled={busy !== null}
          onChange={(event) => { setDraft({ eft: event.currentTarget.value }); setError(undefined) }} />
      </label>
      {tooLarge && <p role="alert" className="u7-fit-hint">配装文本超过 64 KiB。</p>}
      {!tooLarge && text.trim() && !parsed && <p className="u7-fit-hint">无法识别 EFT 格式，请检查文本。</p>}
      <div className="u7-fit-confirm">
        {fit && <Button disabled={busy !== null} onClick={() => {
          setDraft(null)
          setError(undefined)
        }}>取消</Button>}
        <Button type="submit" variant="primary" disabled={busy !== null || tooLarge || !parsed}>
          {busy === 'save' ? '正在保存…' : '保存配装'}
        </Button>
      </div>
    </form>}
    {skippedCount > 0 && <p className="u7-fit-hint" role="status">{fmtNum(skippedCount)} 个物品无法识别名称，已跳过。</p>}
    {skippedLines.length > 0 && <p className="u7-fit-hint" role="status">
      有 {fmtNum(skippedLines.length)} 行无法识别，已跳过：{skippedLines.join('、')}
    </p>}
    {mutated.length > 0 && <p className="u7-fit-hint">{warning} {Array.from(new Set(mutated)).join("、")}</p>}
    {loadingItems && <p role="status" className="u7-fit-hint">正在加载配装物品…</p>}
    <div className="u7-fit-columns">
      {parsed && <section className="u7-person-card u7-fit-racks">
        <h3>{parsed.ship}</h3>
        {imported && <p className="u7-secondary">来自击毁报告 {sourceLoss
          ? <time className="app-number">{fmtHms(sourceLoss.t)}</time>
          : <span className="app-number">{fmtNum(sourceId)}</span>}</p>}
        {!loadingItems && <FitItems fit={parsed} catalog={catalog} />}
      </section>}
      <section className="u7-person-card">
        <h3>输出（伤害 / 秒）</h3>
        {theoryEft && !activeCalc && <p role="status">正在计算理论值… pyfa 首次加载约 3–5 秒。</p>}
        {activeCalc?.failed && <p>无法计算理论值。 <Button onClick={() => setRetry(retry + 1)}>重试</Button></p>}
        <FitNumbers stats={activeCalc?.stats} actual={actual} hasLog={pilot.hasLog} catalog={catalog} />
      </section>
    </div>
  </div>
}

function FitItems({ fit, catalog }: { fit: ParsedEft; catalog?: FitCatalog | null }) {
  const racks = new Map<string, EftModule[]>()
  for (const module of fit.modules) {
    const slot = catalog?.moduleSlot(module.name) ?? '其他模块'
    const items = racks.get(slot) ?? []
    items.push(module)
    racks.set(slot, items)
  }
  return <div className="u7-fit-item-scroll">
    {[...racks].map(([slot, items]) => <div key={slot}>
      <h4>{slot}</h4>
      <ul className="u7-fit-items">{items.map(({ name, charge, offline }, index) => <li key={index}>
        <TypeIcon typeId={catalog?.itemId(name) ?? null} size={18} /><span title={name}>{name}
          {charge && <small> · {charge}</small>}{offline && <small> · 离线</small>}</span>
      </li>)}</ul>
    </div>)}
    {fit.stacks.length > 0 && <div>
      <h4>无人机 / 备用物品</h4>
      <ul className="u7-fit-items">{fit.stacks.flat().map(({ name, count }, index) => <li key={index}>
        <TypeIcon typeId={catalog?.itemId(name) ?? null} size={18} /><span title={name}>{name}</span>
        <span className="app-number">×{fmtNum(count)}</span>
      </li>)}</ul>
    </div>}
  </div>
}

function FitNumbers({ stats, actual, hasLog, catalog }: {
  stats?: FitStats; actual: ReturnType<typeof firingSummary>; hasLog: boolean; catalog?: FitCatalog | null
}) {
  const comparisons = [
    { label: '理论（pyfa）', value: stats?.dps.total ?? null, theory: true },
    { label: '开火时平均', value: actual.mean, help: '有开火记录的 10 秒区间内，每秒结算伤害的平均值。' },
    { label: '10 秒峰值', value: actual.peak, help: '任意连续 10 秒内最高的每秒结算伤害。' },
  ]
  const max = Math.max(1, ...comparisons.flatMap(({ value }) => value ?? []))
  return <>
    {comparisons.map(({ label, value, theory, help }) => <div className="u7-fit-number" key={label}>
      <span title={help}>{label}</span>
      <span className="u7-fit-track"><i data-theory={Boolean(theory)} style={{ width: `${(value ?? 0) / max * 100}%` }} /></span>
      <span className="app-number" title={value === null ? theory ? '暂无理论值' : hasLog ? '这段时间没有开火记录' : '没有上传他的战斗日志' : undefined}>
        {num(value)}
      </span>
    </div>)}
    {stats && <dl className="u7-fit-extra">
      <div><dt>理论齐射</dt><dd className="app-number">{num(stats.volley)}</dd></div>
      {(Object.keys(repairNames) as RepairType[]).filter((type) => stats.remoteRepair[type]).map((type) => <div key={type}>
        <dt>理论远修 · {repairNames[type]} / 秒</dt><dd className="app-number">{num(stats.remoteRepair[type] ?? 0)}</dd>
      </div>)}
      {!Object.values(stats.remoteRepair).some((value) => value > 0) && <div><dt>理论远修 / 秒</dt><dd className="app-number">0</dd></div>}
    </dl>}
    {actual.weapons.length > 0 && <>
      <h4>实际输出按武器</h4>
      <ul className="u7-fit-items">{actual.weapons.map(([weapon, damage]) => <li key={weapon}>
        <TypeIcon typeId={catalog?.itemId(weapon) ?? null} size={18} /><span title={weapon}>{weapon}</span>
        <span className="app-number">{num(damage)}</span>
      </li>)}</ul>
    </>}
    <p className="u7-fit-caveat">理论值使用全 V 技能和基础属性，未扣目标抗性。实际值使用战斗日志中的结算伤害。</p>
  </>
}
