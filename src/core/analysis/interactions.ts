import type { BattleState, Entity, EntityKey, EwarSpan, Interaction, LogEvent } from '../contract'
import { charKey } from './entities'
import { expectedSide, indexIdentities } from './identities'
import { assignedSide, type SideAssignments } from './sides'

interface Observation {
  interaction: Interaction
  outgoing: boolean
  hasPeerLog: boolean
  listenerId: number
}

function fromEvent(event: LogEvent, logId: string, from: EntityKey, to: EntityKey): Interaction {
  return {
    t: event.t,
    from,
    to,
    kind: event.kind === 'ewar_seen' ? 'ewar' : event.kind,
    amount: 'amount' in event ? event.amount : 0,
    weapon: 'weapon' in event ? event.weapon : 'module' in event ? event.module : null,
    quality: event.kind === 'damage' ? event.quality : null,
    repairType: event.kind === 'repair' ? event.repairType : null,
    ewar: 'ewar' in event ? event.ewar : null,
    sources: [{ logId, line: event.line }],
    corroborated: false,
  }
}

interface Queue {
  entries: Interaction[]
  head: number
}

interface Pending {
  all: Queue
  byWeapon: Map<Interaction['weapon'], Queue>
}

const queue = (): Queue => ({ entries: [], head: 0 })
const pending = (): Pending => ({ all: queue(), byWeapon: new Map() })

function oldest(reports: Queue | undefined, t: number): Interaction | undefined {
  if (!reports) return
  while (reports.head < reports.entries.length) {
    const report = reports.entries[reports.head]!
    if (!report.corroborated && t - report.t <= 1000) return report
    reports.head++
  }
}

function match(otherLog: Pending, report: Interaction): Interaction | undefined {
  if (report.weapon === null) return oldest(otherLog.all, report.t)
  const unlabelled = oldest(otherLog.byWeapon.get(null), report.t)
  const labelled = oldest(otherLog.byWeapon.get(report.weapon), report.t)
  if (!unlabelled) return labelled
  if (!labelled) return unlabelled

  if (unlabelled.t !== labelled.t) return unlabelled.t < labelled.t ? unlabelled : labelled
  const a = unlabelled.sources[0]!
  const b = labelled.sources[0]!
  // A listener may have uploaded multiple files. Follow file ID and line order for equal timestamps.
  return a.logId < b.logId || (a.logId === b.logId && a.line < b.line) ? unlabelled : labelled
}

function enqueue(log: Pending, report: Interaction): void {
  log.all.entries.push(report)
  let weaponQueue = log.byWeapon.get(report.weapon)
  if (!weaponQueue) {
    weaponQueue = queue()
    log.byWeapon.set(report.weapon, weaponQueue)
  }
  weaponQueue.entries.push(report)
}

interface EwarReports {
  events: Interaction[]
  firstActive: number
  nextByListener: Map<number, number>
}

function mergeEwar(reports: Map<string, EwarReports>, interaction: Interaction, listenerId: number): boolean {
  const { from, to, ewar, t } = interaction
  const key = JSON.stringify([from, to, ewar])
  let group = reports.get(key)
  if (!group) {
    group = { events: [], firstActive: 0, nextByListener: new Map() }
    reports.set(key, group)
  }

  // Each listener can report each activation once, and witnesses can join the
  // same activation only within one second of its earliest report.
  while (group.firstActive < group.events.length && t - group.events[group.firstActive]!.t > 1000) {
    group.firstActive++
  }
  const source = interaction.sources[0]!
  const next = Math.max(group.firstActive, group.nextByListener.get(listenerId) ?? 0)
  group.nextByListener.set(listenerId, next + 1)
  const earlier = group.events[next]
  if (!earlier) {
    group.events.push(interaction)
    return false
  }
  earlier.sources.push(source)
  earlier.corroborated = true
  return true
}

function dedupe(observations: Observation[]): Interaction[] {
  const interactions: Interaction[] = []
  const pendingByHit = new Map<string, { outgoing: Pending; incoming: Pending }>()
  const ewarReports = new Map<string, EwarReports>()
  for (const { interaction, outgoing, hasPeerLog, listenerId } of observations) {
    if (interaction.kind === 'ewar') {
      if (mergeEwar(ewarReports, interaction, listenerId)) continue
    } else if (hasPeerLog) {
      const { from, to, kind, amount, repairType } = interaction
      const key = `${from}/${to}/${kind}/${amount}/${repairType}`
      let bothLogs = pendingByHit.get(key)
      if (!bothLogs) {
        bothLogs = { outgoing: pending(), incoming: pending() }
        pendingByHit.set(key, bothLogs)
      }
      const earlier = match(outgoing ? bothLogs.incoming : bothLogs.outgoing, interaction)
      if (earlier) {
        earlier.sources.push(interaction.sources[0]!)
        earlier.corroborated = true
        earlier.weapon ??= interaction.weapon
        if (earlier.quality === 'none') earlier.quality = interaction.quality
        continue
      }
      enqueue(outgoing ? bothLogs.outgoing : bothLogs.incoming, interaction)
    }
    interactions.push(interaction)
  }
  return interactions
}

function distinctEvents(events: LogEvent[], retained: Set<string> | undefined): LogEvent[] {
  if (!retained) return events
  return events.filter((event) => {
    // Ignore the line number, which can differ for the same event across relogs.
    const key = JSON.stringify([
      event.t, event.kind, event.other.raw,
      'dir' in event ? event.dir : event.source.raw,
      'amount' in event ? event.amount : null,
      'weapon' in event ? event.weapon : 'module' in event ? event.module : null,
      'quality' in event ? event.quality : null,
      'repairType' in event ? event.repairType : null,
      'ewar' in event ? event.ewar : null,
    ])
    if (retained.has(key)) return false
    retained.add(key)
    return true
  })
}

export function collectInteractions(
  state: BattleState, entities: Map<EntityKey, Entity>, assignments: SideAssignments,
): Interaction[] {
  const logs = [...state.logs].sort((a, b) => a.charId - b.charId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const splitListeners = new Set<number>()
  const observations: Observation[] = []
  for (const { charId, charName } of logs) {
    const key = charKey(charId)
    const listener = entities.get(key)
    if (listener) {
      splitListeners.add(charId)
    } else {
      entities.set(key, { key, name: charName, charId, ...assignedSide(assignments, charId), shipTypes: [], hasLog: true })
    }
  }

  const identities = indexIdentities(state, logs, entities, assignments)
  const sides = state.meta.teams.length
  let previousListener: number | undefined
  let retained: Set<string> | undefined
  for (const log of logs) {
    const listenerId = log.charId
    if (listenerId !== previousListener) {
      previousListener = listenerId
      retained = splitListeners.has(listenerId) ? new Set() : undefined
    }
    const listener = charKey(listenerId)
    const side = entities.get(listener)!.side
    for (const event of distinctEvents(log.parsed.events, retained)) {
      const otherSide = expectedSide(event.kind, side, sides)
      const other = identities.resolve(event.other, otherSide, event.t, log)
      if (event.kind === 'ewar_seen') {
        const from = identities.resolve(event.source, otherSide, event.t, log)
        observations.push({
          interaction: fromEvent(event, log.id, from, other), outgoing: false, hasPeerLog: false, listenerId,
        })
        continue
      }
      const outgoing = event.dir === 'out'
      const from = outgoing ? listener : other
      const to = outgoing ? other : listener
      observations.push({
        interaction: fromEvent(event, log.id, from, to),
        outgoing,
        hasPeerLog: other !== listener && entities.get(other)!.hasLog,
        listenerId,
      })
    }
  }

  // The sort is stable. Equal timestamps follow character ID, file ID, then parser line order.
  observations.sort((a, b) => a.interaction.t - b.interaction.t)
  return dedupe(observations)
}

export function collectEwarSpans(interactions: Interaction[]): EwarSpan[] {
  const spans: EwarSpan[] = []
  const lastByEffect = new Map<string, EwarSpan>()
  for (const { ewar, from, to, t } of interactions) {
    if (ewar === null) continue
    const key = JSON.stringify([from, to, ewar])
    const previous = lastByEffect.get(key)
    if (previous && t - (previous.end - 5000) < 15_000) {
      previous.end = t + 5000
    } else {
      const span = { from, to, ewar, start: t, end: t + 5000 }
      spans.push(span)
      lastByEffect.set(key, span)
    }
  }
  return spans
}
