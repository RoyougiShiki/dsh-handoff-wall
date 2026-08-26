/**
 * 宿主 HTTP 路由：交接板 client 的数据与动作面。
 * 前缀 /handoff-board（刻意避开 /api 信任围栏——talkmap 同款决策）。
 * POST 一律 same-origin 校验；JSON in/out；guarded 兜异常。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BoardDomain } from './store.js'
import { continueWithNote, type ContinueDeps } from './spawn.js'
import { generateHandoff, type HandoffDeps } from './command.js'

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

export const BOARD_BASE = '/handoff-board'

export interface RouteDeps {
  ctx: HandoffDeps['ctx'] & ContinueDeps['ctx'] & {
    webServer: { register(route: WebRoute): () => void }
  }
  domain: BoardDomain
}

export function mountBoardRoutes(ctx: RouteDeps['ctx'], domain: BoardDomain): () => void {
  const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
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
    const sessionMap = new Map(
      (await ctx.sessionQuery.listSessions()).map((r: any) => [r.header.id, r]),
    )
    const statusOf = (sessionId: string): string => {
      const s = sessionMap.get(sessionId)
      if (!s) return '未知'
      return s.live ? '进行中' : '已归档'
    }
    let threads = [...domain.table('threads').entries()].map(([, t]) => t as any)
    if (wsFilter) threads = threads.filter((t) => (t.cwd ?? '').startsWith(wsFilter))
    const threadIds = new Set(threads.map((t) => t.id))
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
        parentSession: (sessionMap.get(n.sessionId)?.header?.parentSession ?? '').slice(0, 8),
        kind: (sessionMap.get(n.sessionId)?.header?.origin === 'subagent') ? 'subagent' : 'main',
        status: statusOf(n.sessionId),
        kind: (sessionMap.get(n.sessionId)?.header?.origin === 'subagent') ? 'subagent' : 'main',
      }))
        const notedSessions = new Set(notes.map((n: any) => n.sessionId))
    const unnoted = [...sessionMap.values()]
      .filter((r: any) => !notedSessions.has(r.header.id))
      .sort((a: any, b: any) => b.header.createdAt - a.header.createdAt)
      .slice(0, 30)
      .map((r: any) => ({
        sessionId: r.header.id,
        createdAt: r.header.createdAt,
        status: r.live ? '进行中' : '已归档',
        kind: r.header.origin === 'subagent' ? 'subagent' : 'main',
      }))
    json(res, 200, { ok: true, threads, notes, unnoted, workspaces })
  }))

  // ── 接续：从一条交接条开新会话并注入全文 ──
  register(BOARD_BASE + '/continue', guarded(async (req, res) => {
    const body = await readBody(req)
    if (typeof body.noteId !== 'string' || !body.noteId) {
      json(res, 400, { ok: false, error: 'noteId 必填' })
      return
    }
    const result = await continueWithNote({ ctx }, domain, body.noteId)
    json(res, 200, { ok: true, newSessionId: result.newSessionId, title: result.note.title })
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
