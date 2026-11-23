import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Analysis, BattleSummary, ServerMessage } from '@/core/contract'
import { api, ApiFailure, battleApiPath } from '../api/client'

export interface BattleView {
  summary: BattleSummary | null
  analysis: Analysis | null
  status: 'loading' | 'ready' | 'error'
  error: ApiFailure | null
  live: boolean
}

export interface BattleData {
  summary: BattleSummary
  analysis: Analysis
}

const initialBattle: BattleView = { summary: null, analysis: null, status: 'loading', error: null, live: false }

function applyMessage(summary: BattleSummary, message: Exclude<ServerMessage, { type: 'snapshot' }>): BattleSummary {
  switch (message.type) {
    case 'log_added':
      return {
        ...summary,
        logs: summary.logs.some(({ id }) => id === message.log.id) ? summary.logs : [...summary.logs, message.log],
        names: { ...summary.names, ...message.names },
      }
    case 'fit_set':
      return {
        ...summary,
        fits: [...summary.fits.filter(({ charId }) => charId !== message.fit.charId), message.fit]
          .sort((a, b) => a.charId - b.charId),
      }
    case 'sides_set':
      return { ...summary, sideOverrides: message.overrides }
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
    let retryAnalysis: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = 1000
    let etag: string | undefined
    let analysisVersion = -1
    let wantedVersion = 0
    let fetching = false
    let receivedSnapshot = false

    function update(patch: Partial<BattleView>) {
      if (!active) return
      current = { ...current, ...patch }
      setResult({ brId, battle: current })
    }

    async function refreshAnalysis(version: number) {
      wantedVersion = Math.max(wantedVersion, version)
      if (!active || fetching || analysisVersion >= wantedVersion) return
      clearTimeout(retryAnalysis)
      fetching = true
      const requestedVersion = wantedVersion
      try {
        const value = await api.getAnalysis(id, etag)
        if (!active) return
        analysisVersion = requestedVersion
        if (value !== 'not_modified') {
          etag = value.etag ?? undefined
          const published = /^"v(\d+)"$/.exec(etag ?? '')?.[1]
          if (published) analysisVersion = Number(published)
          update({ analysis: value.analysis, error: current.summary ? null : current.error })
        }
        if (analysisVersion < requestedVersion) {
          retryAnalysis = setTimeout(() => void refreshAnalysis(wantedVersion), 2000)
        }
      } catch (error) {
        if (!active) return
        const failure = asFailure(error)
        // A new room can have a snapshot before the first analysis alarm fires.
        if (failure.status !== 503 && current.summary) update({ error: failure })
        if (failure.code !== 'br_not_found') {
          retryAnalysis = setTimeout(() => void refreshAnalysis(wantedVersion), 2000)
        }
      } finally {
        fetching = false
        if (active && requestedVersion < wantedVersion) void refreshAnalysis(wantedVersion)
      }
    }

    function applySnapshot(state: BattleSummary) {
      update({ summary: state, status: 'ready', error: null })
      void refreshAnalysis(state.analysisVersion)
    }

    function receive(event: MessageEvent<string>) {
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (message?.type === 'snapshot') {
        receivedSnapshot = true
        applySnapshot(message.state)
      } else if (message && current.summary) {
        update({ summary: applyMessage(current.summary, message) ?? current.summary })
        if (message.type === 'analysis_ready') void refreshAnalysis(message.version)
      }
    }

    function connect() {
      if (!active) return
      const address = new URL(`${battleApiPath(id)}/ws`, window.location.href)
      address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
      const connection = new WebSocket(address.href)
      socket = connection
      connection.addEventListener('open', () => {
        reconnectDelay = 1000
        update({ live: true })
      })
      connection.addEventListener('message', receive)
      connection.addEventListener('error', () => connection.close())
      connection.addEventListener('close', () => {
        update({ live: false })
        if (!active || current.error?.code === 'br_not_found') return
        reconnect = setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      })
    }

    void api.getBattle(brId).then((state) => {
      if (active && !receivedSnapshot) applySnapshot(state)
    }, (error: unknown) => {
      if (receivedSnapshot) return
      const failure = asFailure(error)
      update({ status: 'error', error: failure })
      if (failure.code === 'br_not_found') {
        clearTimeout(reconnect)
        socket?.close()
      }
    })
    connect()

    return () => {
      active = false
      clearTimeout(reconnect)
      clearTimeout(retryAnalysis)
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

export function BattleProvider({ brId, static: data, children }: BattleProviderProps) {
  const battle = useBattle(brId ?? null)
  const value: BattleView = data ? { ...data, status: 'ready', error: null, live: false } : battle
  return createElement(BattleContext.Provider, { value }, children)
}

export function useBattleContext(): BattleView {
  const battle = useContext(BattleContext)
  if (!battle) throw new Error('useBattleContext requires BattleProvider')
  return battle
}
