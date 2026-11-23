import { KillsList } from '../../battle/KillsList'

function KillsListSection() {
  return <div style={{ width: 340, border: '1px solid var(--color-hair)', background: 'var(--color-surface)' }}><KillsList /></div>
}

export default { title: '击毁列表', order: 80, Component: KillsListSection }
