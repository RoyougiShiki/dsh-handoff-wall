/**
 * 会话接续：从一条交接条开出新对话，六段全文作为首条注入消息。
 * 链路采纳 WeiYe6 流程并修三 bug（结构化血缘走 meta.parentSession，
 * 不靠客户端散文正则）。attachSession 失败不静默：warning 回传给调用方。
 *
 * 模式/工具：必须走与官方 session.create 相同的两步——header 写入
 * agentPreset（左上角模式名读这个字段），setup 里 agentPresets.mount
 * （bash/fs/skill/subagent 等模型工具都在 preset 组装里，不 mount 就没有）。
 * 只写 header 不 mount = 有名字没工具；只 mount 不写 header = 有工具没名字。
 * header 必须在 create 的 meta 里带上：session 边界在异步 setup 之前快照 meta，
 * setup 里才发现的 preset 写不进 header。
 */
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { BoardDomain, NoteRow } from './store.js'

type SessionHeaderLike = { cwd?: string; agentPreset?: string }
type SessionEventLike = { type?: string; data?: { agentPreset?: string } }
type SessionLogLike = { session?: SessionHeaderLike; events?: readonly SessionEventLike[] }

export interface ContinueDeps {
  ctx: {
    sessionQuery: {
      readSurface(sessionId: string): Promise<any>
      readSession?(sessionId: string): Promise<any>
    }
    agents: {
      create(options: {
        sessionId: string
        meta?: { cwd?: string; parentSession?: string; agentPreset?: string }
        setup?: (agentCtx: unknown) => void | Promise<void>
      }): Promise<{ agent: { inject(message: unknown): void }; dispose(): Promise<void> }>
    }
    workspaceRegistry: { resolveByPath(path: string): Promise<any> }
    agentPresets: {
      resolve(id?: string): Promise<{ id: string }>
      mount(agentCtx: unknown, id?: string): Promise<unknown>
    }
  }
}

export interface ContinueResult {
  newSessionId: string
  note: NoteRow
  /** 实际挂上的 preset id（header + mount 同源） */
  agentPreset?: string
  /** attachSession 失败或 preset 回退时的警告 */
  warning?: string
}

/** 解析交接条 id：支持前 8 位等前缀形式。 */
export function resolveNote(domain: BoardDomain, noteId: string): NoteRow | undefined {
  const notes = domain.table('notes')
  const exact = notes.get(noteId) as NoteRow | undefined
  if (exact) return exact
  if (noteId.length < 36) {
    const hit = [...notes.entries()].find(([k]) => k.startsWith(noteId))
    return hit?.[1] as NoteRow | undefined
  }
  return undefined
}

/** 会话实际在跑的 preset：后写的 agent-preset/selected 覆盖创建期 header。 */
export function resolveRunningPreset(log: SessionLogLike | null | undefined): string | undefined {
  const events = log?.events
  if (events) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event?.type === 'agent-preset/selected' && event.data?.agentPreset) {
        return event.data.agentPreset
      }
    }
  }
  return log?.session?.agentPreset
}

async function readSourceContext(
  ctx: ContinueDeps['ctx'],
  sessionId: string,
): Promise<{ cwd?: string; sourcePreset?: string }> {
  if (typeof ctx.sessionQuery.readSession === 'function') {
    try {
      const log = await ctx.sessionQuery.readSession(sessionId)
      return { cwd: log.session?.cwd, sourcePreset: resolveRunningPreset(log) }
    } catch {
      /* 冷读失败再退 readSurface */
    }
  }
  const surface = await ctx.sessionQuery.readSurface(sessionId).catch(() => null)
  return { cwd: surface?.session?.cwd, sourcePreset: surface?.session?.agentPreset }
}

/**
 * 解析要挂的 preset：优先继承来源会话正在跑的那个（fork 同款），
 * 没有则走用户默认 / 部署默认。来源 id 已失效时再回退默认。
 */
async function composeContinuePreset(
  presets: ContinueDeps['ctx']['agentPresets'],
  requested: string | undefined,
): Promise<{ agentPreset?: string; warning?: string; setup?: (agentCtx: unknown) => Promise<void> }> {
  const tryResolve = async (id?: string): Promise<string | undefined> => {
    try {
      return (await presets.resolve(id)).id
    } catch {
      return undefined
    }
  }

  let agentPreset = await tryResolve(requested)
  let warning: string | undefined
  if (!agentPreset && requested) {
    agentPreset = await tryResolve(undefined)
    if (agentPreset) warning = `来源会话模式「${requested}」已不可用，已回退为默认模式「${agentPreset}」`
  }
  if (!agentPreset) {
    return { warning: warning ?? '未能解析任何会话模式，新会话将没有 DSH 工具组装（请手动选模式）' }
  }
  return {
    agentPreset,
    warning,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, agentPreset)
    },
  }
}

/** 从交接条开出接续会话。返回新会话 id 与可能的警告。 */
export async function continueWithNote(
  deps: ContinueDeps,
  domain: BoardDomain,
  noteId: string,
): Promise<ContinueResult> {
  const note = resolveNote(domain, noteId)
  if (!note) throw new Error(`交接条不存在: ${noteId}`)

  const { cwd, sourcePreset } = await readSourceContext(deps.ctx, note.sessionId)
  const composition = await composeContinuePreset(deps.ctx.agentPresets, sourcePreset)

  const newSessionId = 'session-' + randomUUID()
  const handle = await deps.ctx.agents.create({
    sessionId: newSessionId,
    meta: {
      cwd,
      parentSession: note.sessionId,
      ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
    },
    ...composition.setup === undefined ? {} : { setup: composition.setup },
  })

  // 归组到工作区；失败收集为警告（宿主类型确认：不归组则输入框置灰）
  let warning = composition.warning
  try {
    if (cwd) {
      const ws = await deps.ctx.workspaceRegistry.resolveByPath(cwd).catch(() => undefined)
      if (ws) await ws.attachSession(newSessionId)
      else warning = joinWarnings(warning, `工作区注册表中未找到 ${cwd}，新会话未归组（输入框可能置灰，请手动拖入工作区）`)
    }
  } catch (e) {
    warning = joinWarnings(warning, '工作区归组失败：' + String(e).slice(0, 120) + '（请手动拖入工作区）')
  }

  // 六段全文作为首条模型可见消息（notification 注入，不自动唤醒）
  const injection = [
    `你接续自一段已完成阶段的工作。下面是交接条「${note.title}」全文——它是此前工作的权威状态索引：`,
    '',
    note.body,
    '',
    `（来源会话：${note.sessionId}）`,
    '请从「下一步与新会话先读清单」开始；若用户给出与交接冲突的新指示，以用户为准。',
  ].join('\n')

  handle.agent.inject(
    createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-handoff-board' },
      content: [{ type: 'text', text: injection }],
    }),
  )

  return { newSessionId, note, agentPreset: composition.agentPreset, warning }
}

function joinWarnings(a: string | undefined, b: string): string {
  return a ? `${a}；${b}` : b
}
