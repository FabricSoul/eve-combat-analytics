import type { ReactNode } from 'react'
import type { UploadStatus } from './queue'

const paths: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  loader: <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M4 17v3h16v-3" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  calendarX: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M10 14l4 4M14 14l-4 4" /></>,
  fileX: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M10 13l4 4M14 13l-4 4" /></>,
  fileDown: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 12v6M9 15l3 3 3-3" /></>,
  link: <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
  )
}

export const statusIcon: Record<UploadStatus, IconName> = {
  queued: 'clock', uploading: 'upload', parsing: 'loader', done: 'check', duplicate: 'copy',
  no_overlap: 'calendarX', not_a_gamelog: 'fileX', unknown_character: 'fileX', too_large: 'fileX', failed: 'fileX',
}
