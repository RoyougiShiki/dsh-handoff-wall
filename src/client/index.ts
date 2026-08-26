/**
 * @dsh-external/dsh-handoff-board — client：主区视图（conversation.view 插槽）。
 * 与「对话」「轨迹」并列切换、同尺寸同位置——不是弹窗、不是全屏、不占侧栏。
 * 内部双视图：📋 列表 / 🧭 时间线（纯 CSS 泳道）。
 */
import { createElement as rc, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

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
.hb-wrap{font-family:system-ui,sans-serif;padding:14px;font-size:13px;color:inherit;height:100%;overflow:auto;box-sizing:border-box}
.hb-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.hb-head strong{font-size:15px}
.hb-head .cnt{opacity:.6}
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
/* ── 时间线泳道 ── */
.hb-tl-rowlabel{font-size:11px;opacity:.75;margin:10px 0 2px;font-weight:600}
.hb-tl-lane{position:relative;height:60px;border-bottom:1px dashed color-mix(in srgb,currentColor 20%,transparent);margin-bottom:2px}
.hb-tl-card{position:absolute;top:9px;transform:translateX(-50%);max-width:190px;border:1px solid currentColor;border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer;line-height:1.35;background:color-mix(in srgb,currentColor 5%,transparent)}
.hb-tl-card:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.hb-tl-card .t{font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-tl-card .d{opacity:.6;font-size:10px}
.hb-tl-card.archived{opacity:.55;border-style:dashed}
.hb-tl-axis{display:flex;justify-content:space-between;font-size:10px;opacity:.55;margin-top:2px}
.hb-tip{opacity:.5;font-size:11px;margin-top:10px}`
  document.head.appendChild(style)
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ')
}

function NoteCard(props: {
  note: NoteV
  busy: boolean
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
      n.provenance === 'raw' ? rc('span', { className: 'hb-badge' }, '占位') : null,
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
        rc('div', { key: 'act', className: 'hb-actions', onClick: (e: Event) => e.stopPropagation() }, [
          rc('button', {
            key: 'cont', className: 'hb-btn', disabled: props.busy,
            onClick: () => props.onContinue(n.id),
          }, '🔗 开新对话接续'),
          rc('button', {
            key: 'gen', className: 'hb-btn', disabled: props.busy,
            onClick: () => props.onGenerate(n.sessionId),
          }, '✍️ 补写交接条'),
        ]),
      ]),
  )
}

/** 时间线：线程一行泳道，条按 createdAt 定位。 */
function TimelineView(props: { state: StateV }): any {
  const notes = props.state.notes
  if (notes.length === 0) return null
  const times = notes.map((n) => n.createdAt)
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(max - min, 60_000)
  const pos = (t: number): number => 4 + ((t - min) / span) * 92

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
                title: `${n.title}\n${fmt(n.createdAt)} · ${n.status}`,
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
      if (r.ok) await reload()
    } finally {
      setBusy(false)
    }
  }
  const onGenerate = async (sessionId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/generate', { sessionId })
      alert(r.ok ? `✅ 已补写交接条：${r.title}` : '失败: ' + r.error)
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

  const notesByThread = new Map<string, NoteV[]>()
  for (const n of state.notes) {
    const list = notesByThread.get(n.threadId) ?? []
    list.push(n)
    notesByThread.set(n.threadId, list)
  }

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'head', className: 'hb-head' }, [
      rc('strong', { key: 't' }, '📌 交接板'),
      rc('span', { key: 'c', className: 'cnt' }, `${state.notes.length} 条 · ${state.threads.length} 线程`),
      rc('span', { key: 'sp', className: 'hb-sp' }),
      rc('div', { key: 'tg', className: 'hb-toggle' }, [
        rc('button', { key: 'l', className: view === 'list' ? 'on' : '', onClick: () => setView('list') }, '📋 列表'),
        rc('button', { key: 'tl', className: view === 'timeline' ? 'on' : '', onClick: () => setView('timeline') }, '🧭 时间线'),
      ]),
      rc('button', { key: 'r', className: 'hb-btn', disabled: busy, onClick: () => void reload() }, '↻ 刷新'),
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
                rc(NoteCard, { key: n.id, note: n, busy, onContinue, onGenerate }),
              ),
            ])
          }),
  ])
}

type ClientCtx = {
  effect(fn: () => (() => void) | void, tag?: string): void
  slots: {
    inject(name: string, register: () => unknown): void
    register(desc: Record<string, unknown>): unknown
  }
}

export const inject = ['slots']

export function apply(ctx: ClientCtx): void {
  // 主区视图：与「对话」「轨迹」并列切换（conversation.view 插槽）
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'handoff-board:view',
        label: () => '交接板',
        icon: (size?: number) => rc('span', { style: { fontSize: (size ?? 16) + 'px' } }, '📌'),
        component: () => ({
          render() {
            const host = document.createElement('div')
            host.style.height = '100%'
            const root = createRoot(host)
            root.render(rc(BoardApp))
            return host
          },
        }),
      }),
    ),
    'handoff-board: view',
  )
  console.info('[dsh-handoff-board] client registered（主区视图：交接板）')
}
