import { useEffect, useState } from 'react'

interface TokenGroup {
  title: string
  kind?: 'color'
  tokens: readonly { name: `--${string}`; use: string }[]
}

export const tokenGroups = [
  {
    title: '表面', kind: 'color', tokens: [
      { name: '--color-bg', use: '页面底色' },
      { name: '--color-surface', use: '抽屉、面板、弹层' },
      { name: '--color-raised', use: '按钮、悬停行、当前标签' },
    ],
  },
  {
    title: '文字', kind: 'color', tokens: [
      { name: '--color-text', use: '正文、所有数字' },
      { name: '--color-text-2', use: '次要文字、图例' },
      { name: '--color-text-3', use: '表头、时间、坐标轴' },
    ],
  },
  {
    title: '强调', kind: 'color', tokens: [
      { name: '--color-accent', use: '主按钮底、游标' },
      { name: '--color-accent-ink', use: '主按钮上的文字' },
      { name: '--color-accent-line', use: '锁定框、选中行左线、焦点环' },
      { name: '--color-sel', use: '选中行、当前事件行的底' },
    ],
  },
  {
    title: '边框', kind: 'color', tokens: [
      { name: '--color-hair', use: '分隔线、行线、控件边框' },
    ],
  },
  {
    title: '阵营与数据', kind: 'color', tokens: [
      { name: '--color-side-0', use: '我方的圆点、图标外圈、曲线和条形' },
      { name: '--color-side-1', use: '敌方的图形、失败图标' },
      { name: '--color-side-2', use: '第三方的图形' },
      { name: '--color-side-n', use: '第四方起和未分边的图形，另用字母区分第四方起的各方' },
      { name: '--color-repair', use: '维修弹道、维修图形' },
      { name: '--color-dead', use: '被击毁的节点和图标' },
    ],
  },
  {
    title: '字体', tokens: [
      { name: '--font-ui', use: '界面文字' },
      { name: '--font-mono', use: '等宽数字、时间、ISK' },
      { name: '--fs', use: '正文字号' },
      { name: '--fs-s', use: '表格、名单、事件流字号' },
      { name: '--fs-l', use: '小标题字号' },
      { name: '--fs-title', use: '页标题字号' },
      { name: '--lh', use: '正文行高' },
    ],
  },
  {
    title: '间距', tokens: [
      { name: '--row', use: '行高、控件高' },
      { name: '--touch-target', use: '手机和粗指针设备上触控目标的最小宽高' },
      { name: '--space-1', use: '相邻细节间距' },
      { name: '--space-2', use: '紧凑控件和图标间距' },
      { name: '--space-3', use: '行、表头和按钮横向内边距' },
      { name: '--space-4', use: '顶栏和面板内边距' },
      { name: '--space-6', use: '页面边距、区块间距' },
      { name: '--space-8', use: '大区块间距' },
    ],
  },
  {
    title: '紧凑战斗布局', tokens: [
      { name: '--row-compact', use: '模块中的名单与表格行高' },
      { name: '--fs-compact-table', use: '模块中的表格和名单字号' },
      { name: '--fs-compact-body', use: '战斗页面正文字号' },
    ],
  },
  {
    title: '圆角', tokens: [
      { name: '--radius-ctl', use: '按钮、输入框、头像' },
      { name: '--radius-card', use: '抽屉、卡片、面板' },
    ],
  },
  {
    title: '层叠', tokens: [
      { name: '--layer-popover', use: '让菜单和弹层显示在浮窗与抽屉上方' },
    ],
  },
  {
    title: '动效', tokens: [
      { name: '--ease', use: '过渡缓动' },
      { name: '--dur-hover', use: '悬停、按下' },
      { name: '--dur-edge-in', use: '弹道出现' },
      { name: '--dur-edge-fade', use: '弹道淡出' },
      { name: '--dur-move', use: '锁定框移动、抽屉进出' },
    ],
  },
] as const satisfies readonly TokenGroup[]

const groups: readonly TokenGroup[] = tokenGroups

export function TokensPage() {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const root = document.documentElement
    function readTokens() {
      const style = getComputedStyle(root)
      setValues(Object.fromEntries(groups.flatMap(({ tokens }) => tokens.map(({ name }) => [
        name, style.getPropertyValue(name).trim(),
      ]))))
    }
    readTokens()
    const observer = new MutationObserver(readTokens)
    observer.observe(root, { attributes: true, attributeFilter: ['data-appearance'] })
    return () => observer.disconnect()
  }, [])

  return (
    <section className="app-token-page" id="tokens" aria-labelledby="tokens-heading">
      <h1 id="tokens-heading">基础值</h1>
      <div className="app-token-groups">
        {groups.map(({ title, kind, tokens }) => (
          <section className="app-token-group" key={title}>
            <h2>{title}</h2>
            <dl className="app-token-list">
              {tokens.map(({ name, use }) => (
                <div key={name}>
                  <dt><code>{name}</code></dt>
                  <dd className="app-token-preview">
                    {kind === 'color' && <span className="app-token-swatch" aria-hidden="true" style={{ backgroundColor: `var(${name})` }} />}
                    <code className="app-token-value" data-token={name}>{values[name]}</code>
                  </dd>
                  <dd className="app-token-usage">{use}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  )
}
