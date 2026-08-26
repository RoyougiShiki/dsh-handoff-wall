/**
 * @dsh-external/dsh-handoff-board — client：主区视图（conversation.view 插槽）。
 * 与「对话」「轨迹」并列切换。双视图：📋 列表 / 🧭 时间线泳道。
 * 交互：点行展开全文；📂 打开原对话；🔗 接续后自动跳转；🤖 子代理标记；未生成条目可一键生成。
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
  cwd?: string
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
  workspaces?: string[]
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
.hb-select{background:transparent;color:inherit;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:6px;padding:3px 6px;font-size:12px}
.hb-check{display:flex;align-items:center;gap:3px;font-size:11px;opacity:.85}
.hb-thread{margin:12px 0}
.hb-thread h3{margin:4px 0;font-size:13px;opacity:.85}
.hb-note{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:8px 10px;margin:8px 0;cursor:pointer;max-width:860px}
.hb-note:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.hb-note.sub{margin-left:28px;border-style:dotted}
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
.hb-diag{color:#e5484d;padding:12px;border:1px solid #e5484d;border-radius:8px;font-family:monospace;font-size:11px;white-space:pre-wrap}
/* 时间线 */
.hb-tl-rowlabel{font-size:11px;opacity:.75;margin:10px 0 2px;font-weight:600}
.hb-tl-lane{position:relative;height:64px;border-bottom:1px dashed color-mix(in srgb,currentColor 20%,transparent);margin:0 90px 2px}
.hb-tl-card{position:absolute;top:9px;transform:translateX(-50%);max-width:150px;border:1px solid currentColor;border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer;line-height:1.35;background:color-mix(in srgb,currentColor 5%,transparent)}
.hb-tl-card:hover{background:color-mix(in srgb,currentColor 14%,transparent)}
.hb-tl-card.picked{outline:2px solid currentColor}
.hb-tl-card .t{font-weight:600;max-width:136px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-tl-card .d{opacity:.6;font-size:10px}
.hb-tl-card.archived{opacity:.55;border-style:dashed}
.hb-tl-card.subcard{opacity:.85;border-style:dotted}
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
  sessions?: SessionsApi
  busy: boolean
  expandedId: string | null
  onToggle(id: string): void
  onOpen(sessionId: string): void
  onContinue(noteId: string): void
  onGenerate(sessionId: string): void
}

function NoteCard(props: { note: NoteV } & Handlers): any {
  const n = props.note
  const open = props.expandedId === n.id
  const live = n.status === '进行中'
  const isSub = n.kind === 'subagent'
  return rc(
    'div',
    { className: 'hb-note' + (isSub ? ' sub' : ''), onClick: () => props.onToggle(n.id) },
    rc(
      'div',
      { className: 'hb-meta' },
      rc('span', { className: 'hb-badge' + (live ? ' live' : '') }, n.status),
      isSub ? rc('span', { className: 'hb-badge' }, '↳🤖 子代理') : null,
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
            key: 'open', className: 'hb-btn',
            onClick: () => props.onOpen(n.sessionId),
          }, '📂 打开原对话'),
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
                  (n.kind === 'subagent' ? ' subcard' : '') +
                  (props.pickedId === n.id ? ' picked' : ''),
                style: { left: pos(n.createdAt) + '%' },
                title: `${(n.kind === 'subagent' ? '↳🤖 ' : '') + n.title}\n${fmt(n.createdAt)} · ${n.status} · 点击查看全文`,
                onClick: () => props.onPick(n.id),
              },
              [
                rc('div', { className: 't' }, (n.kind === 'subagent' ? '↳' : '') + n.title.slice(0, 20)),
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

function HelpSection(): any {
  return rc('details', { style: { marginTop: '16px', opacity: 0.88 } }, [
    rc('summary', { style: { cursor: 'pointer', fontSize: '12px' } }, '❓ 使用说明'),
    rc('div', { style: { fontSize: '12px', lineHeight: '1.8' } }, [
      rc('div', null, '📋 列表：点行展开六段全文；📂 打开原对话跳回来源会话；🔗 开新对话接续（自动跳转并注入全文）；✍️ 补写交接条为该会话重新生成一份新的（不覆盖旧条）。'),
      rc('div', null, '🧭 时间线：一行一个项目线程，卡片位置＝发生时间，虚线小卡＝子代理；点气泡跳回列表展开。交接条多了以后，这里用来看「什么时候、哪个线程活跃、哪里有断层」。'),
      rc('div', null, '🟢 进行中 / ⚪ 已归档 徽章跟随来源会话实时状态；↻ 手动刷新读最新账本；🤖 子代理记录默认隐藏，勾选显示。'),
    ]),
  ])
}

export function BoardApp(props: { sessions?: SessionsApi }): any {
  injectStyles()
  const sessions = props.sessions
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showSub, setShowSub] = useState(false)
  const [wsSel, setWsSel] = useState<string>('all')

  const reload = async (): Promise<void> => {
    try {
      setState(await getJSON<StateV>(`/state?t=${Date.now()}`))
    } catch { /* 宿主未就绪时静默 */ }
  }
  useEffect(() => { void reload() }, [])

  const waitAndOpen = async (sessionId: string): Promise<void> => {
    if (!sessions) {
      alert(`新会话已创建：${sessionId.slice(0, 13)}…（当前客户端无法自动跳转，请在列表中查找）`)
      return
    }
    for (let i = 0; i < 12; i++) {
      try {
        if (sessions.binding(sessionId) !== undefined) break
      } catch { /* 未就绪继续等 */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    sessions.open(sessionId)
  }

  const onContinue = async (noteId: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await postJSON('/continue', { noteId })
      if (!r.ok) {
        alert('失败: ' + r.error)
        return
      }
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

  const onOpen = (sessionId: string): void => {
    if (!sessions) {
      alert('当前客户端未注入会话服务，无法跳转。')
      return
    }
    sessions.open(sessionId)
  }

  if (!state?.ok) {
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-empty' }, state ? '账本加载异常' : '正在加载交接板…'),
      rc('div', { style: { textAlign: 'center' } },
        rc('button', { className: 'hb-btn', onClick: () => void reload() }, '重试')),
    )
  }

  // 过滤管线：工作区 → 子代理可见性
  const visThreads = state.threads.filter((t) => wsSel === 'all' || t.cwd === wsSel)
  const visThreadIds = new Set(visThreads.map((t) => t.id))
  const visibleNotes = state.notes.filter(
    (n) => (showSub || n.kind !== 'subagent') && visThreadIds.has(n.threadId),
  )
  const hiddenSubCount = state.notes.filter((n) => n.kind === 'subagent').length -
    visibleNotes.filter((n) => n.kind === 'subagent').length
  const notesByThread = new Map<string, NoteV[]>()
  for (const n of visibleNotes) {
    const list = notesByThread.get(n.threadId) ?? []
    list.push(n)
    notesByThread.set(n.threadId, list)
  }
  // 孤儿兜底（threadId 对不上线程的记录不静默丢弃）
  const orphans = state.notes.filter((n) => !visThreadIds.has(n.threadId))

  const handlers: Handlers = {
    sessions, busy, expandedId,
    onToggle: (id) => setExpandedId(expandedId === id ? null : id),
    onOpen, onContinue, onGenerate,
  }

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'head', className: 'hb-head' }, [
      rc('strong', { key: 't' }, '📌 交接板'),
      rc('span', { key: 'c', className: 'cnt' },
        `${visibleNotes.length} 条 · ${visThreads.length} 线程` +
        (hiddenSubCount > 0 ? `（另有 ${hiddenSubCount} 条🤖记录已隐藏）` : '')),
      rc('span', { key: 'sp', className: 'hb-sp' }),
      (state.workspaces ?? []).length > 1 &&
        rc('select', {
          key: 'ws', className: 'hb-select', value: wsSel,
          onChange: (e: any) => setWsSel(e.target.value),
        }, [
          rc('option', { key: 'all', value: 'all' }, '全部工作区'),
          ...(state.workspaces ?? []).map((w) => rc('option', { key: w, value: w }, w.split('/').pop())),
        ]),
      rc('label', { key: 'sub', className: 'hb-check' }, [
        rc('input', {
          type: 'checkbox', checked: showSub,
          onChange: (e: any) => setShowSub(e.target.checked),
        }),
        '🤖',
      ]),
      rc('button', { key: 'r', className: 'hb-btn', disabled: busy, onClick: () => void reload() }, '↻'),
    ]),
    visibleNotes.length === 0 && orphans.length === 0
      ? rc('div', { key: 'empty', className: 'hb-empty' },
          `当前筛选下没有可见交接条。在任意会话里敲 /handoff 生成第一条。`)
      : view === 'timeline'
        ? rc(TimelineView, {
            key: 'tl',
            state: { ...state, notes: visibleNotes, threads: visThreads },
            pickedId: expandedId,
            onPick: (id: string) => { setExpandedId(id); setView('list') },
          })
        : [
            visThreads.map((t) => {
              const list = notesByThread.get(t.id) ?? []
              if (list.length === 0) return null
              return rc('div', { key: t.id, className: 'hb-thread' }, [
                rc('h3', { key: 'h' }, `${t.title}`),
                ...list.map((n) => rc(NoteCard, { key: n.id, note: n, ...handlers })),
              ])
            }),
            orphans.length > 0 &&
              rc('div', { key: 'orphans', className: 'hb-thread' }, [
                rc('h3', { key: 'h' }, '⚠️ 未归组条目（数据自检）'),
                ...orphans.map((n) => rc(NoteCard, { key: n.id, note: n, ...handlers })),
              ]),
          ],
    rc(HelpSection, { key: 'help' }),
  ])
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
  injectStyles()
  // 主区视图：与「对话」「轨迹」并列的切换页签。order=100 排在轨迹之后。
  // 契约（照抄 ui-trajectory 标准写法）：register(描述符, React组件)，组件收 props 渲染。
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
          name: 'conversation.view',
          id: 'handoff-board',
          order: 100,
          label: () => '交接板',
          icon: (size?: number) => rc('span', { style: { fontSize: (size ?? 16) + 'px' } }, '📌'),
          component: BoardApp,
        },
        function BoardShell(): any {
          return rc(BoardApp, { sessions: ctx.sessions })
        },
      ),
    ),
    'handoff-board: view',
  )
  console.info('[dsh-handoff-board] client registered（主区视图：交接板，order=100）')
}
