import type { ReactNode } from 'react'

const paths = {
  layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18m-12 0v10m6-10v10" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
  sort: <path d="M8 20V4m-4 4 4-4 4 4m4-4v16m-4-4 4 4 4-4" />,
  popout: <><path d="M13 4h7v7m0-7-8 8" /><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  collapse: <path d="M5 12h14" />,
  expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m6-16v16" /></>,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  grip: <g fill="currentColor" stroke="none">{[5, 12, 19].flatMap((y) => [9, 15].map((x) =>
    <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}</g>,
  add: <path d="M5 12h14m-7-7v14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>

export type WorkspaceIconName = keyof typeof paths

export function WorkspaceIcon({ name, size = 15 }: { name: WorkspaceIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
}

export function WorkspaceAction({ icon, children }: { icon: WorkspaceIconName; children: ReactNode }) {
  return <><WorkspaceIcon name={icon} /><span className="battle-control-label" aria-hidden="true">{children}</span></>
}
