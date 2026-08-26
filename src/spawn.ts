/**
 * 会话接续：从一条交接条开出新对话，六段全文作为首条注入消息。
 * 链路采纳 WeiYe6 流程并修三 bug（结构化血缘走 meta.parentSession，
 * 不靠客户端散文正则）。attachSession 失败不静默：warning 回传给调用方。
 */
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { BoardDomain, NoteRow } from './store.js'

export interface ContinueDeps {
  ctx: {
    sessionQuery: { readSurface(sessionId: string): Promise<any> }
    agents: {
      create(options: {
        sessionId: string
        meta?: { cwd?: string; parentSession?: string; agentPreset?: string }
      }): Promise<{ agent: { inject(message: unknown): void }; dispose(): Promise<void> }>
    }
    workspaceRegistry: { resolveByPath(path: string): Promise<any> }
  }
}

export interface ContinueResult {
  newSessionId: string
  note: NoteRow
  /** attachSession 失败时的警告（输入框可能置灰，需手动把会话拖入工作区） */
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

/** 从交接条开出接续会话。返回新会话 id 与可能的警告。 */
export async function continueWithNote(
  deps: ContinueDeps,
  domain: BoardDomain,
  noteId: string,
): Promise<ContinueResult> {
  const note = resolveNote(domain, noteId)
  if (!note) throw new Error(`交接条不存在: ${noteId}`)

  // 来源会话 cwd → 新会话落同一工作区
  const srcSurface = await deps.ctx.sessionQuery.readSurface(note.sessionId).catch(() => null)
  const cwd: string | undefined = srcSurface?.session?.cwd

  const newSessionId = 'session-' + randomUUID()
  const handle = await deps.ctx.agents.create({
    sessionId: newSessionId,
    meta: { cwd, parentSession: note.sessionId },
  })

  // 归组到工作区；失败收集为警告（宿主类型确认：不归组则输入框置灰）
  let warning: string | undefined
  try {
    if (cwd) {
      const ws = await deps.ctx.workspaceRegistry.resolveByPath(cwd).catch(() => undefined)
      if (ws) await ws.attachSession(newSessionId)
      else warning = `工作区注册表中未找到 ${cwd}，新会话未归组（输入框可能置灰，请手动拖入工作区）`
    }
  } catch (e) {
    warning = '工作区归组失败：' + String(e).slice(0, 120) + '（请手动拖入工作区）'
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

  return { newSessionId, note, warning }
}
