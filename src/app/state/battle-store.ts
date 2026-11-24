import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Analysis, BattleSummary, EntityKey, IdentityMerge, ServerMessage } from '@/core/contract'
import { api, ApiFailure, battleApiPath } from '../api/client'
import { foldIdentities } from './merge-view'

export interface BattleView {
  summary: BattleSummary | null
  analysis: Analysis | null
  analyzedSummary: BattleSummary | null
  status: 'loading' | 'ready' | 'error'
  error: ApiFailure | null
  live: boolean
  reconnecting: boolean
}

export interface BattleData {
  summary: BattleSummary
  analysis: Analysis
}

const initialBattle: BattleView = {
  summary: null, analysis: null, analyzedSummary: null, status: 'loading', error: null, live: false, reconnecting: false,
}
const socketRetryStart = 1000
const analysisRetryStart = 2000
const pollInterval = 15_000
const failedReconnectLimit = 3
const nextDelay = (delay: number) => Math.min(delay * 2, 15_000)

function applyMessage(summary: BattleSummary, message: Exclude<ServerMessage, { type: 'snapshot' }>): BattleSummary {
  switch (message.type) {
    case 'log_added':
      return {
        ...summary,
        meta: message.metaNames ? { ...summary.meta, names: { ...summary.meta.names, ...message.metaNames } } : summary.meta,
        logs: summary.logs.some(({ id }) => id === message.log.id) ? summary.logs : [...summary.logs, message.log],
        names: { ...summary.names, ...message.names },
      }
    case 'fit_set':
      return {
        ...summary,
        fits: [...summary.fits.filter(({ charId }) => charId !== message.fit.charId), message.fit]
          .sort((a, b) => a.charId - b.charId),
      }
    case 'fit_removed':
      return { ...summary, fits: summary.fits.filter(({ charId }) => charId !== message.charId) }
    case 'sides_set':
      return { ...summary, sideOverrides: message.overrides }
    case 'identities_set':
      return { ...summary, identityMerges: message.merges }
    case 'analysis_ready':
      return { ...summary, analysisVersion: Math.max(summary.analysisVersion, message.version) }
  }
}

function asFailure(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure('network', '无法连接到服务器')
}

export function useBattle(brId: string | null): BattleView {
  const [result, setResult] = useState({ brId, battle: initialBattle })

  useEffect(() => {
    if (brId === null) return
    const id = brId
    let active = true
    let current = initialBattle
    let socket: WebSocket | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setTimeout> | undefined
    let pollGeneration = 0
    let retryAnalysis: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = socketRetryStart
    let analysisDelay = analysisRetryStart
    let failedReconnects = 0
    let missing = false
    let etag: string | undefined
    let analysisVersion = -1
    let wantedVersion = 0
    let publishedSummary: BattleSummary | null = null
    let fetching = false

    function update(patch: Partial<BattleView>) {
      if (!active) return
      current = { ...current, ...patch }
      setResult({ brId, battle: current })
    }

    function requestAnalysis(version: number) {
      if (version > wantedVersion) {
        wantedVersion = version
        clearTimeout(retryAnalysis)
        retryAnalysis = undefined
      }
      if (retryAnalysis === undefined) void refreshAnalysis()
    }

    function deferAnalysis() {
      retryAnalysis = setTimeout(() => {
        retryAnalysis = undefined
        void refreshAnalysis()
      }, analysisDelay)
      analysisDelay = nextDelay(analysisDelay)
    }

    async function refreshAnalysis() {
      if (!active || missing || fetching || analysisVersion >= wantedVersion) return
      fetching = true
      const requestedVersion = wantedVersion
      const requestedSummary = publishedSummary
      try {
        const value = await api.getAnalysis(id, etag)
        if (!active) return
        if (value !== 'not_modified') {
          etag = value.etag ?? undefined
          const published = /^"v(\d+)"$/.exec(etag ?? '')?.[1]
          analysisVersion = published ? Number(published) : requestedVersion
          const analyzedSummary = publishedSummary && publishedSummary.analysisVersion <= analysisVersion
            ? publishedSummary
            : requestedSummary && requestedSummary.analysisVersion <= analysisVersion ? requestedSummary : current.analyzedSummary
          update({ analysis: value.analysis, analyzedSummary })
        }
        if (analysisVersion >= requestedVersion) {
          analysisDelay = analysisRetryStart
          if (current.error && current.summary) update({ error: null })
        } else if (requestedVersion === wantedVersion) {
          deferAnalysis()
        }
      } catch (error) {
        if (!active) return
        const failure = asFailure(error)
        // A new room can have a snapshot before the first analysis alarm fires.
        if (failure.status !== 503 && current.summary) update({ error: failure })
        if (failure.code !== 'br_not_found' && requestedVersion === wantedVersion) {
          deferAnalysis()
        }
      } finally {
        fetching = false
        if (requestedVersion < wantedVersion && retryAnalysis === undefined) void refreshAnalysis()
      }
    }

    function publishSummary(state: BattleSummary) {
      if (publishedSummary && state.analysisVersion <= publishedSummary.analysisVersion) return
      publishedSummary = state
      // A newer ETag can arrive before the socket message that describes its snapshot.
      if (state.analysisVersion === analysisVersion) update({ analyzedSummary: state })
    }

    function applySnapshot(state: BattleSummary) {
      publishSummary(state)
      update({ summary: state, status: 'ready', error: null })
      requestAnalysis(state.analysisVersion)
    }

    function receive(event: MessageEvent<string>) {
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (message?.type === 'snapshot') {
        applySnapshot(message.state)
      } else if (message && current.summary) {
        const summary = applyMessage(current.summary, message) ?? current.summary
        update({ summary })
        if (message.type === 'analysis_ready') {
          publishSummary(summary)
          requestAnalysis(message.version)
        }
      }
    }

    async function pollSummary(generation: number) {
      const stillPolling = () => active && generation === pollGeneration && !current.live && !missing
      if (!stillPolling()) return
      try {
        const state = await api.getBattle(id)
        if (stillPolling()) applySnapshot(state)
      } catch (error) {
        if (stillPolling() && !current.summary) update({ status: 'error', error: asFailure(error) })
      } finally {
        if (stillPolling()) poll = setTimeout(() => void pollSummary(generation), pollInterval)
      }
    }

    function stopPolling() {
      pollGeneration++
      clearTimeout(poll)
    }

    function disconnected(isReconnect: boolean) {
      if (!active || missing) return
      if (isReconnect && !current.live) failedReconnects++
      update({ live: false, reconnecting: true })
      reconnect = setTimeout(() => connect(true), reconnectDelay)
      reconnectDelay = nextDelay(reconnectDelay)
      if (failedReconnects === failedReconnectLimit && isReconnect) {
        // The first fallback read is immediate. Later reads wait for the previous one to finish.
        void pollSummary(pollGeneration)
      }
    }

    function connect(isReconnect: boolean) {
      if (!active || missing) return
      const address = new URL(`${battleApiPath(id)}/ws`, window.location.href)
      address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
      let connection: WebSocket
      try {
        connection = new WebSocket(address.href)
      } catch {
        disconnected(isReconnect)
        return
      }
      socket = connection
      connection.addEventListener('open', () => {
        if (!active || missing || socket !== connection) return
        reconnectDelay = socketRetryStart
        failedReconnects = 0
        stopPolling()
        update({ live: true, reconnecting: false })
      })
      connection.addEventListener('message', receive)
      connection.addEventListener('error', () => connection.close())
      connection.addEventListener('close', () => {
        connection.removeEventListener('message', receive)
        if (socket !== connection) return
        socket = undefined
        disconnected(isReconnect)
      })
    }

    void api.getBattle(id).then((state) => {
      if (active && !current.summary) applySnapshot(state)
    }, (error: unknown) => {
      if (!active || current.summary) return
      const failure = asFailure(error)
      update({ status: 'error', error: failure })
      if (failure.code === 'br_not_found') {
        missing = true
        clearTimeout(reconnect)
        stopPolling()
        socket?.close()
        update({ live: false, reconnecting: false })
      }
    })
    connect(false)

    return () => {
      active = false
      clearTimeout(reconnect)
      clearTimeout(retryAnalysis)
      stopPolling()
      socket?.removeEventListener('message', receive)
      socket?.close()
    }
  }, [brId])

  return result.brId === brId ? result.battle : initialBattle
}

const BattleContext = createContext<BattleView | null>(null)

export type BattleProviderProps = {
  children: ReactNode
} & ({ brId: string; static?: never } | { brId?: never; static: BattleData })

/** What the user did locally to an unidentified entity, until the server's state shows the same thing. */
interface LocalOp { to: IdentityMerge['to'] | null; seq: number; at: number }
type LocalIdentities = ReadonlyMap<EntityKey, LocalOp>
/** Apply an identity merge (or its removal, to = null) locally until the server's state matches; the returned function rolls it back. */
const LocalIdentityContext = createContext<((from: EntityKey, to: IdentityMerge['to'] | null) => () => void) | null>(null)
export const useLocalIdentity = () => useContext(LocalIdentityContext)
/** A server echo older than the user's last action is ignored; give up waiting after this long. */
const localOpLifetime = 60_000

function serverTo(summary: BattleSummary | null, from: EntityKey): IdentityMerge['to'] | null {
  return summary?.identityMerges?.find((merge) => merge.from === from)?.to ?? null
}

function withLocal(summary: BattleSummary | null, local: LocalIdentities): BattleSummary | null {
  if (!summary || local.size === 0) return summary
  const merges = (summary.identityMerges ?? []).filter(({ from }) => !local.has(from))
  for (const [from, { to }] of local) if (to) merges.push({ from, to, setAt: Date.now() })
  return { ...summary, identityMerges: merges }
}

export function BattleProvider({ brId, static: data, children }: BattleProviderProps) {
  const battle = useBattle(brId ?? null)
  const [local, setLocal] = useState<LocalIdentities>(new Map())
  const seq = useRef(0)
  const base: BattleView = data ? { ...initialBattle, ...data, analyzedSummary: data.summary, status: 'ready' } : battle
  const serverMerges = base.summary?.identityMerges
  // A local op ends when the server's list says what the user asked for; a stale echo (an older state) leaves it standing.
  useEffect(() => {
    setLocal((previous) => {
      let next: Map<EntityKey, LocalOp> | null = null
      for (const [from, op] of previous) {
        if (serverTo(base.summary, from) === op.to || Date.now() - op.at > localOpLifetime) (next ??= new Map(previous)).delete(from)
      }
      return next ?? previous
    })
  }, [serverMerges])
  const apply = useCallback((from: EntityKey, to: IdentityMerge['to'] | null) => {
    const mine = ++seq.current
    setLocal((previous) => new Map(previous).set(from, { to, seq: mine, at: Date.now() }))
    return () => setLocal((previous) => {
      if (previous.get(from)?.seq !== mine) return previous // a newer local action owns this entity now
      const next = new Map(previous)
      next.delete(from)
      return next
    })
  }, [])

  // Analyses the user's later action has outdated: an entity they un-merged locally must not vanish because the server
  // finished folding the earlier merge. Hold the last analysis that still had it.
  const shown = useRef<Analysis | null>(null)
  const analysis = useMemo(() => {
    let current = base.analysis
    if (current && shown.current) {
      for (const [from, op] of local) {
        if (op.to === null && shown.current.entities[from] && !current.entities[from]) { current = shown.current; break }
      }
    }
    shown.current = current
    return current && local.size ? foldIdentities(current, [...local].flatMap(([from, { to }]) => to ? [{ from, to }] : [])) : current
  }, [base.analysis, local])
  const value = useMemo<BattleView>(() => ({ ...base, analysis, summary: withLocal(base.summary, local) }), [base, analysis, local])
  return createElement(LocalIdentityContext.Provider, { value: apply }, createElement(BattleContext.Provider, { value }, children))
}

export function useBattleContext(): BattleView {
  const battle = useContext(BattleContext)
  if (!battle) throw new Error('useBattleContext requires BattleProvider')
  return battle
}
