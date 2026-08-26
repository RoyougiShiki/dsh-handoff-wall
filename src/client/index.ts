/**
 * @dsh-external/dsh-handoff-board — client：主区视图（conversation.view 插槽）。
 * 与「对话」「轨迹」并列切换。双视图：📋 列表 / 🧭 时间线泳道。
 */
import { createElement as rc, useEffect, useState } from 'react'

const BASE = '/handoff-board'

interface NoteV {
  parentSession?: string
  kind?: string
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
interface UnnotedV {
  sessionId: string
  createdAt: number
  status: string
  kind: string
}
interface StateV {
  ok: boolean
  threads: ThreadV[]
  notes: NoteV[]
  unnoted?: UnnotedV[]
}

interface SessionsApi {
  binding(sessionId: string): unknown
  open(sessionId: string): void
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

const STYLE_CSS = `
.hb-wrap{font-family:system-ui,sans-serif;padding:14px;font-size:13px;color:inherit;height:100%;overflow:auto;box-sizing:border-box}
.hb-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.hb-head strong{font-size:15px}
.hb-cnt{opacity:.6}
.hb-sp{flex:1}
.hb-toggle{display:flex;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;overflow:hidden}
.hb-toggle button{border:none;background:transparent;color:inherit;padding:4px 12px;cursor:pointer;font-size:12px}
.hb-toggle button.on{background:color-mix(in srgb,currentColor 14%,transparent);font-weight:700}
.hb-thread{margin:12px 0}
.hb-thread h3{margin:4px 0;font-size:13px;opacity:.85}
.hb-note{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:8px 10px;margin:8px 0;cursor:pointer;max-width:860px}
.hb-note:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.hb-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hb-badge{font-size:11px;padding:1px 8px;border-radius:9px;border:1px solid currentColor;opacity:.85}
.hb-badge.live{background:rgba(46,160,67,.15);border-color:rgba(46,160,67,.6)}
.hb-title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-id{font-family:monospace;font-size:11px;opacity:.55}
.hb-body{max-height:46vh;overflow:auto;background:color-mix(in srgb,currentColor 6%,transparent);border-radius:6px;padding:10px;white-space:pre-wrap;font-size:12.5px;line-height:1.55;margin-top:8px}
.hb-files{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.hb-chip{font-family:monospace;font-size:10px;border:1px dashed currentColor;border-radius:4px;padding:0 4px;opacity:.75}
.hb-actions{display:flex;gap:8px;margin-top:8px}
.hb-btn{cursor:pointer;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;font-size:12px}
.hb-btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
.hb-btn:disabled{opacity:.45;cursor:default}
.hb-empty{opacity:.6;padding:32px;text-align:center}
/* 子代理折叠组 */
.hb-subgroup{margin:6px 0 6px 26px}
.hb-subgroup summary{cursor:pointer;font-size:12px;opacity:.8;list-style:none}
.hb-subgroup summary::before{content:'▸ ';}
.hb-subgroup[open] summary::before{content:'▾ ';}
.hb-note.sub{margin-left:0;border-style:dotted}
/* 时间线泳道 */
.hb-tl-rowlabel{font-size:11px;opacity:.75;margin:10px 0 2px;font-weight:600}
.hb-tl-lane{position:relative;height:64px;border-bottom:1px dashed color-mix(in srgb,currentColor 20%,transparent);margin:0 90px 2px}
.hb-tl-card{position:absolute;top:9px;transform:translateX(-50%);max-width:150px;border:1px solid currentColor;border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer;line-height:1.35;background:color-mix(in srgb,currentColor 5%,transparent)}
.hb-tl-card:hover{background:color-mix(in srgb,currentColor 14%,transparent)}
.hb-tl-card.picked{outline:2px solid currentColor}
.hb-tl-card .t{font-weight:600;max-width:136px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-tl-card .d{opacity:.6;font-size:10px}
.hb-tl-card.archived{opacity:.55;border-style:dashed}
.hb-tl-axis{display:flex;justify-content:space-between;font-size:10px;opacity:.55;margin-top:2px}`

function injectStyles(): void {
  if (document.getElementById('hb-styles')) return
  const style = document.createElement('style')
  style.id = 'hb-styles'
  style.textContent = STYLE_CSS
  document.head.appendChild(style)
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
}

interface Handlers {
  busy: boolean
  expandedId: string | null
  onToggle(id: string): void
  onContinue(noteId: string): void
  onGenerate(sessionId: string): void
}

function NoteCard(props: { note: NoteV } & Handlers): any {
  const n = props.note
  const open = props.expandedId === n.id
  const live = n.status === '进行中'
  return rc(
    'div',
    { className: 'hb-note', onClick: () => props.onToggle(n.id) },
    rc(
      'div',
      { className: 'hb-meta' },
      rc('span', { className: 'hb-badge' + (live ? ' live' : '') }, n.status),
      n.kind === 'subagent' ? rc('span', { className: 'hb-badge' }, '↳🤖 子代理') : null,
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
            n.files.slice(0, 14).map((f) => rc('span', { key: f, className: 'hb-chip' }, f)),
            n.files.length > 14 ? rc('span', { className: 'hb-chip' }, `+${n.files.length - 14}`) : null,
          ),
      ]),
  )
}

/** 时间线：线程一行泳道，卡片按 createdAt 定位。 */
function TimelineView(props: { state: StateV; pickedId: string | null; onPick(id: string): void }): any {
  const notes = props.state.notes
  if (notes.length === 0) return null
  const times = notes.map((n) => n.createdAt)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(max - min, 60_000)
  const pos = (t: number): number => 8 + ((t - min) / span) * 84

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
                className:
                  'hb-tl-card' +
                  (n.status === '已归档' ? ' archived' : '') +
                  (props.pickedId === n.id ? ' picked' : ''),
                style: { left: pos(n.createdAt) + '%' },
                title: `${n.title}\n${fmt(n.createdAt)} · ${n.status} · 点击查看全文`,
                onClick: () => props.onPick(n.id),
              },
              [
                rc('div', { className: 't' }, n.title.slice(0, 22)),
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
    rc('p', { className: 'hb-tip' }, '点击气泡 → 跳到列表并展开该条全文。'),
  ])
}

export function BoardApp(props: { busy: boolean; expandedId: string | null; state: StateV | null; onReload(): void; onPick(id: string): void }): any {
  // 简单透传，实际逻辑在调用侧组装
  return rc('div', { className: 'hb-wrap' }, 'BoardApp placeholder')
}

type ClientCtx = {
  effect(fn: () => (() => void) | void, tag?: string): void
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: any): unknown
  }
  sessions?: SessionsApi
}

export const inject = ['slots', 'sessions']

export function apply(ctx: ClientCtx): void {
  // 主区视图：与「对话」「轨迹」并列的切换页签。order=100 排在轨迹之后。
  // 契约（照抄 ui-trajectory 标准写法）：register(描述符, React组件)，组件收 props 渲染。
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'handoff-board',
          order: 100,
          label: () => '交接板',
        },
        function BoardShell(props: Record<string, unknown>): any {
          return rc(_BoardApp, { sessions: ctx.sessions })
        },
      ),
    ),
    'handoff-board: view',
  )
  console.info('[dsh-handoff-board] client registered（主区视图：交接板，order=100）')
}

// ── 内部完整实现 ──

function _BoardApp(props: { sessions?: SessionsApi }): any {
  injectStyles()
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    try {
      setState(await getJSON<StateV>(`/state?t=${Date.now()}`))
    } catch { /* 静默 */ }
  }
  useEffect(() => { void reload() }, [])

  const waitAndOpen = async (sessionId: string): Promise<void> => {
    if (!props.sessions) {
      alert(`新会话已创建：${sessionId.slice(0, 13)}…（无法自动跳转）`)
      return
    }
    for (let i = 0; i < 12; i++) {
      try {
        if (props.sessions.binding(sessionId) !== undefined) break
      } catch { /* 等待 */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    props.sessions.open(sessionId)
  }

  const onContinue = async (noteId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/continue', { noteId })
      if (!r.ok) { alert('失败: ' + r.error); return }
      await reload()
      await waitAndOpen(r.newSessionId)
      if (r.warning) alert('⚠️ ' + r.warning)
    } finally {
      setBusy(false)
    }
  }

  const onGenerate = async (sessionId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/generate', { sessionId })
      alert(r.ok ? `✅ 已生成交接条：${r.title}` : '失败: ' + r.error)
      if (r.ok) await reload()
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

  const mainNotes = state.notes.filter((n) => !n.kind || n.kind !== 'subagent')
  const subNotes = state.notes.filter((n) => n.kind === 'subagent')
  const notesByThread = new Map<string, NoteV[]>()
  for (const n of mainNotes) {
    const list = notesByThread.get(n.threadId) ?? []
    list.push(n)
    notesByThread.set(n.threadId, list)
  }
  const subsByThread = new Map<string, NoteV[]>()
  for (const n of subNotes) {
    const list = subsByThread.get(n.threadId) ?? []
    list.push(n)
    subsByThread.set(n.threadId, list)
  }

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'head', className: 'hb-head' }, [
      rc('strong', { key: 't' }, '📌 交接板'),
      rc('span', { key: 'c', style: { opacity: 0.6 } }, `${state.notes.length} 条 · ${state.threads.length} 线程`),
      rc('span', { key: 'sp', style: { flex: 1 } }),
      rc('button', { key: 'r', className: 'hb-btn', disabled: busy, onClick: () => void reload() }, '↻ 刷新'),
    ]),
    state.notes.length === 0
      ? rc('div', { key: 'empty', className: 'hb-empty' },
          '还没有交接条。在任意会话里敲 /handoff 生成第一条。')
      : view === 'timeline'
        ? rc(TimelineView, { key: 'tl', state, pickedId: expandedId, onPick: (id: string) => { setExpandedId(id); setView('list') } })
        : state.threads.map((t) => {
            const mains = notesByThread.get(t.id) ?? []
            const subs = subsByThread.get(t.id) ?? []
            if (mains.length === 0 && subs.length === 0) return null
            return rc('div', { key: t.id, className: 'hb-thread' }, [
              rc('h3', { key: 'h' }, `${t.title}`),
              ...mains.map((n) => rc(NoteCard, { key: n.id, note: n, ...handlers })),
              subs.length > 0 &&
                rc(
                  'details',
                  { key: 'subs-' + t.id, className: 'hb-subgroup' },
                  [
                    rc('summary', null, `🤖 子代理记录（${subs.length}）`),
                    ...subs.map((n) => rc(NoteCard, { key: n.id, note: n, ...handlers })),
                  ],
                ),
            ])
          }),
  ])
}

const handlers: Handlers = {
  busy: false,
  expandedId: null,
  onToggle: () => {},
  onContinue: () => {},
  onGenerate: () => {},
}
