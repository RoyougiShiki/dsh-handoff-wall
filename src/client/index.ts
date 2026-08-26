/**
 * @dsh-external/dsh-handoff-board — client：better-sidebar「交接板」Tab。
 * 两个视图同一数据：📋 列表（信息密度）/ 🧭 时间线（泳道墙，纯 CSS 无画布依赖）。
 * 数据来自宿主路由 /handoff-board/*；三按钮中的「打开原对话」v0.1 暂缺（雾区）。
 */
import { createElement as rc, useEffect, useState } from 'react'

const BASE = '/handoff-board'

interface NoteV {
  id: string
  threadId: string
  sessionId: string
  createdAt: number
  title: string
  body: string
  files: string[]
  provenance: string
  status: string
}
interface ThreadV {
  id: string
  title: string
  projectKey: string
  createdAt: number
}
interface StateV {
  ok: boolean
  threads: ThreadV[]
  notes: NoteV[]
}

async function getJSON<T>(path: string): Promise<T> {
  return (await fetch(BASE + path)).json() as Promise<T>
}
async function postJSON(path: string, body: unknown): Promise<any> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

function injectStyles(): void {
  if (document.getElementById('hb-styles')) return
  const style = document.createElement('style')
  style.id = 'hb-styles'
  style.textContent = `
.hb-wrap{font-family:system-ui,sans-serif;padding:10px;font-size:13px;color:inherit}
.hb-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.hb-toggle{display:flex;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;overflow:hidden}
.hb-toggle button{border:none;background:transparent;color:inherit;padding:3px 10px;cursor:pointer;font-size:12px}
.hb-toggle button.on{background:color-mix(in srgb,currentColor 14%,transparent);font-weight:700}
.hb-thread{margin:10px 0}
.hb-thread h3{margin:4px 0;font-size:13px;opacity:.85}
.hb-note{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:6px 8px;margin:6px 0;cursor:pointer}
.hb-note:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.hb-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hb-badge{font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid currentColor;opacity:.85}
.hb-title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-id{font-family:monospace;font-size:11px;opacity:.55}
.hb-body{max-height:340px;overflow:auto;background:color-mix(in srgb,currentColor 6%,transparent);border-radius:6px;padding:8px;white-space:pre-wrap;font-size:12px;line-height:1.5;margin-top:6px}
.hb-files{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.hb-chip{font-family:monospace;font-size:10px;border:1px dashed currentColor;border-radius:4px;padding:0 4px;opacity:.75}
.hb-actions{display:flex;gap:6px;margin-top:6px}
.hb-btn{cursor:pointer;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:12px}
.hb-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.hb-empty{opacity:.6;padding:20px;text-align:center}
/* ── 时间线墙 ── */
.hb-tl-rowlabel{font-size:11px;opacity:.75;margin:8px 0 2px;font-weight:600}
.hb-tl-lane{position:relative;height:56px;border-bottom:1px dashed color-mix(in srgb,currentColor 20%,transparent);margin-bottom:2px}
.hb-tl-card{position:absolute;top:8px;transform:translateX(-50%);max-width:180px;border:1px solid currentColor;border-radius:7px;padding:3px 7px;font-size:11px;cursor:pointer;line-height:1.35;background:color-mix(in srgb,currentColor 5%,transparent)}
.hb-tl-card:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.hb-tl-card .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-tl-card .d{opacity:.6;font-size:10px}
.hb-tl-card.archived{opacity:.55;border-style:dashed}
.hb-tl-axis{display:flex;justify-content:space-between;font-size:10px;opacity:.55;margin-top:2px}`
  document.head.appendChild(style)
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
}


function NoteCard(props: {
  note: NoteV
  onContinue: (id: string) => void
  onGenerate: (sessionId: string) => void
}): any {
  const [open, setOpen] = useState(false)
  const n = props.note
  const badgeStyle =
    n.status === '进行中'
      ? { background: 'rgba(46,160,67,.15)', borderColor: 'rgba(46,160,67,.6)' }
      : { opacity: 0.7 }
  return rc(
    'div',
    { className: 'hb-note', onClick: () => setOpen((v) => !v) },
    rc(
      'div',
      { className: 'hb-meta' },
      rc('span', { className: 'hb-badge', style: badgeStyle }, n.status),
      rc('span', { className: 'hb-title' }, n.title),
      rc('span', { className: 'hb-id' }, n.id.slice(0, 8)),
    ),
    open &&
      rc('div', null, [
        rc('div', {
          key: 'body',
          className: 'hb-body',
          onClick: (e: Event) => e.stopPropagation(),
        }, n.body || '（空）'),
        n.files.length > 0 &&
          rc('div', { key: 'files', className: 'hb-files', onClick: (e: Event) => e.stopPropagation() },
            n.files.slice(0, 12).map((f) => rc('span', { key: f, className: 'hb-chip' }, f)),
            n.files.length > 12 ? rc('span', { className: 'hb-chip' }, `+${n.files.length - 12}`) : null,
          ),
        rc('div', { key: 'act', className: 'hb-actions', onClick: (e: Event) => e.stopPropagation() }, [
          rc('button', {
            key: 'cont', className: 'hb-btn',
            onClick: () => props.onContinue(n.id),
          }, '🔗 开新对话'),
          rc('button', {
            key: 'gen', className: 'hb-btn',
            onClick: () => props.onGenerate(n.sessionId),
          }, '✍️ 补写交接'),
        ]),
      ]),
  )
}

/** 时间线墙：线程一行泳道，条按 createdAt 定位。 */
function TimelineView(props: { state: StateV }): any {
  const notes = props.state.notes
  if (notes.length === 0) return null
  const times = notes.map((n) => n.createdAt)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(max - min, 60_000)
  const pos = (t: number): number => 4 + ((t - min) / span) * 92 // 4%~96%，防贴边

  return rc('div', null, [
    ...props.state.threads.map((t) => {
      const list = notes.filter((n) => n.threadId === t.id)
      if (list.length === 0) return null
      return rc('div', { key: t.id }, [
        rc('div', { className: 'hb-tl-rowlabel' }, `${t.title} · ${list.length} 条`),
        rc(
          'div',
          { className: 'hb-tl-lane' },
          list.map((n) =>
            rc(
              'div',
              {
                key: n.id,
                className: 'hb-tl-card' + (n.status === '已归档' ? ' archived' : ''),
                style: { left: pos(n.createdAt) + '%' },
                title: `${n.title}\n${fmt(n.createdAt)} · ${n.status}\n点击下方列表查看全文`,
              },
              [
                rc('div', { className: 't' }, n.title.slice(0, 18)),
                rc('div', { className: 'd' }, fmt(n.createdAt)),
              ],
            ),
          ),
        ),
      ])
    }),
    rc('div', { className: 'hb-tl-axis' }, [
      rc('span', null, fmt(min)),
      rc('span', null, fmt(max)),
    ]),
    rc('p', { style: { opacity: 0.55, fontSize: 11 } },
      '时间线只管「先后与连续」；点条看不了全文——切回 📋 列表视图展开。'),
  ])
}

export function BoardApp(): any {
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const reload = async (): Promise<void> => {
    try {
      setState(await getJSON<StateV>('/state'))
    } catch { /* 宿主未就绪时静默 */ }
  }
  useEffect(() => { void reload() }, [])

  const onContinue = async (noteId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/continue', { noteId })
      alert(r.ok ? `已创建接续会话 ${String(r.newSessionId).slice(0, 13)}…\n交接条全文已注入为首条消息。` : '失败: ' + r.error)
    } finally {
      setBusy(false)
    }
  }
  const onGenerate = async (sessionId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/generate', { sessionId })
      alert(r.ok ? `已补写交接条：${r.title}` : '失败: ' + r.error)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  if (!state?.ok) {
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-empty' }, state ? '账本加载异常' : '正在加载交接板…'),
      rc('div', { style: { textAlign: 'center' } },
        rc('button', { className: 'hb-btn', onClick: () => void reload() }, '重试')),
    )
  }

  const notesByThread = new Map<string, NoteV[]>()
  for (const n of state.notes) {
    const list = notesByThread.get(n.threadId) ?? []
    list.push(n)
    notesByThread.set(n.threadId, list)
  }

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'head', className: 'hb-head' }, [
      rc('strong', { key: 't' }, '📌 交接板'),
      rc('span', { key: 'c', style: { opacity: 0.6 } }, `${state.notes.length} 条 · ${state.threads.length} 线程`),
      rc('span', { key: 'sp', style: { flex: 1 } }),
      rc('div', { key: 'tg', className: 'hb-toggle' }, [
        rc('button', { key: 'l', className: view === 'list' ? 'on' : '', onClick: () => setView('list') }, '📋 列表'),
        rc('button', { key: 'tl', className: view === 'timeline' ? 'on' : '', onClick: () => setView('timeline') }, '🧭 时间线'),
      ]),
      rc('button', { key: 'r', className: 'hb-btn', disabled: busy, onClick: () => void reload() }, '↻'),
    ]),
    state.notes.length === 0
      ? rc('div', { key: 'empty', className: 'hb-empty' },
          '还没有交接条。在任意会话里敲 /handoff 生成第一条。')
      : view === 'timeline'
        ? rc(TimelineView, { key: 'tl', state })
        : state.threads.map((t) => {
            const list = notesByThread.get(t.id) ?? []
            if (list.length === 0) return null
            return rc('div', { key: t.id, className: 'hb-thread' }, [
              rc('h3', { key: 'h' }, `${t.title}`),
              ...list.map((n) =>
                rc(NoteCard, { key: n.id, note: n, onContinue, onGenerate }),
              ),
            ])
          }),
  ])
}

type SidebarCtx = {
  effect(fn: () => (() => void) | void, tag?: string): void
  betterSidebar?: {
    registerTab(descriptor: Record<string, unknown>): () => void
  }
  slots?: SlotsShape
} & Record<string, unknown>

export const inject = ['betterSidebar', 'slots']

type SlotsShape = {
  inject(name: string, register: () => unknown): void
  register(desc: Record<string, unknown>): unknown
}

async function glance(): Promise<void> {
  try {
    const s = (await (await fetch(BASE + '/state')).json()) as StateV
    if (!s.ok) throw new Error('state 异常')
    const recent = s.notes
      .slice(0, 3)
      .map((n) => `· ${n.title}（${n.status}）`)
      .join('\n')
    alert(`📌 交接板：${s.notes.length} 条 / ${s.threads.length} 线程\n最近：\n${recent || '（空）'}`)
  } catch (e) {
    alert('交接板暂不可达：' + String(e).slice(0, 80))
  }
}

export function apply(ctx: SidebarCtx): void {
  const bs = ctx.betterSidebar
  if (bs) {
    ctx.effect(() =>
      bs.registerTab({
        id: 'handoff-board:wall',
        title: () => '交接板',
        icon: (size?: number) => rc('span', { style: { fontSize: (size ?? 16) + 'px' } }, '📌'),
        order: 55,
        single: true,
        component: function BoardShell(): any {
          return rc(BoardApp)
        },
      }),
      'handoff-board: tab',
    )
  }

  // 侧栏底部「📌 速览」：满足 slots 骨架契约，同时是个真功能
  const slots = ctx.slots
  if (slots) {
    ctx.effect(() =>
      slots.inject('sidebar.footer.action', () =>
        slots.register({
          name: 'sidebar.footer.action',
          id: 'handoff-board:glance',
          label: () => '交接板速览',
          component: () => ({
            render() {
              const el = document.createElement('button')
              el.textContent = '📌'
              el.title = '交接板速览'
              el.style.cssText =
                'cursor:pointer;border:none;background:transparent;color:inherit;font-size:15px;padding:2px'
              el.onclick = () => { void glance() }
              return el
            },
          }),
        }),
      ),
      'handoff-board: glance',
    )
  }

  if (!bs && !slots) {
    console.warn('[dsh-handoff-board] better-sidebar 与 slots 均不可用，client 无处落脚')
  } else {
    console.info('[dsh-handoff-board] client registered（Tab＋速览按钮）')
  }
}
