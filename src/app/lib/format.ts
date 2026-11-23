const grouped = new Intl.NumberFormat('en-US')
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const tenth = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
const lastDate = 8_640_000_000_000_000

function format(value: number | null | undefined, display: (value: number) => string): string {
  return value != null && Number.isFinite(value) ? display(value) : '—'
}

export const fmtNum = (value: number | null | undefined) => format(value, (n) => grouped.format(n))
export const fmtIsk = (value: number | null | undefined, decimals: 0 | 1 = 1) =>
  format(value, (n) => `${(decimals === 0 ? whole : tenth).format(n / 100_000_000)} 亿`)
export const fmtHms = (value: number | null | undefined) => format(value, (n) => Math.abs(n) <= lastDate ? clock.format(n) : '—')
export const fmtSec = (value: number | null | undefined) => format(value, (n) => `${Math.round(n * 2) / 2} s`)
export const fmtPct = (value: number | null | undefined) => format(value, (n) => percent.format(n))
export const fmtDate = (value: number | null | undefined) => format(value, (n) => Math.abs(n) <= lastDate ? day.format(n) : '—')
