import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { api } from '../api/client'
import { fmtDate, fmtHms, fmtNum } from '../lib/format'
import { Button } from '../ui/Button'
import { brErrorMessage, validateBrInput } from './br-input'
import { readRecent, recordRecent } from './recent'
import './home.css'

export interface HomePageProps {}

function navigate(path: string) {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const clock = (ms: number) => fmtHms(ms).slice(0, 5)

export function HomePage(_props: HomePageProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent] = useState(readRecent)
  // Only the latest user intent may navigate: opening another battle or leaving the page cancels a pending create.
  const intent = useRef(0)
  useEffect(() => () => { intent.current += 1 }, [])

  async function open(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const checked = validateBrInput(value)
    if (!checked.ok) return setError(checked.message)
    setError('')
    setBusy(true)
    const mine = ++intent.current
    try {
      const { brId } = await api.createBattle(value.trim())
      if (mine !== intent.current) return
      // The battle page records the summary it actually loaded (title, dates, counts).
      recordRecent({ brId, openedAt: Date.now() })
      navigate(`/b/${encodeURIComponent(brId)}`)
    } catch (failure) {
      if (mine !== intent.current) return
      setError(brErrorMessage(failure))
      setBusy(false)
    }
  }

  function follow(event: MouseEvent<HTMLAnchorElement>, brId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    intent.current += 1
    navigate(`/b/${encodeURIComponent(brId)}`)
  }

  return (
    <div className="home">
      <form className="home-form" onSubmit={(event) => void open(event)} noValidate>
        <input className="home-input" value={value} aria-label="BR 链接" placeholder="https://br.evetools.org/br/…"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'home-error' : 'home-hint'} spellCheck={false}
          onChange={(event) => { setValue(event.target.value); setError('') }} />
        <Button type="submit" variant="primary" className="home-open" disabled={busy}>{busy ? '正在打开…' : '打开'}</Button>
      </form>
      {error
        ? <div id="home-error" className="home-error" role="alert">{error}</div>
        : <div id="home-hint" className="home-hint">
          支持 br.evetools.org 的 BR 链接，以及 br.evetools / zKillboard 的 related 链接（星系 + 时间）。还没有 BR？先在 br.evetools.org 用 zKill 链接生成一个。
        </div>}
      {recent.length > 0 && (
        <section className="home-recent" aria-labelledby="home-recent-title">
          <h2 id="home-recent-title">最近的战斗</h2>
          {recent.map((battle) => (
            <a key={battle.brId} className="home-recent-row" href={`/b/${encodeURIComponent(battle.brId)}`}
              onClick={(event) => follow(event, battle.brId)}>
              <span className="home-recent-name">{battle.title ?? battle.brId}</span>
              <span className="home-recent-meta">
                {battle.start !== undefined && battle.end !== undefined && <span className="app-number">{`${fmtDate(battle.start)} ${clock(battle.start)}–${clock(battle.end)}`}</span>}
              </span>
              <span className="home-recent-count">
                {battle.kills !== undefined && <><span className="app-number">{fmtNum(battle.kills)}</span> 次击毁</>}
              </span>
              <span className="home-recent-count">
                {battle.logs !== undefined && <>日志 <span className="app-number">{fmtNum(battle.logs)}</span></>}
              </span>
            </a>
          ))}
        </section>
      )}
    </div>
  )
}
