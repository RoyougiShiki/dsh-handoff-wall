/**
 * AI 四件套：board / read_handoff / write_handoff / who_else。
 * 设计原则（用户指令）：数量少、参数少、描述含「何时用」——降低使用成本与误用率。
 * 全部经 ctx.tools.register 注册；write_handoff 与 /handoff 共用 generateHandoff 引擎（ADR-0004）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BoardDomain, NoteRow } from './store.js'
import { generateHandoff, type HandoffDeps } from './command.js'

type Ctx = HandoffDeps['ctx']

export interface ToolsDeps {
  ctx: Ctx
  domain: BoardDomain
}

/** 从会话清单派生状态与类型（零额外请求：listSessions 一次带 header.origin）。 */
function infoOf(sessions: Map<string, any>, sessionId: string): { status: string; kind: string } {
  const s = sessions.get(sessionId)
  if (!s) return { status: '未知', kind: '未知' }
  return {
    status: s.live ? '进行中' : '已归档',
    kind: s.header?.origin === 'subagent' ? '🤖子代理' : '主对话',
  }
}

const fmt = (ms: number): string => new Date(ms).toISOString().slice(5, 16).replace('T', ' ')

export function buildBoardTools(deps: ToolsDeps) {
  const { ctx, domain } = deps

  // ── board：总览（唯一入口，无过滤参数——全量返回让模型自行扫读）──
  const boardTool = defineTool({
    name: 'board',
    description:
      '【了解项目工作历史时用】返回交接板全部内容：按线程分组的交接条清单（日期｜标题｜状态｜类型｜文件数｜id），时间倒序。新会话开工前的第一入口。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: async () => {
      const threads = [...domain.table('threads').entries()].map(([, r]) => r as any)
      const notes = [...domain.table('notes').entries()].map(([, r]) => r as NoteRow)
        .sort((a, b) => b.createdAt - a.createdAt)
      const sessionMap = new Map(
        (await ctx.sessionQuery.listSessions()).map((r: any) => [r.header.id, r]),
      )
      if (notes.length === 0) {
        return '交接板为空：还没有任何交接条。可在会话里输入 /handoff 生成第一条。'
      }
      const out: string[] = ['# 交接板']
      for (const t of threads) {
        const tn = notes.filter((n) => n.threadId === t.id)
        if (tn.length === 0) continue
        out.push(`\n## ${t.title}（线程 ${t.id.slice(0, 8)}）`)
        for (const n of tn) {
          const info = infoOf(sessionMap, n.sessionId)
          const parent = n.parentSessionId ? ` ←父${n.parentSessionId.replace(/^session-/, '').slice(0, 8)}` : ''
          out.push(
            `- ${fmt(n.createdAt)} | ${info.kind}${parent} | ${n.title} | ${info.status} | 文件${n.files.length} | id=${n.id.slice(0, 8)}`,
          )
        }
      }
      return out.join('\n')
    },
  })

  // ── read_handoff：单条全文 ──
  const readTool = defineTool({
    name: 'read_handoff',
    description: '【需要某条交接的完整细节时用】读取一条交接条的六段全文。id 可用 board 返回的前 8 位前缀。',
    parameters: {
      id: { type: 'string', required: true, description: '交接条 id 或其前缀' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: async (args) => {
      const notes = domain.table('notes')
      let note = notes.get(args.id) as NoteRow | undefined
      if (!note && args.id.length < 36) {
        const hit = [...notes.entries()].find(([k]) => k.startsWith(args.id))
        note = hit?.[1] as NoteRow | undefined
      }
      if (!note) throw new Error(`交接条不存在: ${args.id}`)
      return note.body
    },
  })

  // ── write_handoff：生成/补写 ──
  const writeTool = defineTool({
    name: 'write_handoff',
    description:
      '【阶段完成或会话暴毙需要交接时用】为指定会话生成六段交接条入库。不传 session_id=总结当前会话；传入其他会话 id 可为暴毙/无法继续的会话补条——工人独立调用，不依赖该会话可用。',
    parameters: {
      session_id: { type: 'string', description: '要总结的会话 id；缺省=当前会话' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const sessionId = args.session_id ?? (exec as any)?.agent?.session?.id ?? undefined
      if (!sessionId) throw new Error('write_handoff: 未提供 session_id 且当前无会话上下文')
      const { note, thread } = await generateHandoff(deps, sessionId)
      return {
        text: `✅ 已存入交接板：${thread.title} / ${note.title}`,
        note_id: note.id,
        thread_title: thread.title,
        title: note.title,
      }
    },
  })

  // ── who_else：现在时撞车检查 ──
  const whoElseTool = defineTool({
    name: 'who_else',
    description:
      '【改文件之前用】撞车检查：还有哪些「活着」的其他会话最近触碰过给定路径？（剔除调用者自身；仅查存活会话）',
    parameters: {
      path: { type: 'string', required: true, description: '文件路径或其子串' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const currentId = (exec as any)?.agent?.session?.id
      const live = (await ctx.sessionQuery.listSessions()).filter(
        (r: any) => r.live && r.header.id !== currentId,
      )
      const hits: Array<{ id: string; when: number }> = []
      for (const rec of live) {
        try {
          const snap = await ctx.sessionQuery.readSurface(rec.header.id)
          let when = 0
          for (const e of (snap?.events ?? []).slice(-200)) {
            const stamp = typeof e?.time === 'number' ? e.time : 0
            if (stamp > when && JSON.stringify(e).includes(args.path)) when = stamp
          }
          if (when > 0) hits.push({ id: rec.header.id, when })
        } catch { /* 单个失败不影响其余 */ }
      }
      if (hits.length === 0) return `没有其他活着的会话近期碰过 ${args.path}。可以动手。`
      hits.sort((a, b) => b.when - a.when)
      return [
        `⚠️ ${hits.length} 个活着的会话近期碰过 ${args.path}：`,
        ...hits.map((h) => `- ${h.id.slice(0, 13)}… 最后触达 ${new Date(h.when).toISOString().slice(5, 16).replace('T', ' ')}`),
      ].join('\n')
    },
  })

  return [boardTool, readTool, writeTool, whoElseTool]
}

/** 注册全部工具，返回聚合反注册函数（交给 ctx.effect）。 */
export function registerBoardTools(deps: ToolsDeps): () => void {
  const ctxWithTools = deps.ctx as Ctx & {
    tools: { register(def: unknown): () => void }
  }
  const disposers = buildBoardTools(deps).map((def) => ctxWithTools.tools.register(def))
  return () => disposers.forEach((d) => d())
}
