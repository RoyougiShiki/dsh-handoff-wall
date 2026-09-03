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

async function postJSON(path: string, body: unknown, timeoutMs = 700_000): Promise<any> {
  // 服务端最坏要跑三轮工人（150+210+240s），这里给足但必须给上限：
  // 旧实现没有超时，请求挂住时 fetch 永不 settle，界面就一直停在「工人已开工」。
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : undefined
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(ac ? { signal: ac.signal } : {}),
    })
    return await r.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* ── 主题令牌样式：全部取自 shell 的 --dsw-alias-*（ui-theme），明暗自动跟随 ── */
const STYLE_CSS = `
/* flex-basis 必须是 0：原来是 auto（= 内容高度），右侧详情一变长就能把 wrap 顶大，
   外层滚动容器被撑出公用滚动条，会话树被挤到可视区外（用户反馈的「滚动条随右侧
   详情改变、会话树又要滚到底部」）。归零后 wrap 高度只由容器分配，与内容无关。 */
.hb-wrap{font-size:13px;color:var(--dsw-alias-label-primary);height:100%;flex:1 1 0;min-height:0;
  display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden}
/* wrap 高度由 JS 动态测量设置（inline style 覆盖 height:100%）：
 * 高度 = 最近滚动容器可视高 − wrap 顶部偏移，适配任意窗口/布局。 */
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
.hb-detail{width:392px;flex:none;min-height:0;overflow:auto;padding:14px 16px 40px;height:100%;box-sizing:border-box;
  border-left:1px solid var(--dsw-alias-border-l2);
  background:color-mix(in srgb,var(--dsw-alias-label-primary) 2%,transparent)}

/* 线程块 */
/* ===== v0.8 三区布局：交接关系 + 会话树 ===== */
.hb-left{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;height:100%;overflow:hidden}
.hb-zone{display:flex;flex-direction:column;min-height:0;flex:1}
/* 会话树折叠：吸底横条，不占画布高度 */
.hb-zone-collapsed{flex:none;margin-top:auto;min-height:0}
.hb-zone-collapsed .hb-zone-head{padding:6px 16px 6px}
.hb-zone-head{flex:none;font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary);padding:9px 16px 3px;display:flex;align-items:center;gap:8px}
.hb-zone-head-toggle{cursor:pointer;user-select:none}
.hb-zone-head-toggle:hover{color:var(--dsw-alias-label-primary)}
.hb-zone-head::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l2),transparent)}
.hb-canvas{flex:1 1 58%;min-height:0;overflow:auto;padding:10px 16px 14px;cursor:grab}
.hb-canvas:active{cursor:grabbing;user-select:none}
.hb-canvas-inner{min-width:max-content;width:max-content;min-height:100%}
.hb-cn-chain-row{display:flex;flex-direction:column;margin-bottom:18px}
/* 横向血缘树画布：绝对定位卡片 + SVG 贝塞尔连线层 */
.hb-cn-canvas{position:relative;min-height:100%}
.hb-cn-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.hb-cn-bezier-path{fill:none;stroke:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);stroke-width:1.6;stroke-linecap:round}
.hb-card.hb-cn{position:absolute;box-sizing:border-box;border-left-width:2px;border-radius:12px;box-shadow:0 1px 2px color-mix(in srgb,black 8%,transparent);overflow:hidden}
.hb-card.hb-cn .top{display:flex;align-items:center;gap:6px;padding:10px 12px 4px}
.hb-card.hb-cn .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600}
.hb-card.hb-cn .metarow{display:flex;align-items:center;gap:6px;padding:2px 12px 8px;flex-wrap:wrap}
.hb-cn-edge:first-child .hb-cn-bezier{top:-62px}
.hb-cn-dot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-brand-primary);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
.hb-card.hb-cn{border-left-width:2px;border-radius:12px;box-shadow:0 1px 2px color-mix(in srgb,black 8%,transparent)}
.hb-badge.relay{color:var(--dsw-alias-label-tertiary);border-style:dotted}
.hb-tree{flex:1 1 42%;min-height:0;min-width:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);padding:6px 8px 12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,transparent)}
.hb-tree-inner{display:flex;flex-direction:column;padding:2px 0}
.hb-kids{display:flex;flex-direction:column}
.hb-trow-group{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);padding:8px 10px 4px;letter-spacing:.3px;display:flex;align-items:center;gap:5px;background:transparent;border:none;width:100%;text-align:left;cursor:pointer;border-radius:7px;font-family:inherit}
.hb-trow-group:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
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
    // 血缘唯一真源 kinshipOf：只有子代理是真正的「子会话」（2026-08-29
    // 用户裁决）；接续出的主会话不是原会话的子代理，一律根级显示，
    // 接续关系只在「交接关系」画布与详情「关联交接」区表达。
    const p = kinshipOf(n, bySid)
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

/** 血缘唯一真源：返回节点在「会话树」语义下的父会话 id。
 * 仅子代理拥有树父子关系（父链也只沿子代理链爬）；主会话（含接续会话）恒为根。
 * buildTree 与详情面板 relatives 共用本函数——修血缘 bug 只改这里。 */
function kinshipOf(node: TNode, bySid: Map<string, TNode>): string {
  if (node.kind !== 'subagent') return ''
  const p = node.parentSessionId
  const parent = p ? bySid.get(p) : undefined
  // 父失联的孤儿子代理由 treeNodes 过滤层兜底显示为根，不在此处处理
  return parent ? p : ''
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
class HBErrorBoundary extends Component<{ children?: any }, { err: string | null }> {
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // 默认折叠：expanded 记录「用户手动展开」的节点
  const [clanClosed, setClanClosed] = useState<Set<string>>(new Set()) // 血缘族框折叠
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const reqSeq = useRef(0)
  const canvasDrag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null) // 画布拖拽状态（hooks 必须稳定在组件顶层）
  const selInit = useRef(false) // 首次加载是否已默认选中当前会话
  const resyncRef = useRef<(() => void) | null>(null) // state 变化后补测一次 wrap 高度（不重建观察者）

  const toast = (text: string, tone: 'ok' | 'err' = 'ok'): void => {
    const id = toastSeq++
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    // 失败要带各轮遥测与处置建议，6 秒根本读不完；错误提示留 20 秒
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 20000 : 3600)
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
  // 高度自动适配：wrap 高度 = 最近滚动容器可视高 − wrap 顶部偏移 − 输入栏高。
  // 滚动容器/输入栏可能晚于挂载就绪 → 轮询等待 wrap 出现 + 延迟重试 + RO/resize 监听。
  // 目标：左右栏各自滚动，外层永不出现公用长滚动条。
  useEffect(() => {
    if (typeof document === 'undefined') return
    let raf = 0
    let ro: ResizeObserver | null = null
    const observed = new Set<Element>()
    const retries: ReturnType<typeof setTimeout>[] = []

    const sync = (): void => {
      // 每次重新查询：reload 后 React 可能重建 DOM，缓存引用会指向已卸载节点
      const wrap = document.querySelector('.hb-wrap') as HTMLElement | null
      if (!wrap || wrap.offsetParent === null) return
      let el = wrap.parentElement
      let scroller: HTMLElement | null = null
      while (el && el !== document.body) {
        const cs = getComputedStyle(el)
        if (/auto|scroll|overlay/.test(cs.overflowY)) { scroller = el; break }
        el = el.parentElement
      }
      if (!scroller || scroller.clientHeight <= 0) return
      // 输入栏可能晚于挂载才出现；出现后纳入观察，否则它的高度变化收不到通知
      const seat = scroller.querySelector('.wSkVaW_composerSeat')
      for (const target of seat ? [scroller, seat] : [scroller]) {
        if (ro && !observed.has(target)) { ro.observe(target); observed.add(target) }
      }
      const offset = Math.max(0, Math.round(wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop))
      const seatH = seat ? seat.getBoundingClientRect().height : 0
      const h = scroller.clientHeight - offset - seatH
      // 下限只防塌成 0，不再用 200 卡住修正（旧实现因此把错误高度永久冻结）
      if (h > 80 && Math.abs(wrap.getBoundingClientRect().height - h) > 2) {
        wrap.style.height = h + 'px'
      }
    }
    // rAF 合并：避免「写高度 → RO 回调 → 再写」的自激
    const schedule = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; sync() })
    }
    resyncRef.current = schedule

    if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(schedule)
    schedule()
    retries.push(...[150, 400, 900, 1800].map((ms) => setTimeout(schedule, ms)))
    window.addEventListener('resize', schedule)

    return () => {
      retries.forEach((t) => clearTimeout(t))
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      observed.clear()
      resyncRef.current = null
    }
  }, [])

  // state 变化后 React 可能重建 .hb-wrap 节点（inline height 随之丢失）——补测一次。
  // 注意：只补测，不重建观察者（旧实现把 effect 依赖写成 [state]，每次 15s 轮询都
  // 重新 observe 一次 body，且 cleanup 挂在 DOM 节点上拿不回来 → 监听器泄漏）。
  useEffect(() => { resyncRef.current?.() }, [state])
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
    toast('工人已开工：正在生成交接条（通常 1–5 分钟；全部重试最坏约 20 分钟，成功/失败都会在这里提示）…')
    try {
      // 服务端最坏：r1 205s + r2 285s + r3 325s + 降级轮 325s ≈ 1140s，客户端超时必须大于它，
      // 否则会在服务端还在跑时就先断开，只报一句无信息量的「生成异常」
      const r = await postJSON('/generate', { sessionId: sid }, 1_250_000)
      // 失败详情现在带各轮遥测，可能较长——err toast 停留 6s，截断放宽到 400 字
      if (!r.ok) { toast('生成失败：' + String(r.error).slice(0, 400), 'err'); return }
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

  // 时间组（今天/昨天/7天内/更早）折叠状态：默认折叠，点组标题展开；
  // 全部折叠时整棵会话树只显示各组标题一条，不挤占上方交接画布
  const [groupsOpen, setGroupsOpen] = useState<Set<string>>(new Set())
  // 会话树整区折叠：收起时整个 zone 只显示标题行（不挤占上方交接画布）
  const [treeZoneOpen, setTreeZoneOpen] = useState(false)
  const toggleGroup = (label: string): void => {
    setGroupsOpen((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
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
  const selected = allNodes.find((n) => n.key === selectedKey) ?? null
  // 血缘唯一真源：与 buildTree/kinshipOf 同一规则——只有子代理是「子会话」；
  // 接续关系不算父子，另列为「关联交接」（信息不丢但不再冒充子会话）。
  const relatives = (() => {
    if (!selected) return null
    const parents: TNode[] = []
    const seen = new Set<string>()
    const bySid = new Map(allNodes.map((n) => [n.sessionId, n]))
    let p = kinshipOf(selected, bySid)
    while (p) {
      const pn = bySid.get(p)
      if (!pn || seen.has(p)) break
      seen.add(p)
      parents.push(pn) // 先入列：顶头父会话可能是主会话（子代理的父本来就是主会话）
      p = kinshipOf(pn, bySid) // pn 非子代理时返回 ''，链自然止于此
    }
    // ↑ 交接自：本会话从哪个会话接续而来（仅接续主会话有；子代理的来源即血缘父，已在 parents）
    const continuedFrom: TNode[] = []
    if (selected.kind !== 'subagent' && selected.parentSessionId) {
      const src = bySid.get(selected.parentSessionId)
      if (src && !seen.has(src.sessionId)) continuedFrom.push(src)
    }
    const children: TNode[] = []
    const continuations: TNode[] = []
    for (const n of allNodes) {
      if (n.parentSessionId !== selected.sessionId) continue
      if (n.kind === 'subagent') children.push(n)
      else continuations.push(n)
    }
    children.sort((a, b) => a.createdAt - b.createdAt)
    continuations.sort((a, b) => a.createdAt - b.createdAt)
    return { parents, children, continuations, continuedFrom }
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
      : rc('div', { key: 'cvs', className: 'hb-canvas-inner' }, [
          ...chains.map((c) => rc('div', { key: 'row-' + c.node.key, className: 'hb-cn-chain-row' }, renderNoteChain(c, ctx, 0))),
        ])
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
    const groupOpen = groupsOpen.has(label)
    treeRows.push(rc('button', {
      key: 'grp-' + label,
      className: 'hb-trow-group' + (groupOpen ? ' open' : ''),
      onClick: () => toggleGroup(label),
      title: groupOpen ? '折叠本组' : '展开本组',
    }, `${groupOpen ? '▾' : '▸'} ${label} · ${list.length} 个会话`))
    if (groupOpen) {
      for (const f of list) treeRows.push(renderTreeRow(f, treeCtx, 0))
    }
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
        rc('div', { key: 'trz', className: 'hb-zone' + (treeZoneOpen ? '' : ' hb-zone-collapsed') }, [
          rc('div', {
            key: 'trh',
            className: 'hb-zone-head hb-zone-head-toggle',
            onClick: () => setTreeZoneOpen(!treeZoneOpen),
            title: treeZoneOpen ? '折叠会话树（只留标题行）' : '展开会话树',
          }, [
            (treeZoneOpen ? '▾ ' : '▸ ') + '会话树 · 子代理缩进在父下，接续会话为独立根节点（' + totalNotes + ' 交接 / ' + totalPh + ' 未交接）',
            rc('button', {
              key: 'exp',
              className: 'hb-iconbtn',
              title: groupsOpen.size > 0 ? '全部折叠' : '全部展开',
              onClick: (e: any) => {
                e.stopPropagation()
                if (groupsOpen.size > 0) setGroupsOpen(new Set())
                else setGroupsOpen(new Set(['今天', '昨天', '7 天内', '更早']))
              },
            }, groupsOpen.size > 0 ? '▾' : '▸'),
          ]),
          treeZoneOpen
            ? rc('div', { key: 'tr', className: 'hb-tree' }, treeNode)
            : null,
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

/* 画布：交接卡横向血缘树 + 贝塞尔承接连线（借鉴 dsh-synapse 观感）。
 * 布局自动计算（根在左、子向右展开，卡片绝对定位但不可拖拽——
 * 坐标由树结构推导，不持久化）；画布可平移（外层滚动）。 */
const CN_W = 260
const CN_H = 78
const CN_GAP_X = 56
const CN_GAP_Y = 14

interface CnvCard { node: TNode; x: number; y: number }
interface CnvEdge { fromKey: string; toKey: string; x1: number; y1: number; x2: number; y2: number }
interface CnvLayout { w: number; h: number; cards: CnvCard[]; edges: CnvEdge[] }

/** 递归布局：每个子树返回宽高、卡片坐标、连线端点（父卡右缘中 → 子卡左缘中）。 */
function layoutNoteChain(chain: NoteChain, x: number, y: number): CnvLayout {
  const cards: CnvCard[] = [{ node: chain.node, x, y }]
  const edges: CnvEdge[] = []
  let cursorY = y
  let maxW = 0
  let subH = CN_H
  for (const kid of chain.kids) {
    const sub = layoutNoteChain(kid, x + CN_W + CN_GAP_X, cursorY)
    const fx = x + CN_W, fy = y + CN_H / 2
    const tx = sub.cards[0]!.x, ty = sub.cards[0]!.y + CN_H / 2
    edges.push({ fromKey: chain.node.key, toKey: kid.node.key, x1: fx, y1: fy, x2: tx, y2: ty })
    cards.push(...sub.cards)
    edges.push(...sub.edges)
    cursorY = sub.cards[0]!.y + sub.h + CN_GAP_Y
    maxW = Math.max(maxW, sub.w)
    subH = Math.max(subH, cursorY - y)
  }
  return { w: CN_W + (maxW > 0 ? CN_GAP_X + maxW : 0), h: subH, cards, edges }
}

function renderNoteChain(chain: NoteChain, ctx: RenderCtx, depth: number): any {
  const layout = layoutNoteChain(chain, 0, 0)
  const selKey = ctx.selectedKey
  const selfSid = ctx.selfSid
  const cards = layout.cards.map((c) => {
    const n = c.node
    const sel = selKey === n.key
    return rc('div', {
      key: 'crd-' + n.key,
      'data-hb-node': n.key,
      className: 'hb-card hb-cn' + (sel ? ' sel' : '') + (n.sessionId === selfSid ? ' self' : '') + (n.status === '进行中' ? ' live' : ''),
      style: { left: c.x + 'px', top: c.y + 'px', width: CN_W + 'px', height: CN_H + 'px' },
      onClick: () => ctx.onSelect(sel ? null : n.key),
    }, [
      rc('div', { key: 't', className: 'top' }, [
        rc('span', { key: 'd', className: 'hb-cn-dot' }),
        rc('div', { key: 't2', className: 't' }, (n.kind === 'subagent' ? '🤖 ' : '') + n.title.slice(0, 40)),
        rc('span', { key: 'ti', className: 'hb-time-inline' }, fmt(n.createdAt)),
      ]),
      rc('div', { key: 'm', className: 'metarow' }, [
        n.status === '进行中' ? rc('span', { key: 'lv', className: 'hb-badge live' }, '进行中') : null,
        n.sessionId === selfSid && selfSid ? rc('span', { key: 'sf', className: 'hb-badge self' }, '当前') : null,
        chain.kids.length > 0 ? rc('span', { key: 'fk', className: 'hb-badge fork' }, `延续 ${chain.kids.length} 个会话`) : null,
        rc('span', { key: 'id', className: 'hb-id' }, short8(n.sessionId)),
      ]),
    ])
  })
  const edgeSvg = layout.edges.length > 0
    ? rc('svg', {
        key: 'edges',
        className: 'hb-cn-edges',
        width: layout.w,
        height: layout.h,
        'aria-hidden': 'true',
      }, layout.edges.map((e) => {
        const bend = Math.min(40, Math.max(16, Math.abs(e.x2 - e.x1) * 0.3))
        return rc('path', {
          key: 'edg-' + e.fromKey + '-' + e.toKey,
          d: 'M ' + e.x1 + ' ' + e.y1 + ' C ' + (e.x1 + bend) + ' ' + e.y1 + ', ' + (e.x2 - bend) + ' ' + e.y2 + ', ' + e.x2 + ' ' + e.y2,
          className: 'hb-cn-bezier-path',
        })
      }))
    : null
  return rc('div', { key: 'cnv-' + chain.node.key, className: 'hb-cn-canvas', style: { width: layout.w + 'px', height: layout.h + 'px' } }, [
    edgeSvg,
    ...cards,
  ])
}

/* 会话树：当前工作区全部会话（交接+未交接），父在上、子会话缩进在下、默认全展开 */
function renderTreeRow(fam: Fam, ctx: RenderCtx, depth: number): any {
  const n = fam.node
  const hasKids = fam.children.length > 0
  const open = ctx.expanded.has(n.key) // 默认折叠；expanded 记录「用户手动展开」的节点
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
  relatives: { parents: TNode[]; children: TNode[]; continuations: TNode[]; continuedFrom: TNode[] } | null
  onOpenSource(sid: string, missing?: boolean): void
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
        rc('div', { key: 'k', className: 'hb-rel-row' }, [
          rc('span', { key: 'r', className: 'hb-rel-role' }, '↑ 交接自（前一个）'),
          rel.continuedFrom.length === 0
            ? rc('span', { key: 'n', className: 'hb-rel-none' }, '无')
            : rel.continuedFrom.map((c) => rc('button', {
                key: 'from-' + c.key,
                className: 'hb-rel-item' + (c.type === 'note' ? '' : ' ph'),
                title: '本会话由这个会话接续而来（点击查看）',
                onClick: () => props.onLocate(c.key),
              }, `${c.type === 'note' ? '⚡' : '○'} ${(c.title || short8(c.sessionId)).slice(0, 16)}`)),
        ]),
        rc('div', { key: 'k2', className: 'hb-rel-row' }, [
          rc('span', { key: 'r', className: 'hb-rel-role' }, '↓ 被接续（后一个）'),
          rel.continuations.length === 0
            ? rc('span', { key: 'n', className: 'hb-rel-none' }, '无')
            : rel.continuations.map((c) => rc('button', {
                key: 'cont-' + c.key,
                className: 'hb-rel-item' + (c.type === 'note' ? '' : ' ph'),
                title: '这个会话从本会话接续出去（点击查看）',
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
