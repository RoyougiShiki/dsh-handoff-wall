/**
 * AI 四件套：board / read_handoff / write_handoff / who_else。
 * 全部经 ctx.tools.register 注册进模型可见工具表；
 * write_handoff 与 /handoff 命令共用同一 generateHandoff 引擎（ADR-0004）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BoardDomain, NoteRow, ThreadRow } from './store.js'
import { generateHandoff, type HandoffDeps } from './command.js'

type Ctx = HandoffDeps['ctx']

export interface ToolsDeps {
  ctx: Ctx
  domain: BoardDomain
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/** 状态映射（ADR-0003：live/persisted → 进行中/已归档） */
function statusOf(sessions: Map<string, any>, sessionId: string): string {
  const s = sessions.get(sessionId)
  if (!s) return '未知（日志缺失）'
  return s.live ? '进行中' : '已归档'
}

export function buildBoardTools(deps: ToolsDeps) {
  const { ctx, domain } = deps

  const boardTool = defineTool({
    name: 'board',
    description:
      '查看交接板：按线程分组的全部交接条清单（标题/日期/状态/id），时间倒序。新会话了解项目工作历史的第一入口。',
    parameters: {
      project: {
        type: 'string',
        description: '按项目名或路径关键词过滤（可选）',
      },
      limit: {
        type: 'integer',
        description: '最多返回条数，默认 20',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: asText(value) }],
    },
    execute: async (args) => {
      const limit = args.limit ?? 20
      const threads = [...domain.table('threads').entries()].map(([, r]) => r as ThreadRow)
      const notes = [...domain.table('notes').entries()].map(([, r]) => r as NoteRow)
      const sessionMap = new Map(
        (await ctx.sessionQuery.listSessions()).map((r: any) => [r.header.id, r]),
      )
      const matched = args.project
        ? threads.filter(
            (t) => t.title.includes(args.project!) || t.projectKey.includes(args.project!),
          )
        : threads
      const threadById = new Map(matched.map((t) => [t.id, t]))
      const picked = notes
        .filter((n) => threadById.has(n.threadId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)

      if (picked.length === 0) return '交接板为空：还没有任何交接条。在会话里敲 /handoff 生成第一条。'

      const out: string[] = ['# 交接板']
      for (const t of matched) {
        const tn = picked.filter((n) => n.threadId === t.id)
        if (tn.length === 0) continue
        out.push(`\n## ${t.title}（projectKey=${t.projectKey}）`)
        for (const n of tn) {
          out.push(
            `- ${new Date(n.createdAt).toISOString().slice(0, 16).replace('T', ' ')} | ${n.title} | ${statusOf(sessionMap, n.sessionId)} | 文件${n.files.length} | id=${n.id}`,
          )
        }
      }
      return out.join('\n')
    },
  })

  const readTool = defineTool({
    name: 'read_handoff',
    description: '读取一条交接条的六段全文。',
    parameters: {
      id: { type: 'string', required: true, description: '交接条 id（board 返回的 id，可只给前 8 位前缀）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: asText(value) }],
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

  const writeTool = defineTool({
    name: 'write_handoff',
    description:
      '为指定会话生成六段交接条并存入交接板。缺省总结当前会话；也可传 session_id 为其他（含暴毙的）会话补条——生成由独立工人模型完成，不依赖该会话自身可用。',
    parameters: {
      session_id: { type: 'string', description: '要总结的会话 id；缺省=当前会话' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: asText(value) }],
    },
    execute: async (args, exec) => {
      const sessionId =
        args.session_id ?? (exec as any)?.agent?.session?.id ?? undefined
      if (!sessionId) throw new Error('write_handoff: 未提供 session_id 且当前无会话上下文')
      const { note, thread } = await generateHandoff(deps, sessionId)
      return { note_id: note.id, thread_title: thread.title, title: note.title }
    },
  })

  const whoElseTool = defineTool({
    name: 'who_else',
    description:
      '撞车检查：还有哪些「活着」的其他会话最近触碰过给定文件路径？改文件前先查这个，避免与并行对话互踩。',
    parameters: {
      path: { type: 'string', required: true, description: '文件路径或其子串' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: asText(value) }],
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
        } catch { /* 单个会话读取失败不影响其余 */ }
      }
      if (hits.length === 0) return `没有其他活着的会话近期碰过 ${args.path}。放心动手。`
      hits.sort((a, b) => b.when - a.when)
      return [
        `⚠️ ${hits.length} 个活着的会话近期碰过 ${args.path}：`,
        ...hits.map(
          (h) => `- ${h.id.slice(0, 13)}… 最后触达 ${new Date(h.when).toISOString().slice(5, 16).replace('T', ' ')}`,
        ),
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
