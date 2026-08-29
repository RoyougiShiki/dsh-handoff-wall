/**
 * @dsh-external/dsh-handoff-board — client：主区视图（conversation.view 插槽）。
 *
 * 契约严格对齐官方 dsh-client-ui-trajectory：
 *   ctx.slots.inject('conversation.view', () => ctx.slots.register(描述符, React组件))
 *   描述符字段：{ name, id, order, label(): string, inject(sessionId): props }
 *   组件收到的 props = inject(sessionId) 的返回值（含当前会话 sessionId）。
 *
 * v0.4 版式（用户 2026-08-27 定调，移植「列表」功能结构、去掉列表模式）：
 * v0.5 版式（关联主轴：以 handoff 家族为分组、时间退为次级标签；父默认折叠；外部原对话虚节点；反向关联标注）。
 * - 真正的时间线：左时间轨 + 连续脊柱 + 节点圆点；父子/子代理缩进 + 连接线
 * - 父节点默认折叠（▶），点标题展开/收起；点卡片在右栏看六段全文+三按钮
 * - 跨工作区的原对话渲染为虚线「外部原对话」节点，血缘不断（不破坏只显当前工作区铁律）
 */
import { Component, createElement as rc, useEffect, useRef, useState } from 'react'

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
  lt5: 0
  status: string
  missing?: boolean
  parentSessionFull: string
  kind: string
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
  cwd: string
  dirName: string
  projectKey: string
  parentSessionFull: string
  title: string
}

interface StateV {
  ok: boolean
  threads: ThreadV[]
  notes: NoteV[]
  unnoted?: UnnotedV[]
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
.hb-wrap{font-size:13px;color:var(--dsw-alias-label-primary);height:100%;flex:1 1 auto;min-height:0;
  display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden}
.hb-head{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);backdrop-filter:blur(8px)}
.hb-head strong{font-size:14px;font-weight:650;display:flex;align-items:center;gap:6px}
.hb-chip{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);
  border-radius:999px;padding:1px 9px;line-height:16px;white-space:nowrap}
.hb-chip.brand{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
.hb-chip.cwd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;
  max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-sp{flex:1}
.hb-iconbtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;
  width:28px;height:28px;cursor:pointer;font-size:14px;line-height:1}
.hb-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.hb-iconbtn.spin{animation:hb-spin .9s linear infinite}
@keyframes hb-spin{to{transform:rotate(360deg)}}

/* 两栏主体：左时间线 + 右详情，各自独立滚动、互不影响 */
.hb-body{display:flex;flex:1;min-height:0;overflow:hidden}
.hb-timeline{flex:1;min-width:0;min-height:0;overflow:auto;padding:14px 18px 40px}
.hb-detail{width:392px;flex:none;min-height:0;overflow:auto;padding:14px 16px 40px;
  border-left:1px solid var(--dsw-alias-border-l2);
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 2%,transparent)}

/* 线程块 */
/* ===== v0.8 三区布局：交接关系 + 会话树 ===== */
.hb-left{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.hb-zone{display:flex;flex-direction:column;min-height:0;flex:1}
.hb-zone-head{flex:none;font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary);padding:9px 16px 3px;display:flex;align-items:center;gap:8px}
.hb-zone-head::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l2),transparent)}
.hb-canvas{flex:1 1 58%;min-height:0;overflow:auto;padding:10px 16px 14px;cursor:grab}
.hb-canvas:active{cursor:grabbing;user-select:none}
.hb-canvas-inner{display:flex;flex-direction:column;gap:6px;min-width:max-content;width:max-content;min-height:100%}
.hb-cn-row{display:flex;flex-direction:column;gap:2px}
.hb-cn-kids{margin-left:26px;padding-left:16px;border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);display:flex;flex-direction:column;gap:4px}
.hb-cn-edge{display:flex;flex-direction:column;gap:2px;position:relative}
.hb-cn-edge::before{content:'';position:absolute;left:-16px;top:14px;width:14px;height:2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 60%,transparent)}
.hb-cn-arrow{align-self:flex-start;font-size:10px;line-height:1;color:var(--dsw-alias-brand-primary);transform:translateX(-14px)}
.hb-cn-dot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.hb-card.hb-cn{border-left-width:2px;border-radius:12px;box-shadow:0 1px 2px color-mix(in srgb,black 8%,transparent)}
.hb-badge.relay{color:var(--dsw-alias-label-tertiary);border-style:dotted}
.hb-tree{flex:1 1 42%;min-height:0;min-width:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);padding:6px 8px 12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,transparent)}
.hb-tree-inner{display:flex;flex-direction:column;padding:2px 0}
.hb-kids{display:flex;flex-direction:column}
.hb-trow-group{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);padding:10px 10px 3px;letter-spacing:.3px}
.hb-trow-group + .hb-trow{margin-top:2px}
.hb-caret{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;
  width:18px;height:18px;padding:0;flex:none;display:inline-flex;align-items:center;justify-content:center}
.hb-caret::before{content:'';width:0;height:0;border-left:5px solid currentColor;
  border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;transition:transform .15s ease}
.hb-caret.open::before{transform:rotate(90deg)}
.hb-caret:hover{color:var(--dsw-alias-label-primary)}
.hb-caret.none::before{display:none}
.hb-trow{position:relative;display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:9px;cursor:pointer;font-size:12.5px;margin:1px 0;border:1px solid transparent;transition:background .1s,border-color .1s}
.hb-trow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.hb-trow.sel{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary)}
.hb-trow.ph .hb-trow-ic{opacity:.8}
.hb-trow.child::before{content:'';position:absolute;left:3px;top:0;bottom:0;width:1.5px;background:color-mix(in srgb,var(--dsw-alias-border-l3) 75%,transparent)}
.hb-trow-ic{font-size:13px;flex:none;width:20px;text-align:center;line-height:1}
.hb-trow-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.hb-trow.ph .hb-trow-nm{color:var(--dsw-alias-label-secondary)}
.hb-trow-st{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin-left:auto;font-family:ui-monospace,Menlo,monospace}
.hb-empty.sm{padding:26px 12px;font-size:12.5px}
/* 相关会话（详情面板） */
.hb-rel{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}
.hb-rel-lbl{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.hb-rel-row{display:flex;flex-direction:column;align-items:flex-start;gap:4px;font-size:12px}
.hb-rel-role{font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none;background:var(--dsw-alias-bg-layer-1);border-radius:5px;padding:1px 6px}
.hb-rel-item{border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:2px 7px;border-radius:7px;font-size:12px}
.hb-rel-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.hb-rel-item.ph{color:var(--dsw-alias-label-secondary)}
.hb-rel-none{color:var(--dsw-alias-label-tertiary);font-size:11px}
  background:var(--dsw-alias-bg-layer-1)}
.hb-th{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}
.hb-th-name{font-weight:620;font-size:13px}
.hb-th-sub{font-size:11px;color:var(--dsw-alias-label-tertiary)}

/* 竖向时间线：每个血缘族一条连续脊柱 */
.hb-tl{padding:14px 14px 14px 8px}
.hb-node{position:relative}
.hb-fam::before{content:'';position:absolute;left:6px;top:4px;bottom:4px;width:2px;
  background:linear-gradient(var(--dsw-alias-border-l3),color-mix(in srgb,var(--dsw-alias-border-l3) 22%,transparent))}
.hb-node{display:grid;grid-template-columns:52px 1fr;column-gap:10px;align-items:start}

/* 时间轨 */
.hb-time{font-family:ui-monospace,Menlo,monospace;text-align:right;padding-top:9px;line-height:1.25;
  color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.hb-time .d{font-size:10px;opacity:.85}
.hb-time .t{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}

/* 节点圆点（落在脊柱上）+ 连接短横（连到卡片） */
.hb-card{position:relative;border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-border-l3);
  border-radius:10px;padding:8px 11px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;
  transition:box-shadow .12s,border-color .12s}
.hb-card::before{content:'';position:absolute;left:-14px;top:13px;width:11px;height:11px;border-radius:50%;
  background:var(--dsw-alias-brand-primary);border:2px solid var(--dsw-alias-bg-base);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-border-l3) 60%,transparent)}
.hb-card::after{content:'';position:absolute;left:-14px;top:17px;width:14px;height:2px;
  background:var(--dsw-alias-border-l3)}
.hb-card:hover{box-shadow:0 3px 10px color-mix(in srgb,black 14%,transparent);border-color:var(--dsw-alias-border-l3)}
.hb-card.sel{outline:2px solid var(--dsw-alias-brand-primary);border-left-color:var(--dsw-alias-brand-primary)}
.hb-card.live{border-left-color:var(--dsw-alias-state-success-primary,#2ea043)}
.hb-card.live::before{background:var(--dsw-alias-state-success-primary,#2ea043)}
.hb-card.ph{background:transparent;border-style:dashed;border-left-style:solid;color:var(--dsw-alias-label-secondary)}
.hb-card.ph::before{background:var(--dsw-alias-label-tertiary);box-shadow:none}
.hb-card.sub{border-left-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 70%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent)}
.hb-card.sub::before{background:var(--dsw-alias-brand-primary);border-style:dashed}
.hb-card.ext{border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 55%,transparent);
  border-left-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 80%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 7%,transparent);color:var(--dsw-alias-label-secondary)}
.hb-card.ext::before{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 85%,transparent);box-shadow:none}

.hb-card.self{outline:2px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 65%,transparent);outline-offset:1px;
  border-left-color:var(--dsw-alias-state-warning-primary,#d29922)}
.hb-card.self::before{background:var(--dsw-alias-state-warning-primary,#d29922)}
.hb-trow.self{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 12%,transparent);
  border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 50%,transparent)}
.hb-trow.self::after{content:'';position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:2px;
  background:var(--dsw-alias-state-warning-primary,#d29922)}
.hb-card .top{display:flex;align-items:center;gap:6px}
.hb-card .metarow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px}
.hb-badge.self{color:var(--dsw-alias-state-warning-primary,#d29922);border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 10%,transparent)}
.hb-badge{font-size:10.5px;padding:0 7px;border-radius:999px;line-height:17px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.hb-badge.live{color:var(--dsw-alias-state-success-primary,#2ea043);
  border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea043) 50%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea043) 10%,transparent)}
.hb-badge.sub{border-style:dashed;color:var(--dsw-alias-brand-primary);
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.hb-badge.ext{color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 90%,transparent);
  border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d29922) 50%,transparent)}
.hb-id{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.hb-time-inline{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none}
/* 详情面板 */
.hb-dhint{padding:30px 8px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.7}
.hb-drawer{border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,transparent);padding:12px 14px}
.hb-drawer .hb-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.hb-drawer .hb-title{flex:1;font-weight:650;font-size:13.5px;min-width:120px}
.hb-bodytxt{overflow:auto;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:12.5px;line-height:1.65}
.hb-bodytxt .hb-h2{font-weight:650;font-size:12.5px;color:var(--dsw-alias-brand-primary);margin:10px 0 3px}
.hb-bodytxt .hb-h2:first-child{margin-top:0}
.hb-bodytxt .hb-li{padding-left:14px;text-indent:-10px}
.hb-files{display:flex;gap:4px;flex-wrap:wrap;margin-top:9px}
.hb-chipf{font-family:ui-monospace,Menlo,monospace;font-size:10px;border:1px dashed var(--dsw-alias-border-l2);
  border-radius:5px;padding:0 5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.hb-actions{display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap}
.hb-btn{height:30px;box-sizing:border-box;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);
  border-radius:9px;padding:0 14px;font-size:12.5px;font-weight:550;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .12s,border-color .12s}
.hb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.hb-btn:disabled{opacity:.45;cursor:default}
.hb-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);box-shadow:0 1px 4px color-mix(in srgb,var(--dsw-alias-button-primary-fill) 30%,transparent)}
.hb-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground,#fff)}
.hb-phhint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:8px;line-height:1.65}
/* 未交接/续出/源自父会话 徽章 */
.hb-badge.unset{color:var(--dsw-alias-label-tertiary);border-style:dashed;border-color:var(--dsw-alias-border-l3)}
.hb-badge.from{color:var(--dsw-alias-label-secondary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}
.hb-badge.fork{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.hb-badge.got{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}

/* 空态 / 骨架 / toast */
.hb-empty{padding:60px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}
.hb-empty .big{font-size:32px;margin-bottom:10px}
.hb-empty p{margin:4px 0 14px;font-size:13px}
.hb-sklrow{height:54px;border-radius:10px;margin:14px 0;
  background:linear-gradient(100deg,var(--dsw-alias-bg-layer-1) 40%,var(--dsw-alias-interactive-bg-hover) 50%,var(--dsw-alias-bg-layer-1) 60%);
  background-size:200% 100%;animation:hb-shimmer 1.4s infinite}
@keyframes hb-shimmer{to{background-position:-200% 0}}
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
const short8 = (sid: string): string => String(sid || '').replace(/^session-/, '').slice(0, 8)

/* 六段正文轻渲染 */
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
  return rc('div', { className: 'hb-bodytxt' }, out)
}

interface ToastItem {
  id: number
  text: string
  tone: 'ok' | 'err'
}
let toastSeq = 1

/* ── 时间线节点模型 ── */
interface TNode {
  key: string
  type: 'note' | 'ph' | 'ext'
  sessionId: string
  title: string
  createdAt: number
  status: string
  kind: string
  parentSessionId: string
  /** 未解析的原始父会话 id（父在当前工作区外或未入列表时的溯源标注） */
  rawParent: string
  threadId?: string
  note?: NoteV
  ph?: UnnotedV
}

/** 组装全局节点：笔记 + 占位 + 跨工作区「外部原对话」虚节点；父辈在当前工作区外也不断链。 */
function assembleNodes(state: StateV): TNode[] {
  const notes = state.notes ?? []
  const phs = state.unnoted ?? []
  const nodes: TNode[] = [
    ...notes.map((n): TNode => ({
      key: 'n:' + n.id,
      type: 'note',
      sessionId: n.sessionId,
      title: n.title,
      createdAt: n.createdAt,
      status: n.status,
      kind: n.kind,
      parentSessionId: n.parentSessionFull ?? '',
      rawParent: n.parentSessionFull ?? '',
      threadId: n.threadId,
      note: n,
    })),
    ...phs.map((p): TNode => ({
      key: 'p:' + p.sessionId,
      type: 'ph',
      sessionId: p.sessionId,
      title: (p as any).title || (p.kind === 'subagent' ? '子代理 ' : '会话 ') + short8(p.sessionId),
      createdAt: p.createdAt,
      status: p.status,
      kind: p.kind,
      parentSessionId: p.parentSessionFull ?? '',
      rawParent: p.parentSessionFull ?? '',
      ph: p,
    })),
  ]
  const bySid = new Map(nodes.map((n) => [n.sessionId, n]))


  // 解析父链接（闭环到当前工作区内的节点或外部虚节点）
  for (const n of nodes) {
    n.parentSessionId = n.parentSessionId && bySid.has(n.parentSessionId) ? n.parentSessionId : ''
  }
  return nodes.sort((a, b) => a.createdAt - b.createdAt)
}

/** 把无 threadId 的节点（占位/外部）沿父链归到某条线程；兜底第一条线程。 */
function assignThreads(nodes: TNode[], firstThreadId: string): void {
  const bySid = new Map(nodes.map((n) => [n.sessionId, n]))
  for (const n of nodes) {
    if (n.threadId) continue
    let p = n.parentSessionId
    let tid = firstThreadId
    while (p) {
      const pn = bySid.get(p)
      if (pn?.threadId) { tid = pn.threadId; break }
      p = pn?.parentSessionId ?? ''
    }
    n.threadId = tid
  }
}

interface Fam {
  node: TNode
  children: Fam[]
}

function buildTree(nodes: TNode[]): Fam[] {
  const bySid = new Map(nodes.map((n) => [n.sessionId, n]))
  const childrenOf = new Map<string, TNode[]>()
  const roots: TNode[] = []
  for (const n of nodes) {
    // 只有子代理是真正的「子会话」；接续出的主会话不是原会话的子代理（2026-08-29
    // 用户裁决），一律根级显示，不得折进原会话子树。接续关系只在交接关系画布表达。
    const p = n.kind === 'subagent' ? n.parentSessionId : ''
    if (p && bySid.has(p)) {
      const list = childrenOf.get(p) ?? []
      list.push(n)
      childrenOf.set(p, list)
    } else {
      roots.push(n)
    }
  }
  roots.sort((a, b) => a.createdAt - b.createdAt)
  const toFam = (n: TNode): Fam => ({
    node: n,
    children: (childrenOf.get(n.sessionId) ?? []).sort((a, b) => a.createdAt - b.createdAt).map(toFam),
  })
  return roots.map(toFam)
}

/** 只保留「交接条」节点成延续链：ph(未交接)/ext(外部) 中间节点裁掉，其下的交接条上浮接上；
 *  结果 = 交接前后关系的链森林（跨未交接会话也能串联血缘）。 */
function pruneToNotes(fams: Fam[]): Fam[] {
  const out: Fam[] = []
  const walk = (fam: Fam): Fam[] => {
    const kids: Fam[] = []
    for (const c of fam.children) kids.push(...walk(c))
    return fam.node.type === 'note' ? [{ node: fam.node, children: kids }] : kids
  }
  for (const f of fams) out.push(...walk(f))
  return out
}
/* ── 主应用 ── */
/* 渲染错误边界：任何渲染异常都浮出到界面，不再白屏 */
class HBErrorBoundary extends Component<{ children: any }, { err: string | null }> {
  state = { err: null }
  static getDerivedStateFromError(e: any) { return { err: String((e && e.message) || e) } }
  componentDidCatch(e: any) { try { console.error('[hb] render error', e) } catch (_) { /* ignore */ } }
  render() {
    return this.state.err
      ? rc('div', { style: { padding: 24, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-state-error-primary,#e5484d)' } },
        '交接板渲染错误：' + this.state.err + '\n请把本行文字发给维护者。')
      : (this as any).props.children
  }
}

function _BoardApp(props: { sessions?: SessionsApi; sessionId?: string }): any {
  injectStyles()
  const { sessions, sessionId } = props
  const [state, setState] = useState<StateV | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // 默认全折叠
  const [clanClosed, setClanClosed] = useState<Set<string>>(new Set()) // 血缘族框折叠
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const reqSeq = useRef(0)
  const canvasDrag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null) // 画布拖拽状态（hooks 必须稳定在组件顶层）
  const selInit = useRef(false) // 首次加载是否已默认选中当前会话

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
      if (seq !== reqSeq.current) return
      setState(next)
    } catch (e) {
      if (seq === reqSeq.current) toast('加载交接板失败：' + String(e).slice(0, 80), 'err')
    } finally {
      if (seq === reqSeq.current) setReloading(false)
    }
  }

  useEffect(() => { void reload() }, [sessionId])
  // #3 右栏随左滚出视口：把板高度绑到最近滚动容器（conversation.view 承载即可滚动体），左右栏各自内滚
  // 板高跟随最近滚动容器（conversation.view 承载即可滚动体）：左右栏各自内滚、
  // 任何 DSH 布局变化（侧栏/右栏/窗口）后容器一 resize 就重新校准，绝不撑出外层原生滚动条
  useEffect(() => {
    if (typeof document === 'undefined') return
    let resizeObs: ResizeObserver | null = null
    const bind = (): void => {
      const wrap = document.querySelector('.hb-wrap') as HTMLElement | null
      if (!wrap || wrap.offsetParent === null) return
      let el = wrap.parentElement
      while (el && el !== document.body) {
        const cs = getComputedStyle(el)
        if (/auto|scroll|overlay/.test(cs.overflowY)) break
        el = el.parentElement
      }
      const target = el && el !== document.body && el.clientHeight > 100 ? el : null
      if (!target) {
        const f = window.innerHeight - 90
        if (Math.abs(wrap.getBoundingClientRect().height - f) > 2) wrap.style.height = f + 'px'
        return
      }
      // 关键：容器内除板之外还有 shell 固定内容（如 composerSeat 输入栏），
      // 板高 = 容器可视高 − 其他内容高，保证 scrollHeight <= clientHeight（外层永不滚动）
      let otherH = 0
      for (const child of Array.from(target.children)) {
        if (child === wrap || child.contains(wrap)) continue
        if (child instanceof HTMLElement) otherH += child.offsetHeight
      }
      const h = Math.max(100, target.clientHeight - otherH - 2)
      if (Math.abs(wrap.getBoundingClientRect().height - h) > 2) wrap.style.height = h + 'px'
      if (!resizeObs && typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(() => bind())
        resizeObs.observe(target)
      }
    }
    bind()
    const onResize = (): void => bind()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); resizeObs?.disconnect() }
  }, [state])
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      // 板被切走（tab 隐藏/display:none）时不轮询：切回对话不再被后台刷新拖卡
      if (typeof document !== 'undefined') {
        const wrap = document.querySelector('.hb-wrap') as HTMLElement | null
        if (!wrap || wrap.offsetParent === null || wrap.getBoundingClientRect().width === 0) return
      }
      void reload()
    }, 15000)
    return () => clearInterval(timer)
  }, [sessionId])

  useEffect(() => {
    if (!state || !selectedKey) return
    const all = assembleNodes(state)
    if (!all.some((n) => n.key === selectedKey)) setSelectedKey(null)
  }, [state])
  // 第一次打开交接板：默认选中当前所在会话（若能在树/画布中找到对应节点）
  useEffect(() => {
    if (!state || selInit.current) return
    selInit.current = true
    if (!sessionId) return
    const all = assembleNodes(state)
    const self = all.find((n) => n.sessionId === sessionId)
    if (self) setSelectedKey(self.key)
  }, [state, sessionId])

  const waitAndOpen = async (newId: string): Promise<void> => {
    if (!sessions?.open) {
      toast(`新会话已创建 ${short8(newId)}…，但客户端会话服务不可用，请手动打开`, 'err')
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

  const onOpenSource = (sid: string, missing?: boolean): void => {
    if (missing) { toast('原会话已不存在（日志已被清理），无法打开；可查看全文或用「开新对话接续」延续', 'err'); return }
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
    toast('工人已开工：正在为该会话生成交接条（最长约 4 分钟）…')
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

  const onSelect = (key: string | null, all: TNode[]): void => {
    if (selectedKey === key) { setSelectedKey(null); return }
    setSelectedKey(key)
    // 注：不再自动改动折叠状态（默认全部展开，折叠只由用户点三角控制）
  }

  const toggleExpand = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleClan = (key: string): void => {
    setClanClosed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (state === null) {
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-head' }, rc('strong', null, '📌 交接板'), rc('span', { className: 'hb-sp' })),
      rc('div', { className: 'hb-body' }, [
        rc('div', { key: 'lf', className: 'hb-left' }, [
          rc('div', { key: 'cv', className: 'hb-canvas' }, [
            rc('div', { className: 'hb-sklrow' }), rc('div', { className: 'hb-sklrow' }), rc('div', { className: 'hb-sklrow' }),
          ]),
          rc('div', { key: 'tr', className: 'hb-tree' }, [rc('div', { className: 'hb-sklrow' }), rc('div', { className: 'hb-sklrow' })]),
        ]),
        rc('div', { key: 'dt', className: 'hb-detail' }),
      ]))
  }

  if (!state.ok) {
    const errNode = rc('div', { className: 'hb-empty sm' }, [
      rc('div', { key: 'b', className: 'big' }, '⚠️'),
      rc('p', { key: 'p' }, '账本加载异常'),
      rc('button', { key: 'r', className: 'hb-btn', onClick: () => void reload() }, '↻ 重试'),
    ])
    return rc('div', { className: 'hb-wrap' },
      rc('div', { className: 'hb-head' }, rc('strong', null, '📌 交接板'), rc('span', { className: 'hb-sp' }),
        rc('button', { className: 'hb-iconbtn', onClick: () => void reload() }, '⟳')),
      rc('div', { className: 'hb-body' }, [
        rc('div', { key: 'lf', className: 'hb-left' }, [
          rc('div', { key: 'cv', className: 'hb-canvas' }, errNode),
          rc('div', { key: 'tr', className: 'hb-tree' }, errNode),
        ]),
        rc('div', { key: 'dt', className: 'hb-detail' }),
      ]))
  }

  const threads = state.threads ?? []
  const noProject = !state.current
  const allNodes = assembleNodes(state)
  const firstThreadId = threads[0]?.id ?? ''
  assignThreads(allNodes, firstThreadId)
  const selected = allNodes.find((n) => n.key === selectedKey) ?? null
  const relatives = (() => {
    if (!selected) return null
    const bySid = new Map(allNodes.map((n) => [n.sessionId, n]))
    const parents: TNode[] = []
    const seen = new Set<string>()
    let p = selected.parentSessionId
    while (p && bySid.has(p) && !seen.has(p)) {
      seen.add(p)
      const pn = bySid.get(p)!
      parents.push(pn)
      p = pn.parentSessionId
    }
    const children: TNode[] = []
    for (const n of allNodes) if (n.parentSessionId === selected.sessionId) children.push(n)
    children.sort((a, b) => a.createdAt - b.createdAt)
    return { parents, children }
  })()
  // canvasDragRef 已在组件顶层声明（hooks 规则：数量与顺序每次渲染必须一致）
  const onCanvasMouseDown = (e: any): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const el = e.currentTarget as HTMLElement
    canvasDrag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
  }
  const onCanvasMouseMove = (e: any): void => {
    const d = canvasDrag.current
    if (!d) return
    const el = e.currentTarget as HTMLElement
    el.scrollLeft = d.sl - (e.clientX - d.x)
    el.scrollTop = d.st - (e.clientY - d.y)
  }
  const onCanvasMouseUp = (): void => { canvasDrag.current = null }
  const locateInCanvas = (key: string): void => {
    setSelectedKey(key)
    requestAnimationFrame(() => {
      const el = document.querySelector('.hb-canvas [data-hb-node="' + key + '"]') as HTMLElement | null
      el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    })
  }
  const onLocate = (key: string): void => {
    const t = allNodes.find((n) => n.key === key)
    if (t?.type === 'note') locateInCanvas(key)
    else setSelectedKey(key)
  }

  let canvasNode: any
  let treeNode: any
  try {
    if (noProject) {
      canvasNode = rc('div', { className: 'hb-empty sm' }, '无法定位当前会话所属的工作区项目。')
    } else if (threads.length === 0) {
      canvasNode = rc('div', { className: 'hb-empty sm' }, [
        rc('div', { key: 'b', className: 'big' }, '📋'),
        rc('p', { key: 'p' }, `本项目（${state.current!.dirName}）还没有交接条。`),
      rc('p', { key: 'p2' }, '在任意会话里输入 /handoff 生成第一条；下方会话树可浏览本工作区全部会话。'),
      ])
    } else {
      const ctx: RenderCtx = { selectedKey, expanded, selfSid: sessionId ?? '', onSelect: (k: string | null) => onSelect(k, allNodes), onToggle: toggleExpand }
      const chains = buildNoteChains(allNodes)
      canvasNode = chains.length === 0
      ? rc('div', { className: 'hb-empty sm' }, '当前工作区还没有交接条。')
      : rc('div', { key: 'cvs', className: 'hb-canvas-inner' }, chains.map((c) => renderNoteChain(c, ctx, 0)))
    }
  // 只显示「本工作区主会话 + 父在集合内的子代理 + 交接条」：
  // 主会话（kind=main）是本工作区自己的对话，一律显示（就是 dsh 会话列表里的那些）；
  // 子代理仅当其父会话也在集合内时显示——孤儿子代理、父在其他工作区的子代理一律隐藏；
  // 交接条永远显示。
  const knownSids = new Set(allNodes.map((n) => n.sessionId))
  const hangChildCount = new Map<string, number>()
  for (const n of allNodes) {
    if (n.type === 'note') continue
    if (n.rawParent && knownSids.has(n.rawParent)) {
      hangChildCount.set(n.rawParent, (hangChildCount.get(n.rawParent) ?? 0) + 1)
    }
  }
  const treeNodes = allNodes.filter((n) => {
    if (n.type === 'note') return true
    if (n.kind === 'main') return true
    if (n.rawParent && knownSids.has(n.rawParent)) return true
    return (hangChildCount.get(n.sessionId) ?? 0) > 0
  })
  const fams = buildTree(treeNodes)
  fams.sort((a, b) => b.node.createdAt - a.node.createdAt) // 根按时间倒序（最近的在上）
  const treeCtx: RenderCtx = { selectedKey, expanded, selfSid: sessionId ?? '', onSelect: (k: string | null) => onSelect(k, allNodes), onToggle: toggleExpand }
  // 按时间分组显示（今天 / 昨天 / 7 天内 / 更早），避免孤立根会话一长串平铺
  const DAY = 24 * 3600 * 1000
  const segOf = (t: number): string => {
    const d = (Date.now() - t) / DAY
    if (d < 1) return '今天'
    if (d < 2) return '昨天'
    if (d < 7) return '7 天内'
    return '更早'
  }
  const grouped = new Map<string, Fam[]>()
  for (const f of fams) {
    const s = segOf(f.node.createdAt)
    const list = grouped.get(s) ?? []
    list.push(f)
    grouped.set(s, list)
  }
  const treeRows: any[] = []
  for (const [label, list] of grouped) {
    treeRows.push(rc('div', { key: 'grp-' + label, className: 'hb-trow-group' }, `${label} · ${list.length} 个会话`))
    for (const f of list) treeRows.push(renderTreeRow(f, treeCtx, 0))
  }
  treeNode = fams.length === 0
    ? rc('div', { className: 'hb-empty sm' }, '没有可显示的会话：父会话失联或不在当前工作区的已隐藏，交接条留空。')
    : rc('div', { key: 'trs', className: 'hb-tree-inner' }, treeRows)
  } catch (e) {
    const msg = String((e as any)?.message ?? e)
    canvasNode = rc('div', { className: 'hb-empty sm' }, '渲染错误: ' + msg.slice(0, 200))
    treeNode = rc('div', { className: 'hb-empty sm' }, '渲染错误: ' + msg.slice(0, 200))
  }

  const totalNotes = (state.notes ?? []).length
  const totalPh = (state.unnoted ?? []).length

  return rc('div', { className: 'hb-wrap' }, [
    rc('div', { key: 'head', className: 'hb-head' }, [
      rc('strong', { key: 't' }, '📌 交接板'),
      state.current
        ? rc('span', { key: 'cur', className: 'hb-chip brand' }, `📁 ${state.current.dirName}`)
        : null,
      state.current && state.current.cwd
        ? rc('span', { key: 'cwd', className: 'hb-chip cwd', title: state.current.cwd }, state.current.cwd)
        : null,
      rc('span', { key: 'n', className: 'hb-chip' }, `${totalNotes} 条交接`),
      totalPh > 0 ? rc('span', { key: 'u', className: 'hb-chip' }, `${totalPh} 未交接`) : null,
      rc('span', { key: 'sp', className: 'hb-sp' }),
      rc('button', {
        key: 'r',
        title: '刷新',
        className: 'hb-iconbtn' + (reloading ? ' spin' : ''),
        onClick: () => void reload(),
      }, reloading ? '◌' : '⟳'),
    ]),
    rc('div', { key: 'body', className: 'hb-body' }, [
      rc('div', { key: 'lf', className: 'hb-left' }, [
        rc('div', { key: 'cvz', className: 'hb-zone' }, [
          rc('div', { key: 'cvh', className: 'hb-zone-head' }, '交接关系 · 谁延续了谁（拖拽空白可平移视角）'),
          rc('div', {
            key: 'cv',
            className: 'hb-canvas',
            onMouseDown: onCanvasMouseDown,
            onMouseMove: onCanvasMouseMove,
            onMouseUp: onCanvasMouseUp,
            onMouseLeave: onCanvasMouseUp,
          }, canvasNode),
        ]),
        rc('div', { key: 'trz', className: 'hb-zone' }, [
          rc('div', { key: 'trh', className: 'hb-zone-head' }, `会话树 · 子代理缩进在父下，接续会话为独立根节点（${totalNotes} 交接 / ${totalPh} 未交接）`),
          rc('div', { key: 'tr', className: 'hb-tree' }, treeNode),
        ]),
      ]),
      rc('div', { key: 'dt', className: 'hb-detail' },
        selected
          ? rc(DetailPanel, {
              key: 'dp-' + selected.key,
              node: selected,
              busy,
              relatives,
              onOpenSource,
              onContinue,
              onGenerate,
              onLocate,
            })
          : rc('div', { className: 'hb-dhint' },
            '点上方交接卡或下方会话树查看详情。未交接可补写；已有交接可在详情里「重新生成」覆盖本条。'
          )),
    ]),
    rc('div', { key: 'toasts', id: 'hb-toasts' },
      toasts.map((t) => rc('div', { key: t.id, className: 'hb-toast ' + t.tone }, t.text))),
  ])
}

/* ── 线程区块：竖向时间线（血缘树 + 连续脊柱 + 节点圆点） ── */
function subtreeMax(fam: Fam): number {
  let m = fam.node.createdAt
  for (const c of fam.children) m = Math.max(m, subtreeMax(c))
  return m
}

function countInFam(fam: Fam, pred: (n: TNode) => boolean): number {
  let c = pred(fam.node) ? 1 : 0
  for (const ch of fam.children) c += countInFam(ch, pred)
  return c
}

interface RenderCtx {
  selectedKey: string | null
  expanded: Set<string>
  /** 当前所在会话 id：节点常驻高亮（区别于点击选中） */
  selfSid: string
  onSelect(key: string | null): void
  onToggle(key: string): void
}

interface NoteChain {
  node: TNode
  kids: NoteChain[]
  relay: TNode[] // 到达父交接条之间途经的未交接会话
}

/** 交接承接链：只保留交接条，沿父链穿过未交接会话（记入 relay）连到最近的父交接条。 */
function buildNoteChains(all: TNode[]): NoteChain[] {
  const bySid = new Map(all.map((n) => [n.sessionId, n]))
  const noteBySid = new Map(all.filter((n) => n.type === 'note').map((n) => [n.sessionId, n]))
  const childrenOf = new Map<string, NoteChain[]>()
  const roots: NoteChain[] = []
  for (const n of all) {
    if (n.type !== 'note') continue
    const relay: TNode[] = []
    let p = n.parentSessionId
    const seen = new Set([n.sessionId])
    let anc: TNode | null = null
    while (p && !seen.has(p)) {
      seen.add(p)
      const ancNote = noteBySid.get(p)
      if (ancNote) { anc = ancNote; break }
      const mid = bySid.get(p)
      if (!mid) break
      if (mid.type === 'ph') relay.push(mid)
      p = mid.parentSessionId
    }
    const chain: NoteChain = { node: n, kids: [], relay }
    if (anc) {
      const list = childrenOf.get(anc.sessionId) ?? []
      list.push(chain)
      childrenOf.set(anc.sessionId, list)
    } else roots.push(chain)
  }
  const build = (c: NoteChain): NoteChain => ({
    node: c.node,
    relay: c.relay,
    kids: (childrenOf.get(c.node.sessionId) ?? []).sort((a, b) => a.node.createdAt - b.node.createdAt).map(build),
  })
  return roots.sort((a, b) => a.node.createdAt - b.node.createdAt).map(build)
}

/* 画布：交接卡 + 承接箭头（节点自动纵排/分支，实线承接，未交接只作中转记号） */
function renderNoteChain(chain: NoteChain, ctx: RenderCtx, depth: number): any {
  const n = chain.node
  const sel = ctx.selectedKey === n.key
  const card = rc('div', {
    key: 'c',
    'data-hb-node': n.key,
    className: 'hb-card hb-cn' + (sel ? ' sel' : '') + (n.sessionId === ctx.selfSid ? ' self' : '') + (n.status === '进行中' ? ' live' : ''),
    onClick: () => ctx.onSelect(sel ? null : n.key),
  }, [
    rc('div', { key: 't', className: 'top' }, [
      rc('span', { key: 'd', className: 'hb-cn-dot' }),
      rc('div', { key: 't2', className: 't' }, (n.kind === 'subagent' ? '🤖 ' : '') + n.title.slice(0, 40)),
      rc('span', { key: 'ti', className: 'hb-time-inline' }, fmt(n.createdAt)),
    ]),
    rc('div', { key: 'm', className: 'metarow' }, [
      n.status === '进行中' ? rc('span', { key: 'lv', className: 'hb-badge live' }, '进行中') : null,
      n.sessionId === ctx.selfSid && ctx.selfSid ? rc('span', { key: 'sf', className: 'hb-badge self' }, '当前') : null,
      chain.kids.length > 0 ? rc('span', { key: 'fk', className: 'hb-badge fork' }, `延续 ${chain.kids.length} 个会话`) : null,
      rc('span', { key: 'id', className: 'hb-id' }, short8(n.sessionId)),
    ]),
  ])
  return rc('div', { key: 'ch-' + n.key, className: 'hb-cn-row' }, [
    card,
    chain.kids.length > 0
      ? rc('div', { key: 'kids', className: 'hb-cn-kids' },
          chain.kids.map((k) => rc('div', { key: 'kv-' + k.node.key, className: 'hb-cn-edge' }, [
            rc('span', { key: 'ar', className: 'hb-cn-arrow' }, '▼'),
            renderNoteChain(k, ctx, depth + 1),
          ])))
      : null,
  ])
}

/* 会话树：当前工作区全部会话（交接+未交接），父在上、子会话缩进在下、默认全展开 */
function renderTreeRow(fam: Fam, ctx: RenderCtx, depth: number): any {
  const n = fam.node
  const hasKids = fam.children.length > 0
  const open = !ctx.expanded.has(n.key) // 默认全部展开；expanded 记录「用户手动折叠」的节点
  const sel = ctx.selectedKey === n.key
  const disp = n.type === 'note'
    ? (n.title || short8(n.sessionId)).slice(0, 24)
    : (n.title || (n.kind === 'subagent' ? '子代理 ' : '会话 ') + short8(n.sessionId)).slice(0, 28)
  const row = rc('div', {
    key: 'tr-' + n.key,
    className: 'hb-trow' + (sel ? ' sel' : '') + (n.sessionId === ctx.selfSid ? ' self' : '') + (n.type === 'note' ? ' note' : ' ph') + (depth > 0 ? ' child' : ''),
    style: { paddingLeft: 8 + depth * 22 + 'px' },
    onClick: () => ctx.onSelect(sel ? null : n.key),
  }, [
    hasKids
      ? rc('button', { key: 'cr', className: 'hb-caret' + (open ? ' open' : ''), onClick: (e: any) => { e.stopPropagation(); ctx.onToggle(n.key) } })
      : rc('span', { key: 'cr', className: 'hb-caret none' }),
    rc('span', { key: 'ic', className: 'hb-trow-ic' }, n.type === 'note' ? '⚡' : n.kind === 'subagent' ? '🤖' : '○'),
    rc('span', { key: 'nm', className: 'hb-trow-nm' }, disp),
    rc('span', { key: 'st', className: 'hb-trow-st' }, `${fmt(n.createdAt)} · ${n.type === 'note' ? '已交接' : '未交接'}${n.status === '进行中' ? ' · 进行中' : ''}${n.sessionId === ctx.selfSid && ctx.selfSid ? ' · 当前' : ''}`),
  ])
  // 子行必须放在独立的纵向容器（.hb-kids），不能塞进父行的横向 flex 里，否则会水平排布
  return [
    row,
    open && hasKids
      ? rc('div', { key: 'kd-' + n.key, className: 'hb-kids' },
          fam.children.flatMap((c) => renderTreeRow(c, ctx, depth + 1)))
      : null,
  ]
}

/* ── 详情面板：正式条给全文+接续+重新生成；占位/外部给说明+补写 ── */
function DetailPanel(props: {
  node: TNode
  busy: boolean
  relatives: { parents: TNode[]; children: TNode[] } | null
  onOpenSource(sid: string): void
  onContinue(note: NoteV): Promise<void>
  onGenerate(sid: string): Promise<void>
  onLocate(key: string): void
}): any {
  const n = props.node
  const live = n.status === '进行中'
  const rel = props.relatives
  const relBlock = rel !== null
    ? rc('div', { key: 'rel', className: 'hb-rel' }, [
        rc('div', { key: 'l', className: 'hb-rel-lbl' }, '相关会话（点击切换）'),
        rc('div', { key: 'u', className: 'hb-rel-row' }, [
          rc('span', { key: 'r', className: 'hb-rel-role' }, '父会话'),
          rel.parents.length === 0
            ? rc('span', { key: 'n', className: 'hb-rel-none' }, '无')
            : rel.parents.map((p) => rc('button', {
                key: p.key,
                className: 'hb-rel-item' + (p.type === 'note' ? '' : ' ph'),
                title: '点击' + (p.type === 'note' ? '跳转到上方对应交接' : '查看这个会话'),
                onClick: () => props.onLocate(p.key),
              }, `${p.type === 'note' ? '⚡' : '○'} ${(p.title || short8(p.sessionId)).slice(0, 16)}`)),
        ]),
        rc('div', { key: 'd', className: 'hb-rel-row' }, [
          rc('span', { key: 'r', className: 'hb-rel-role' }, '子会话'),
          rel.children.length === 0
            ? rc('span', { key: 'n', className: 'hb-rel-none' }, '无')
            : rel.children.map((c) => rc('button', {
                key: c.key,
                className: 'hb-rel-item' + (c.type === 'note' ? '' : ' ph'),
                title: '点击' + (c.type === 'note' ? '跳转到上方对应交接' : '查看这个会话'),
                onClick: () => props.onLocate(c.key),
              }, `${c.type === 'note' ? '⚡' : '○'} ${(c.title || short8(c.sessionId)).slice(0, 16)}`)),
        ]),
      ])
    : null
  return rc('div', { className: 'hb-drawer' }, [
    relBlock,
    rc('div', { key: 'meta', className: 'hb-meta' }, [
      rc('span', { key: 'st', className: 'hb-badge' + (live ? ' live' : '') }, n.status === '外部' ? '其他工作区' : n.status),
      n.kind === 'subagent' ? rc('span', { key: 'kb', className: 'hb-badge sub' }, '🤖 子代理') : null,
      n.type === 'ext' ? rc('span', { key: 'ex', className: 'hb-badge ext' }, '↪ 外部原对话') : null,
      n.type === 'note' && n.note?.missing ? rc('span', { key: 'ms', className: 'hb-badge unset' }, '原会话已清理') : null,
      rc('span', { key: 'ti', className: 'hb-title' }, n.title),
      rc('span', { key: 'tm', className: 'hb-id' }, fmt(n.createdAt)),
      rc('span', { key: 'id', className: 'hb-id' }, short8(n.sessionId)),
    ]),
    n.type === 'note' && n.note ? [
      rc(BodyView, { key: 'body', body: n.note.body }),
      n.note.files.length > 0 && rc('div', { key: 'files', className: 'hb-files' }, [
        ...n.note.files.slice(0, 16).map((f) => rc('span', { key: f, className: 'hb-chipf' }, f)),
        n.note.files.length > 16 ? rc('span', { key: 'more', className: 'hb-chipf' }, `+${n.note.files.length - 16}`) : null,
      ]),
      rc('div', { key: 'act', className: 'hb-actions' }, [
        rc('button', {
          className: 'hb-btn',
          disabled: props.busy || n.note?.missing === true,
          title: n.note?.missing ? '原会话已不存在' : undefined,
          onClick: () => props.onOpenSource(n.sessionId, n.note?.missing),
        }, n.note?.missing ? '原会话已不存在' : '↗ 打开原对话'),
        rc('button', {
          className: 'hb-btn',
          disabled: props.busy || n.note?.missing === true,
          title: n.note?.missing ? '原会话已不存在，无法取材' : '用该会话当前内容覆盖本条（工人约数分钟）',
          onClick: () => void props.onGenerate(n.sessionId),
        }, '↻ 重新生成'),
        rc('button', {
          className: 'hb-btn primary',
          disabled: props.busy,
          onClick: () => void props.onContinue(n.note!),
        }, '✦ 开新对话接续'),
      ]),
    ] : [
      rc('div', { key: 'phh', className: 'hb-phhint' },
        n.type === 'ext'
          ? '这个会话的源头在另一个工作区（这里只显示当前工作区）。要追溯需切到对应工作区查看，或直接在来源会话补写交接条。'
          : `这个${n.kind === 'subagent' ? '子代理' : ''}会话还没有交接条。可以由独立工人现场取材生成一份六段交接（不依赖该会话存活）。`),
      rc('div', { key: 'act', className: 'hb-actions' }, [
        rc('button', {
          className: 'hb-btn',
          disabled: props.busy,
          onClick: () => props.onOpenSource(n.sessionId),
        }, '↗ 打开原对话'),
        rc('button', {
          className: 'hb-btn primary',
          disabled: props.busy,
          onClick: () => void props.onGenerate(n.sessionId),
        }, '⚡ 补写交接条'),
      ]),
    ],
  ])
}

/* ── 插槽注册（注入器预检要求 register({...} 紧连同形；契约对齐 ui-trajectory）── */

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
  // 诊断：任何运行时错误上抛到 document.title，便于从宿主侧读取定位
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as any).__hbDiag) {
    ;(window as any).__hbDiag = true
    const mark = (tag: string, e: any): void => {
      try { document.title = tag + String((e && (e.message || e.reason)) || e).slice(0, 160) } catch (_) { /* ignore */ }
    }
    window.addEventListener('error', (e) => mark('HB_ERR:', e), true)
    window.addEventListener('unhandledrejection', (e) => mark('HB_REJ:', e))
  }
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register({
        name: 'conversation.view',
        id: 'handoff-board',
        order: 100,
        label: () => '交接板',
        inject: (sessionId: string) => ({ sessionId }),
      },
        function BoardShell(props: Record<string, unknown>): any {
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          return rc(HBErrorBoundary, {}, rc(_BoardApp, { sessions: ctx.sessions, sessionId }))
        },
      ),
    ),
    'handoff-board: view',
  )
  console.info('[dsh-handoff-board] client v0.8（交接关系/会话树/详情三区）registered order=100')
}
