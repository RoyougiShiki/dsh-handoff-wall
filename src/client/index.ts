/**
 * @dsh-external/dsh-handoff-board — client：主区视图（conversation.view 插槽）。
 *
 * 契约严格对齐官方 dsh-client-ui-trajectory：
 *   ctx.slots.inject('conversation.view', () => ctx.slots.register(描述符, React组件))
 *   描述符字段：{ name, id, order, locale?, label(): string, inject(sessionId): props }
 *   组件收到的 props = inject(sessionId) 的返回值（含当前会话 sessionId）。
 *
 * 本版重写要点（对应用户反馈的全部问题）：
 * - inject 返回 {sessionId}，状态面按当前会话自动匹配项目（无人工下拉）
 * - 条目卡片真实交互：就地展开六段全文 + 「打开原对话」「开新对话接续」两按钮
 * - 占位卡区块常驻显示未建条会话（主对话/🤖子代理分组），一键 ⚡ 生成交接条
 * - 📋 列表 / 🧭 时间线双视图切换；列表卡可从时间线气泡跳转定位
 * - 全量数据随会话切换与可见性轮询自动刷新（fetch no-store，宿主也回 no-cache 头）
 * - 视觉走官方 --dsw-alias-* 语义令牌，浅色/深色主题自动跟随（talkmap 同款做法）
 */
import { createElement as rc, useEffect, useRef, useState } from 'react'

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
  parentSession: string
  kind: string
}
interface ThreadV {
  id: string
  title: string
  projectKey: string
  createdAt: number
  cwd?: string
  current?: boolean
}
interface UnnotedV {
  sessionId: string
  createdAt: number
  status: string
  kind: string
  cwd: string
  dirName: string
}
interface StateV {
  ok: boolean
  threads: ThreadV[]
  notes: NoteV[]
  unnoted?: UnnotedV[]
  workspaces?: string[]
  current?: { cwd: string; dirName: string; projectKey: string } | null
}

interface SessionsApi {
  binding(sessionId: string): unknown
  open(sessionId: string): void
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { cache: 'no-store' })
  return (await r.json()) as T
}

async function postJSON(path: string, body: unknown): Promise<any> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

/* ── 主题令牌样式：全部取自 shell 的 --dsw-alias-*（ui-theme），明暗自动跟随 ── */
const STYLE_CSS = `
.hb-wrap{font-size:13px;color:var(--dsw-alias-label-primary);height:100%;overflow:auto;box-sizing:border-box;padding:0 0 40px}
.hb-inner{max-width:960px;margin:0 auto;padding:14px 18px}
.hb-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 18px;margin:0 -18px 2px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 82%,transparent);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--dsw-alias-border-l2)}
.hb-head strong{font-size:14px;font-weight:650;display:flex;align-items:center;gap:6px}
.hb-chip{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);
  border-radius:999px;padding:1px 9px;line-height:16px;white-space:nowrap}
.hb-chip.brand{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
.hb-sp{flex:1}
.hb-seg{display:flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}
.hb-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 12px;
  cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px}
.hb-seg button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.hb-seg button.on{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary);font-weight:600}
.hb-iconbtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;
  width:28px;height:28px;cursor:pointer;font-size:14px;line-height:1}
.hb-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.hb-iconbtn.spin{animation:hb-spin 0.9s linear infinite}
@keyframes hb-spin{to{transform:rotate(360deg)}}

/* 线程分区 */
.hb-thread{margin-top:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1)}
.hb-thread>.hb-th{display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;user-select:none}
.hb-thread>.hb-th:hover{background:var(--dsw-alias-interactive-bg-hover)}
.hb-th-name{font-weight:620;font-size:13px}
.hb-th-sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}

/* 条目卡片 */
.hb-note{margin:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-border-l3);
  border-radius:9px;padding:8px 12px;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s}
.hb-note:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);
  box-shadow:0 1px 4px color-mix(in srgb,black 8%,transparent)}
.hb-note.open{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent)}
.hb-note.live{border-left-color:var(--dsw-alias-state-success-primary,#2ea043)}
.hb-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.hb-badge{font-size:10.5px;padding:0 7px;border-radius:999px;line-height:17px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.hb-badge.live{color:var(--dsw-alias-state-success-primary,#2ea043);
  border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea043) 50%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea043) 10%,transparent)}
.hb-badge.sub{color:var(--dsw-alias-label-secondary);border-style:dashed}
.hb-title{flex:1;font-weight:600;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-id,.hb-time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.hb-body{max-height:46vh;overflow:auto;border-radius:8px;padding:10px 12px;margin-top:8px;font-size:12.5px;line-height:1.65;
  white-space:normal;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);cursor:auto}
.hb-body .hb-h2{font-weight:650;font-size:12.5px;color:var(--dsw-alias-brand-primary);margin:10px 0 3px}
.hb-body .hb-h2:first-child{margin-top:0}
.hb-body .hb-li{padding-left:14px;text-indent:-10px}
.hb-files{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px;cursor:auto}
.hb-chipf{font-family:ui-monospace,Menlo,monospace;font-size:10px;border:1px dashed var(--dsw-alias-border-l2);
  border-radius:5px;padding:0 5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.hb-actions{display:flex;gap:8px;margin-top:9px;cursor:auto;align-items:center}
.hb-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  border-radius:7px;padding:3px 11px;font-size:12px;display:inline-flex;align-items:center;gap:5px}
.hb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.hb-btn:disabled{opacity:.45;cursor:default}
.hb-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.hb-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground,#fff)}
.hb-warn{font-size:11px;color:var(--dsw-alias-state-error-primary,#c00);margin-top:6px;cursor:auto}

/* 子代理折叠组 */
.hb-subgroup{margin:2px 12px 10px 24px;border-left:2px dashed var(--dsw-alias-border-l2);padding-left:8px}
.hb-subgroup summary{cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary);list-style:none;
  padding:4px 2px;border-radius:6px;user-select:none}
.hb-subgroup summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.hb-subgroup summary::before{content:'▸ ';}
.hb-subgroup[open] summary::before{content:'▾ ';}

/* 占位卡（未建条会话） */
.hb-phzone{margin-top:22px}
.hb-phhead{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:620;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.hb-phhead .rule{flex:1;height:1px;background:var(--dsw-alias-border-l2)}
.hb-ph{display:flex;align-items:center;gap:8px;border:1px dashed var(--dsw-alias-border-l3);border-radius:9px;
  padding:7px 12px;margin:7px 0;color:var(--dsw-alias-label-secondary);transition:border-color .15s,background .15s}
.hb-ph:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.hb-ph .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* 时间线 */
.hb-tl-rowlabel{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:14px 0 2px;font-weight:600;
  display:flex;gap:8px;align-items:center}
.hb-tl-lane{position:relative;height:70px;margin:0 96px 0;border-left:1px dashed var(--dsw-alias-border-l2)}
.hb-tl-lane::before{content:'';position:absolute;left:0;right:0;top:35px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent),var(--dsw-alias-border-l2))}
.hb-tl-card{position:absolute;top:10px;transform:translateX(-50%);width:148px;border:1px solid var(--dsw-alias-border-l2);
  border-radius:8px;padding:4px 8px;font-size:11px;cursor:pointer;line-height:1.4;z-index:2;
  background:var(--dsw-alias-bg-layer-2);transition:transform .12s,box-shadow .12s,border-color .12s}
.hb-tl-card:hover{transform:translateX(-50%) translateY(-2px);border-color:var(--dsw-alias-border-l3);
  box-shadow:0 3px 8px color-mix(in srgb,black 14%,transparent);z-index:3}
.hb-tl-card.live{border-left:3px solid var(--dsw-alias-state-success-primary,#2ea043)}
.hb-tl-card.picked{outline:2px solid var(--dsw-alias-brand-primary);z-index:4}
.hb-tl-card.ph{background:transparent;border-style:dashed;color:var(--dsw-alias-label-tertiary);width:118px}
.hb-tl-card .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-tl-card .d{opacity:.65;font-size:10px}
.hb-tl-emptylane{height:34px}
.hb-tl-emptylane .hb-tl-card{top:1px;font-size:10px;padding:3px 7px}

/* 空态 / 骨架 / 提示 */
.hb-empty{padding:64px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.hb-empty .big{font-size:34px;margin-bottom:10px}
.hb-empty p{margin:4px 0 14px;font-size:13px}
.hb-skl{max-width:960px;margin:18px auto;padding:0 18px}
.hb-sklrow{height:54px;border-radius:10px;margin:10px 0;
  background:linear-gradient(100deg,var(--dsw-alias-bg-layer-1) 40%,var(--dsw-alias-interactive-bg-hover) 50%,var(--dsw-alias-bg-layer-1) 60%);
  background-size:200% 100%;animation:hb-shimmer 1.4s infinite}
@keyframes hb-shimmer{to{background-position:-200% 0}}
.hb-tip{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:10px 2px 0}

/* toast */
#hb-toasts{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px}
.hb-toast{max-width:380px;padding:9px 14px;border-radius:10px;font-size:12.5px;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);
  box-shadow:0 6px 18px color-mix(in srgb,black 18%,transparent);animation:hb-in .18s ease-out}
@keyframes hb-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hb-toast.ok{border-left:3px solid var(--dsw-alias-state-success-primary,#2ea043)}
.hb-toast.err{border-left:3px solid var(--dsw-alias-state-error-primary,#e5484d)}
`

function injectStyles(): void {
  if (document.getElementById('hb-styles')) return
  const style = document.createElement('style')
  style.id = 'hb-styles'
  style.textContent = STYLE_CSS
  document.head.appendChild(style)
}

function fmt(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 六段正文轻渲染：## 标题高亮、- 列表缩进、空行分段 */
function BodyView(props: { body: string }): any {
  const lines = String(props.body || '').split('\n')
  const out: any[] = []
  let key = 0
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^#{1,3}\s/.test(line)) {
      out.push(rc('div', { key: key++, className: 'hb-h2' }, line.replace(/^#{1,3}\s*/, '')))
    } else if (/^[-*]\s/.test(line)) {
      out.push(rc('div', { key: key++, className: 'hb-li' }, '· ' + line.replace(/^[-*]\s*/, '')))
    } else if (!line.trim()) {
      out.push(rc('div', { key: key++, style: { height: '0.55em' } }))
    } else {
      out.push(rc('div', { key: key++ }, line))
    }
  }
  return rc('div', { className: 'hb-body', onClick: (e: Event) => e.stopPropagation() }, out)
}

interface ToastItem {
  id: number
  text: string
  tone: 'ok' | 'err'
}
let toastSeq = 1

/* ── 主应用 ── */
function _BoardApp(props: { sessions?: SessionsApi; sessionId?: string }): any {
  injectStyles()
  const { sessions, sessionId } = props
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const pendingScroll = useRef<{ elId: string; nonce: number } | null>(null)
  const reqSeq = useRef(0)
  const toast = (text: string, tone: 'ok' | 'err' = 'ok'): void => {
    const id = toastSeq++
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 6000 : 3600)
  }

  const reload = async (): Promise<void> => {
    const seq = ++reqSeq.current
    setReloading(true)
    try {
      const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}&t=${Date.now()}` : `?t=${Date.now()}`
      const next = await getJSON<StateV>(`/state${q}`)
      // 竞态防护：会话快速切换时，旧的慢响应不得覆盖新数据
      if (seq !== reqSeq.current) return
      setState(next)
    } catch (e) {
      if (seq === reqSeq.current) toast('加载交接板失败：' + String(e).slice(0, 80), 'err')
    } finally {
      if (seq === reqSeq.current) setReloading(false)
    }
  }

  // 数据流：会话变化即刷新 + 可见性轮询（15s）兜底外部写入（工具/命令落库）
  useEffect(() => { void reload() }, [sessionId])
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void reload()
    }, 15000)
    return () => clearInterval(timer)
  }, [sessionId])

  const waitAndOpen = async (newId: string): Promise<void> => {
    if (!sessions?.open) {
      toast(`新会话已创建 ${newId.slice(0, 13)}…，但客户端会话服务不可用，请手动打开`, 'err')
      return
    }
    for (let i = 0; i < 14; i++) {
      try {
        if (sessions.binding(newId) !== undefined) break
      } catch { /* 等待绑定 */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    sessions.open(newId)
  }

  const onOpenSource = (sid: string): void => {
    if (!sessions?.open) { toast('客户端会话服务不可用，无法跳转', 'err'); return }
    sessions.open(sid)
    toast('已跳转到原对话')
  }

  const onContinue = async (note: NoteV): Promise<void> => {
    if (busy) return
    setBusy(true)
    toast('正在创建接续会话并注入交接全文…')
    try {
      const r = await postJSON('/continue', { noteId: note.id })
      if (!r.ok) { toast('接续失败：' + String(r.error).slice(0, 160), 'err'); return }
      await reload()
      await waitAndOpen(r.newSessionId)
      toast(r.warning ? ('⚠️ ' + r.warning) : `✅ 已接续「${note.title.slice(0, 18)}」，新会话已打开`, r.warning ? 'err' : 'ok')
    } catch (e) {
      toast('接续异常：' + String(e).slice(0, 120), 'err')
    } finally {
      setBusy(false)
    }
  }

  const onGenerate = async (sid: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    toast('工人已开工：正在为该会话生成交接条（最长约 2 分钟）…')
    try {
      const r = await postJSON('/generate', { sessionId: sid })
      if (!r.ok) { toast('生成失败：' + String(r.error).slice(0, 160), 'err'); return }
      await reload()
      toast(`✅ 已生成并入库：「${String(r.title).slice(0, 20)}」`)
    } catch (e) {
      toast('生成异常：' + String(e).slice(0, 120), 'err')
    } finally {
      setBusy(false)
    }
  }

  // 时间线气泡 → 列表定位展开
  useEffect(() => {
    const p = pendingScroll.current
    if (!p) return
    const el = document.getElementById(p.elId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      pendingScroll.current = null
    }
  })

  if (state === null) {
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-skl' },
        Array.from({ length: 4 }, (_, i) => rc('div', { key: i, className: 'hb-sklrow' }))),
    )
  }
  if (!state.ok) {
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-empty' },
        rc('div', { className: 'big' }, '⚠️'),
        rc('p', null, '账本加载异常'),
        rc('button', { className: 'hb-btn', onClick: () => void reload() }, '↻ 重试')),
    )
  }

  const notes = state.notes ?? []
  const unnoted = state.unnoted ?? []
  const mainNotes = notes.filter((n) => n.kind !== 'subagent')
  const subNotes = notes.filter((n) => n.kind === 'subagent')

  const headBar = rc('div', { key: 'head', className: 'hb-head' }, [
    rc('strong', { key: 't' }, '📌 交接板'),
    rc('span', { key: 'c', className: 'hb-chip' }, `${notes.length} 条 · ${state.threads.length} 线程`),
    unnoted.length > 0 ? rc('span', { key: 'u', className: 'hb-chip' }, `${unnoted.length} 个待补`) : null,
    state.current ? rc('span', { key: 'cur', className: 'hb-chip brand' }, `本项目 · ${state.current.dirName}`) : null,
    rc('span', { key: 'sp', className: 'hb-sp' }),
    rc('div', { key: 'seg', className: 'hb-seg' }, [
      rc('button', { key: 'l', className: view === 'list' ? 'on' : '', onClick: () => setView('list') }, '📋 列表'),
      rc('button', { key: 'tl', className: view === 'timeline' ? 'on' : '', onClick: () => setView('timeline') }, '🧭 时间线'),
    ]),
    rc('button', {
      key: 'r',
      title: '刷新',
      className: 'hb-iconbtn' + (reloading ? ' spin' : ''),
      onClick: () => void reload(),
    }, reloading ? '◌' : '⟳'),
  ])

  const renderThread = (t: ThreadV): any => {
    const mains = mainNotes.filter((n) => n.threadId === t.id)
    const subs = subNotes.filter((n) => n.threadId === t.id)
    if (mains.length === 0 && subs.length === 0) return null
    return rc('div', { key: t.id, className: 'hb-thread' }, [
      rc('div', { key: 'th', className: 'hb-th' },
        rc('span', { className: 'hb-th-name' }, `📁 ${t.title}`),
        t.current ? rc('span', { className: 'hb-chip brand' }, '本项目') : null,
        rc('span', { className: 'hb-th-sub' }, `${mains.length + subs.length} 条`),
      ),
      ...mains.map((n) => rc(NoteCard, {
        key: n.id,
        note: n,
        open: expandedId === n.id,
        busy,
        onToggle: () => setExpandedId(expandedId === n.id ? null : n.id),
        onOpenSource,
        onContinue,
      })),
      subs.length > 0 &&
        rc('details', { key: 'subs-' + t.id, className: 'hb-subgroup' }, [
          rc('summary', { key: 's' }, `🤖 子代理记录（${subs.length}）`),
          ...subs.map((n) => rc(NoteCard, {
            key: n.id,
            note: n,
            open: expandedId === n.id,
            busy,
            onToggle: () => setExpandedId(expandedId === n.id ? null : n.id),
            onOpenSource,
            onContinue,
          })),
        ]),
    ])
  }

  const renderPhCard = (p: UnnotedV): any =>
    rc('div', {
      key: p.sessionId,
      id: 'hb-ph-' + p.sessionId,
      className: 'hb-ph',
      title: `${p.dirName || p.cwd || '未知工作区'}\n${fmt(p.createdAt)} · ${p.status}`,
    }, [
      p.kind === 'subagent' ? rc('span', { key: 'k', className: 'hb-badge sub' }, '🤖 子代理') : null,
      rc('span', { key: 's', className: 'hb-badge' + (p.status === '进行中' ? ' live' : '') }, p.status),
      rc('span', { key: 't', className: 't' }, p.dirName || p.cwd || p.sessionId.slice(0, 13)),
      rc('span', { key: 'tm', className: 'hb-time' }, fmt(p.createdAt)),
      rc('button', {
        key: 'g',
        className: 'hb-btn primary',
        disabled: busy,
        onClick: (e: Event) => { e.stopPropagation(); void onGenerate(p.sessionId) },
      }, '⚡ 补写'),
    ])

  let bodyNode: any
  if (notes.length === 0 && unnoted.length === 0) {
    bodyNode = rc('div', { key: 'empty', className: 'hb-empty' }, [
      rc('div', { key: 'b', className: 'big' }, '📋'),
      rc('p', { key: 'p1' }, '还没有任何交接条。'),
      rc('p', { key: 'p2' }, '在任意会话里输入 /handoff 即可生成第一条；或对左侧历史会话点 ⚡ 补写。'),
      rc('button', { key: 'r', className: 'hb-btn', onClick: () => void reload() }, '↻ 刷新'),
    ])
  } else if (view === 'timeline') {
    bodyNode = rc(TimelineView, {
      key: 'tl',
      state,
      pickedId: expandedId,
      onPickNote: (n: NoteV) => { setExpandedId(n.id); setView('list'); pendingScroll.current = { elId: 'hb-note-' + n.id, nonce: Date.now() } },
      onPickPh: (sid: string) => { setView('list'); pendingScroll.current = { elId: 'hb-ph-' + sid, nonce: Date.now() } },
    })
  } else {
    bodyNode = [
      ...state.threads.map(renderThread),
      unnoted.length > 0 &&
        rc('div', { key: 'phzone', className: 'hb-phzone' }, [
          rc('div', { key: 'h', className: 'hb-phhead' }, [
            `待补交接条 · ${unnoted.length}`,
            rc('span', { key: 'tip', className: 'hb-th-sub' }, '这些会话还没有交接条，⚡ 一键由独立工人生成'),
            rc('span', { key: 'r', className: 'rule' }),
          ]),
          ...unnoted.map(renderPhCard),
        ]),
    ]
  }

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'inner', className: 'hb-inner' }, [
      headBar,
      bodyNode,
      rc('div', { key: 'tip', className: 'hb-tip' },
        '换班时在会话里敲 /handoff 写交接条；AI 可用 board / read_handoff / write_handoff / who_else 四件套查写同一账本。'),
    ]),
    rc('div', { key: 'toasts', id: 'hb-toasts' },
      toasts.map((t) => rc('div', { key: t.id, className: 'hb-toast ' + t.tone }, t.text))),
  ])
}

/* ── 条目卡片：完整交互（展开全文 + 三按钮中的前两个；补写在占位卡上）── */
function NoteCard(props: {
  note: NoteV
  open: boolean
  busy: boolean
  onToggle(): void
  onOpenSource(sid: string): void
  onContinue(n: NoteV): Promise<void>
}): any {
  const n = props.note
  const live = n.status === '进行中'
  return rc('div', {
    id: 'hb-note-' + n.id,
    className: 'hb-note' + (live ? ' live' : '') + (props.open ? ' open' : ''),
    onClick: props.onToggle,
  }, [
    rc('div', { key: 'meta', className: 'hb-meta' }, [
      rc('span', { key: 'st', className: 'hb-badge' + (live ? ' live' : '') }, n.status),
      n.kind === 'subagent' ? rc('span', { key: 'kb', className: 'hb-badge sub' }, '↳ 🤖 子代理') : null,
      n.parentSession ? rc('span', { key: 'pb', className: 'hb-badge sub' }, `父 ${n.parentSession}`) : null,
      rc('span', { key: 'ti', className: 'hb-title' }, n.title),
      rc('span', { key: 'tm', className: 'hb-time' }, fmt(n.createdAt)),
      rc('span', { key: 'id', className: 'hb-id' }, n.id.slice(0, 8)),
    ]),
    props.open && rc('div', { key: 'x', onClick: (e: Event) => e.stopPropagation() }, [
      rc(BodyView, { key: 'body', body: n.body }),
      n.files.length > 0 && rc('div', { key: 'files', className: 'hb-files' }, [
        ...n.files.slice(0, 14).map((f) => rc('span', { key: f, className: 'hb-chipf' }, f)),
        n.files.length > 14 ? rc('span', { key: 'more', className: 'hb-chipf' }, `+${n.files.length - 14}`) : null,
      ]),
      rc('div', { key: 'act', className: 'hb-actions' }, [
        rc('button', {
          className: 'hb-btn',
          disabled: props.busy,
          onClick: () => props.onOpenSource(n.sessionId),
        }, '↗ 打开原对话'),
        rc('button', {
          className: 'hb-btn primary',
          disabled: props.busy,
          onClick: () => void props.onContinue(n),
        }, '✦ 开新对话接续'),
      ]),
    ]),
  ])
}

/* ── 时间线泳道：线程一行 + 待补会话一行；气泡点击回跳列表 ── */
function TimelineView(props: {
  state: StateV
  pickedId: string | null
  onPickNote(n: NoteV): void
  onPickPh(sid: string): void
}): any {
  const notes = props.state.notes ?? []
  const phs = props.state.unnoted ?? []
  const times = [...notes.map((n) => n.createdAt), ...(timesOf(phs))]
  function timesOf(list: UnnotedV[]): number[] {
    return list.filter((_, i) => i < 200).map((p) => p.createdAt)
  }
  const min = Math.min(...(times.length ? times : [Date.now()]))
  const max = Math.max(...(times.length ? times : [Date.now()]))
  const span = Math.max(max - min, 60_000)
  const pos = (t: number): number => 6 + ((t - min) / span) * 86
  const hasAny = notes.length > 0 || phs.length > 0

  return rc('div', null, [
    !hasAny && rc('div', { className: 'hb-empty' }, '暂无可排布的时间点。'),
    ...props.state.threads.map((t) => {
      const list = notes.filter((n) => n.threadId === t.id)
      if (list.length === 0) return null
      return rc('div', { key: t.id }, [
        rc('div', { className: 'hb-tl-rowlabel' },
          `📁 ${t.title}`,
          t.current ? rc('span', { className: 'hb-chip brand' }, '本项目') : null,
          rc('span', { className: 'hb-th-sub' }, `${list.length} 条`),
        ),
        rc('div', { className: 'hb-tl-lane' },
          list.map((n) =>
            rc('div', {
              key: n.id,
              className:
                'hb-tl-card' +
                (n.status === '进行中' ? ' live' : '') +
                (props.pickedId === n.id ? ' picked' : ''),
              style: { left: pos(n.createdAt) + '%' },
              title: `${n.title}\n${fmt(n.createdAt)} · ${n.status} · 点击查看全文`,
              onClick: () => props.onPickNote(n),
            }, [
              rc('div', { key: 't', className: 't' }, n.title.slice(0, 24)),
              rc('div', { key: 'd', className: 'd' }, `${fmt(n.createdAt)}${n.kind === 'subagent' ? ' · 🤖' : ''}`),
            ]),
          ),
        ),
      ])
    }),
    phs.length > 0 && rc('div', { key: 'phrow' }, [
      rc('div', { className: 'hb-tl-rowlabel' },
        '⚡ 待补交接条',
        rc('span', { className: 'hb-th-sub' }, `${phs.length} 个会话还没有条目`)),
      rc('div', { className: 'hb-tl-lane hb-tl-emptylane' },
        phs.slice(0, 40).map((p) =>
          rc('div', {
            key: p.sessionId,
            className: 'hb-tl-card ph',
            style: { left: pos(p.createdAt) + '%' },
            title: `${p.dirName || p.cwd || p.sessionId}\n${fmt(p.createdAt)} · 点击去补写`,
            onClick: () => props.onPickPh(p.sessionId),
          }, rc('div', { className: 't' }, `${p.kind === 'subagent' ? '🤖 ' : ''}${p.dirName || p.sessionId.slice(0, 10)}`)),
        )),
    ]),
    hasAny && rc('div', { className: 'hb-tip', style: { margin: '4px 96px' } }, [
      `时间轴 ${fmt(min)} → ${fmt(max)} · 点击气泡回到列表查看全文`,
    ]),
  ])
}

/* ── 插槽注册（契约照抄 ui-trajectory：描述符 + inject(sessionId) + 双参数 register）── */

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
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      // 注入器预检是静态正则：register({...} 必须紧连同形（历史教训 973fa78/da198be）
      ctx.slots.register({
          name: 'conversation.view',
          id: 'handoff-board',
          order: 100,
          label: () => '交接板',
          inject: (sessionId: string) => ({ sessionId }),
        },
        function BoardShell(props: Record<string, unknown>): any {
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          return rc(_BoardApp, { sessions: ctx.sessions, sessionId })
        },
      ),
    ),
    'handoff-board: view',
  )
  console.info('[dsh-handoff-board] client registered（主区视图：交接板 order=100，inject 契约对齐 trajectory）')
}
