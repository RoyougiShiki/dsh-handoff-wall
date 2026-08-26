/**
 * @dsh-external/dsh-handoff-board — client：better-sidebar「交接板」Tab。
 * 纯 React（createElement，无 JSX）；数据来自宿主路由 /handoff-board/*。
 * 三按钮中的「打开原对话」依赖客户端会话跳转 API，v0.1 暂缺（见 spec 雾区）。
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
.hb-empty{opacity:.6;padding:20px;text-align:center}`
  document.head.appendChild(style)
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

export function BoardApp(): any {
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = async (): Promise<void> => {
    try {
      setState(await getJSON<StateV>('/state'))
    } catch { /* 宿主未就绪时静默，下次刷新 */ }
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
      rc('button', { key: 'r', className: 'hb-btn', disabled: busy, onClick: () => void reload() }, '↻ 刷新'),
    ]),
    state.notes.length === 0
      ? rc('div', { key: 'empty', className: 'hb-empty' },
          '还没有交接条。在任意会话里敲 /handoff 生成第一条。')
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
} & Record<string, unknown>

export const inject = ['betterSidebar']

export function apply(ctx: SidebarCtx): void {
  const bs = ctx.betterSidebar
  if (!bs) {
    console.warn('[dsh-handoff-board] 未安装 dsh-better-sidebar，交接板 Tab 不可用')
    return
  }
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
  console.info('[dsh-handoff-board] client registered（交接板 Tab）')
}
