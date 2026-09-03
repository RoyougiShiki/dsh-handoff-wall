/**
 * 宿主 HTTP 路由：交接板 client 的数据与动作面。
 * 前缀 /handoff-board（刻意避开 /api 信任围栏——talkmap 同款决策）。
 * POST 一律 same-origin 校验；JSON in/out；guarded 兜异常。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BoardDomain } from './store.js'
import { resolveProjectKey } from './store.js'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { continueWithNote, type ContinueDeps } from './spawn.js'
import { generateHandoff, type HandoffDeps } from './command.js'

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

export const BOARD_BASE = '/handoff-board'

const dirName = (p?: string): string => (p ? p.slice(p.lastIndexOf('/') + 1) || p : '')

/* ── 会话标题解析（与官方侧边栏同源）──
 * 标题真相：session/title 事件的 last-wins 折叠（foldSessionTitle 与
 * dsh-client-ui-workspace 侧边栏完全一致；2026-08-28 用户反馈：旧实现取首个事件
 * = 内容开头文本，与侧边栏手改后的标题不符）。
 * 事件在会话日志里：优先 ctx.sessionQuery.readTitle(sid)（宿主官方 last-wins 折叠，
 * 与侧边栏完全同源）；老宿主无 readTitle 时回退 load(sid)+foldSessionTitle。
 * 事故约束（ENOMEM）：/state 请求只读缓存，永不触发磁盘读；未命中/过期入后台队列
 * 渐进补齐，每条之间 setImmediate 让出事件循环；进行中会话标题会变化 → TTL 5 分钟重查。
 */
const TITLE_CACHE = new Map<string, { title: string; checkedAt: number }>()
const TITLE_TTL = 5 * 60 * 1000

interface TitleQuery {
  readTitle?(sid: string): Promise<unknown>
  load?(sid: string): Promise<{ events: readonly unknown[] }>
}

/** 单个会话的官方标题（last-wins）；读不到返回空串。 */
async function resolveTitleOf(sid: string, q: TitleQuery): Promise<{ title: string; checkedAt: number }> {
  const now = Date.now()
  try {
    if (typeof q.readTitle === 'function') {
      const raw = await q.readTitle(sid)
      // 宿主版本差异：最新 readTitle 返回标题字符串，部分版本返回 { title } 对象
      const t = typeof raw === 'string' ? raw : (raw as any)?.title ?? ''
      return { title: typeof t === 'string' ? t : '', checkedAt: now }
    }
    if (typeof q.load === 'function') {
      const loaded = await q.load(sid)
      const snap = foldSessionTitle((loaded as any).events as any)
      return { title: snap?.title ?? '', checkedAt: now }
    }
    return { title: '', checkedAt: now }
  } catch (e) {
    console.info('[hb-title] 失败:', sid.slice(0, 14), String(e).slice(0, 120))
    return { title: '', checkedAt: now }
  }
}

/* 后台补全队列：请求路径 O(1)。 */
const titleQueue: Array<{ sid: string; q: TitleQuery }> = []
let titleDraining = false
async function drainTitleQueue(): Promise<void> {
  while (titleQueue.length > 0) {
    const item = titleQueue.shift()!
    try {
      const r = await resolveTitleOf(item.sid, item.q)
      TITLE_CACHE.set(item.sid, r)
    } catch { /* 单条失败不阻断队列 */ }
    await new Promise<void>((r) => setImmediate(() => r()))
  }
  titleDraining = false
}
/** 请求路径入口：只读缓存；未命中/过期入队后台补齐。 */
function enqueueTitle(sid: string, q: TitleQuery): string {
  const hit = TITLE_CACHE.get(sid)
  if (!hit || Date.now() - hit.checkedAt >= TITLE_TTL) {
    titleQueue.push({ sid, q })
    if (!titleDraining) { titleDraining = true; void drainTitleQueue() }
  }
  return hit?.title ?? ''
}

/* listSessions 短缓存：宿主持久化列表每次全量遍历（跨全部工作区，实测 ~470ms/请求），
 * 板 15s 轮询会把它放大为持续的事件循环阻塞。15s TTL 与轮询同频，
 * 新会话/会话结束最多延迟 15s 反映，可接受。 */
let sessionsCache: { at: number; rows: unknown[] } | null = null
const SESSIONS_TTL = 15 * 1000
let surfaceCache: { sid: string; at: number; value: { cwd: string; dirName: string; projectKey: string } } | null = null
async function listSessionsCached(q: { listSessions(signal?: AbortSignal): Promise<unknown[]> }): Promise<unknown[]> {
  const now = Date.now()
  if (sessionsCache && now - sessionsCache.at < SESSIONS_TTL) return sessionsCache.rows
  const rows = await q.listSessions()
  sessionsCache = { at: now, rows }
  return rows
}

/* resolveProjectKey 缓存：它对每个 cwd 做逐层 existsSync(.git) 探测（跨盘 IO），
 * unnotedAll 每次对全部工作区几百条会话重复调用 → 每请求 ~200ms。
 * cwd→projectKey 一经确定不变，模块级缓存后请求内零 IO。 */
const projectKeyCache = new Map<string, string>()
function resolveProjectKeyCached(cwd?: string): string {
  if (!cwd) return 'default'
  const hit = projectKeyCache.get(cwd)
  if (hit !== undefined) return hit
  const v = resolveProjectKey(cwd)
  projectKeyCache.set(cwd, v)
  return v
}
export interface RouteDeps {
  ctx: HandoffDeps['ctx'] & ContinueDeps['ctx'] & {
    sessionQuery: { readTitle?(sessionId: string): Promise<unknown>; load?(sessionId: string): Promise<{ events: readonly unknown[] }> }
    webServer: { register(route: WebRoute): () => void }
  }
  domain: BoardDomain
}

export function mountBoardRoutes(ctx: RouteDeps['ctx'], domain: BoardDomain): () => void {
  const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      // 状态面一律禁缓存：此前浏览器缓存旧 /state 加剧「数据不随工作区刷新」观感
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  const guarded =
    (fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    (req: IncomingMessage, res: ServerResponse): void => {
      fn(req, res).catch((e) => {
        try {
          // 截断放宽：生成失败的错误串现在带分类标签 + 处置建议 + 各轮遥测，
          // 300 字会把最关键的原因和建议切掉（用户看不到真因 = 变相静默失败）
          json(res, 500, { ok: false, error: String(e).slice(0, 1600) })
        } catch { /* 已响应 */ }
      })
    }
  const readBody = (req: IncomingMessage): Promise<any> =>
    new Promise((resolveBody) => {
      let data = ''
      req.on('data', (c: Buffer) => (data += String(c)))
      req.on('end', () => {
        try {
          resolveBody(JSON.parse(data || '{}'))
        } catch {
          resolveBody({})
        }
      })
    })
  const disposers: Array<() => void> = []
  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown): void => {
    disposers.push(ctx.webServer.register({ kind: 'exact', path, handler }))
  }

  // ── 状态：线程 + 条目（含实时归档态映射）──
  register(BOARD_BASE + '/state', guarded(async (req, res) => {
    const url = new URL(req.url || '/', 'http://local')
    // 当前会话上下文：视图把 props.sessionId 带回来，宿主解析出 cwd/projectKey，
    // 实现「按当前对话自动匹配项目」（不做人工下拉筛选）
    const curSid = url.searchParams.get('sessionId') || ''
    const tMs = { t0: Date.now(), list: 0, surface: 0, body: 0, assemble: 0 }
    let current: { cwd: string; dirName: string; projectKey: string } | null = null
    if (curSid) {
      // readSurface 逐请求读当前会话持久化日志（实测 ~270ms），同会话 10s 内复用
      const hit = surfaceCache && surfaceCache.sid === curSid && Date.now() - surfaceCache.at < SESSIONS_TTL
        ? surfaceCache.value
        : null
      if (hit !== null) {
        current = hit
      } else {
        try {
          const tS = Date.now()
          const surf = (await ctx.sessionQuery.readSurface(curSid)) as any
          tMs.surface = Date.now() - tS
          const cwd: string | undefined = surf?.session?.cwd
          if (cwd) {
            current = { cwd, dirName: dirName(cwd), projectKey: resolveProjectKeyCached(cwd) }
            surfaceCache = { sid: curSid, at: Date.now(), value: current }
          }
        } catch { /* 会话不可读时无当前上下文 */ }
      }
    }
    const tL = Date.now()
    const sessionMap = new Map(
      (await listSessionsCached(ctx.sessionQuery as never)).map((r: any) => [r.header.id, r]),
    )
    // 接续血缘：links 表优先（v0.0.3+），回退 header.parentSession（存量接续会话）；
    // 子代理的 header.parentSession 是宿主写的真实血缘，走回退分支不受影响
    const linkParent = new Map(
      [...domain.table('links').entries()].map(([, r]) => {
        const link = r as { childSessionId: string; parentSessionId: string }
        return [link.childSessionId, link.parentSessionId]
      }),
    )
    const parentOf = (sessionId: string): string =>
      linkParent.get(sessionId) ?? sessionMap.get(sessionId)?.header?.parentSession ?? ''
    tMs.list = Date.now() - tL
    const statusOf = (sessionId: string): string => {
      const s = sessionMap.get(sessionId)
      if (!s) return '已归档'
      return s.live ? '进行中' : '已归档'
    }
    // 铁律（用户 2026-08-27）：永远只显示当前会话所在工作区的项目——
    // 线程、条目、占位全部按当前 projectKey 硬过滤，无法定位时不给兜底全量
    let threads = [...domain.table('threads').entries()].map(([, t]) => t as any)
    if (!current) threads = []
    else threads = threads.filter((t) => t.projectKey === current.projectKey)
    const visibleThreadIds = new Set(threads.map((t) => t.id))
    const notes = [...domain.table('notes').entries()].map(([, n]) => n as any)
      .filter((n) => visibleThreadIds.has(n.threadId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((n) => ({
        id: n.id,
        threadId: n.threadId,
        sessionId: n.sessionId,
        createdAt: n.createdAt,
        title: n.title,
        body: n.body,
        files: n.files,
        provenance: n.provenance,
        status: statusOf(n.sessionId),
        // 来源会话在磁盘上已不存在（日志被清理）：打开原对话不可用，标记给客户端
        missing: !sessionMap.has(n.sessionId),
        parentSessionFull: parentOf(n.sessionId),
        kind: (sessionMap.get(n.sessionId)?.header?.origin === 'subagent') ? 'subagent' : 'main',
      }))
      .filter((n: any) => {
        // 来源会话已不存在（磁盘无日志）：整体隐藏（2026-08-28 用户规则——显示没有意义，打开也失败）
        if (n.missing) return false
        // 孤儿子代理交接条隐藏（2026-08-28 用户规则）：subagent 的交接条仅当父会话
        // 属于本工作区才显示——父失联（如 talkmap 条的 session-53dc2a99 全盘不存在）
        // 或父在其他工作区的情形一律隐藏。
        if (n.kind !== 'subagent') return true
        const parent = sessionMap.get(n.parentSessionFull)
        if (!parent) return false
        return resolveProjectKeyCached(parent.header.cwd ?? '') === current!.projectKey
      })
    const notedSessions = new Set(notes.map((n: any) => n.sessionId))
    const unnotedAll = [...sessionMap.values()]
      .filter((r: any) => !notedSessions.has(r.header.id))
      .sort((a: any, b: any) => b.header.createdAt - a.header.createdAt)
      .map((r: any) => ({
        sessionId: r.header.id,
        createdAt: r.header.createdAt,
        status: r.live ? '进行中' : '已归档',
        kind: r.header.origin === 'subagent' ? 'subagent' : 'main',
        cwd: r.header.cwd ?? '',
        dirName: dirName(r.header.cwd),
        projectKey: resolveProjectKeyCached(r.header.cwd),
        parentSessionFull: parentOf(r.header.id),
        title: (r.header as any)?.title ?? (r as any)?.title ?? '',
      }))
    const unnoted = current
      ? unnotedAll.filter((u: any) => u.projectKey === current.projectKey).slice(0, 80)
      : []
    // 标题：请求只读缓存（零磁盘 IO、零阻塞）；未命中入后台队列，用官方 fold 补齐；
    // 与侧边栏同源（last-wins），手改过的标题不再显示成内容开头。
    for (const u of unnoted as any[]) {
      u.title = enqueueTitle(u.sessionId, ctx.sessionQuery)
    }
    const tA = Date.now()
    tMs.assemble = tA - tMs.t0 - tMs.list - tMs.surface
    const debug = url.searchParams.get('debug') === '1'
    tMs.body = Date.now() - tMs.t0 - tMs.list - tMs.surface
    const jsonStart = Date.now()
    json(res, 200, debug
      ? {
          ok: true, threads, notes, unnoted, current,
          debug: {
            queue: titleQueue.length,
            draining: titleDraining,
            cache: TITLE_CACHE.size,
            titled: unnoted.filter((u: any) => u.title).length,
            ms: { ...tMs, write: Date.now() - jsonStart },
          },
        }
      : { ok: true, threads, notes, unnoted, current })
  }))

  // ── 接续：从一条交接条开新会话并注入全文 ──
  register(BOARD_BASE + '/continue', guarded(async (req, res) => {
    const body = await readBody(req)
    if (typeof body.noteId !== 'string' || !body.noteId) {
      json(res, 400, { ok: false, error: 'noteId 必填' })
      return
    }
    const result = await continueWithNote({ ctx }, domain, body.noteId)
    json(res, 200, { ok: true, newSessionId: result.newSessionId, title: result.note.title, agentPreset: result.agentPreset, warning: result.warning })
  }))

  // ── 补写交接：为指定会话现场生成（独立工人，不依赖该会话存活）──
  register(BOARD_BASE + '/generate', guarded(async (req, res) => {
    const body = await readBody(req)
    const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined
    if (!sessionId) {
      json(res, 400, { ok: false, error: 'sessionId 必填（HTTP 入口无当前会话概念）' })
      return
    }
    const { note, thread } = await generateHandoff({ ctx, domain }, sessionId)
    json(res, 200, {
      ok: true,
      noteId: note.id,
      title: note.title,
      text: `已存入交接板：${thread.title} / ${note.title}`,
    })
  }))

  // webServer.register 的反注册函数必须逐个保留——否则卸载后路由残留，重装即 duplicate 冲突
  return () => disposers.forEach((d) => d())
}
