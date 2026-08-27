/**
 * 宿主 HTTP 路由：交接板 client 的数据与动作面。
 * 前缀 /handoff-board（刻意避开 /api 信任围栏——talkmap 同款决策）。
 * POST 一律 same-origin 校验；JSON in/out；guarded 兜异常。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BoardDomain } from './store.js'
import { resolveProjectKey } from './store.js'
import { continueWithNote, type ContinueDeps } from './spawn.js'
import { generateHandoff, type HandoffDeps } from './command.js'

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

export const BOARD_BASE = '/handoff-board'

const dirName = (p?: string): string => (p ? p.slice(p.lastIndexOf('/') + 1) || p : '')

export interface RouteDeps {
  ctx: HandoffDeps['ctx'] & ContinueDeps['ctx'] & {
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
          json(res, 500, { ok: false, error: String(e).slice(0, 300) })
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
    const wsFilter = url.searchParams.get('ws') || ''
    // 当前会话上下文：视图把 props.sessionId 带回来，宿主解析出 cwd/projectKey，
    // 实现「按当前对话自动匹配项目」（不做人工下拉筛选）
    const curSid = url.searchParams.get('sessionId') || ''
    let current: { cwd: string; dirName: string; projectKey: string } | null = null
    if (curSid) {
      try {
        const surf = (await ctx.sessionQuery.readSurface(curSid)) as any
        const cwd: string | undefined = surf?.session?.cwd
        if (cwd) current = { cwd, dirName: dirName(cwd), projectKey: resolveProjectKey(cwd) }
      } catch { /* 会话不可读时无当前上下文，页面照常全量展示 */ }
    }
    const sessionMap = new Map(
      (await ctx.sessionQuery.listSessions()).map((r: any) => [r.header.id, r]),
    )
    const statusOf = (sessionId: string): string => {
      const s = sessionMap.get(sessionId)
      if (!s) return '已归档'
      return s.live ? '进行中' : '已归档'
    }
    let threads = [...domain.table('threads').entries()].map(([, t]) => t as any)
    if (wsFilter) threads = threads.filter((t) => (t.cwd ?? '').startsWith(wsFilter))
    threads.sort((a, b) => b.createdAt - a.createdAt)
    for (const t of threads) t.current = !!current && t.projectKey === current.projectKey
    const workspaces = [...new Set(threads.map((t) => t.cwd).filter(Boolean))]
    const notes = [...domain.table('notes').entries()].map(([, n]) => n as any)
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
        parentSession: (sessionMap.get(n.sessionId)?.header?.parentSession ?? '').replace(/^session-/, '').slice(0, 8),
        kind: (sessionMap.get(n.sessionId)?.header?.origin === 'subagent') ? 'subagent' : 'main',
      }))
        const notedSessions = new Set(notes.map((n: any) => n.sessionId))
    const unnoted = [...sessionMap.values()]
      .filter((r: any) => !notedSessions.has(r.header.id))
      .sort((a: any, b: any) => b.header.createdAt - a.header.createdAt)
      .slice(0, 60)
      .map((r: any) => ({
        sessionId: r.header.id,
        createdAt: r.header.createdAt,
        status: r.live ? '进行中' : '已归档',
        kind: r.header.origin === 'subagent' ? 'subagent' : 'main',
        cwd: r.header.cwd ?? '',
        dirName: dirName(r.header.cwd),
      }))
    json(res, 200, { ok: true, threads, notes, unnoted, workspaces, current })
  }))

  // ── 接续：从一条交接条开新会话并注入全文 ──
  register(BOARD_BASE + '/continue', guarded(async (req, res) => {
    const body = await readBody(req)
    if (typeof body.noteId !== 'string' || !body.noteId) {
      json(res, 400, { ok: false, error: 'noteId 必填' })
      return
    }
    const result = await continueWithNote({ ctx }, domain, body.noteId)
    json(res, 200, { ok: true, newSessionId: result.newSessionId, title: result.note.title, warning: result.warning })
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
