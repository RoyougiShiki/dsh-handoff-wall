/**
 * /handoff 命令与生成核心。
 * 编排三段式（bridge 模式）：取材 → 一次性工人 LLM → 落库回显。
 * 命令由 host 注册表直接执行，不经模型；结果文本由 UI 直接渲染。
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { BoardDomain, NoteRow, ThreadRow } from './store.js'
import { pathSlug } from './store.js'
import { buildWorkerSystem, validateSections } from './prompt.js'
import { redact } from './redact.js'

/** 取材预算：字符数（不是字节——修 WeiYe6 中文≈8千字的坑） */
export const MAX_MATERIAL_CHARS = 24_000
const WORKER_MAX_TOKENS = 3_000
const WORKER_TIMEOUT_MS = 120_000

interface MaterialResult {
  transcript: string
  files: string[]
  firstUserText: string
}

/** 从 surface 事件里防御性提取对话文本与文件路径线索。 */
export function extractMaterial(events: any[]): MaterialResult {
  const lines: string[] = []
  const files = new Set<string>()
  let firstUserText = ''
  let budget = MAX_MATERIAL_CHARS

  for (const e of events) {
    if (budget <= 0) break
    const type = e?.type ?? ''
    if (type !== 'user/message' && type !== 'assistant/message') continue
    const data = e.data ?? {}
    const blocks: any[] = Array.isArray(data.content) ? data.content : []
    const text = blocks
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
      || (typeof data.text === 'string' ? data.text : '')
    if (!text.trim()) continue

    for (const m of text.matchAll(/[\w./-]+\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|md|json|ya?ml|toml|py|cs|cpp|h|rs|go|sh)/g)) {
      if (files.size < 30) files.add(m[0])
    }

    const role = type === 'user/message' ? '用户' : '助手'
    const clipped = text.length > 2_000 ? text.slice(0, 2_000) + '…(截断)' : text
    const line = `[${role}] ${clipped}`
    if (line.length > budget) {
      lines.push(line.slice(0, budget) + '…(预算截断)')
      budget = 0
    } else {
      lines.push(line)
      budget -= line.length
    }
    if (!firstUserText && role === '用户') firstUserText = text.slice(0, 80)
  }
  return { transcript: lines.join('\n\n'), files: [...files], firstUserText }
}

export interface HandoffDeps {
  ctx: {
    sessionQuery: { readSurface(sessionId: string): Promise<any>; listSessions(signal?: AbortSignal): Promise<any[]> }
    llm: {
      stream(options: {
        provider: string
        model: string
        system?: string
        messages: unknown[]
        temperature?: number
        reasoningEffort?: unknown
        maxTokens?: number
      }): AsyncIterable<{ type: string; text?: string }>
    }
    agentDefaultModel: { currentSelection(): { provider: string; model: string } }
    tools: { register(def: unknown): () => void }
  }
  domain: BoardDomain
}

/** 六段全文入库；线程按项目聚合（一个 cwd 一条线）。 */
export async function saveHandoff(
  domain: BoardDomain,
  input: { sessionId: string; cwd: string | undefined; title: string; body: string; files: string[] },
): Promise<{ note: NoteRow; thread: ThreadRow }> {
  const projectKey = input.cwd ? pathSlug(input.cwd) : 'default'
  const threads = domain.table('threads')
  const notes = domain.table('notes')

  const found = [...threads.entries()].find(([, r]) => r.projectKey === projectKey)
  let thread = found?.[1] as ThreadRow | undefined
  if (!thread) {
    thread = {
      id: randomUUID(),
      title: input.cwd ? basename(input.cwd) : '未命名项目',
      projectKey,
      createdAt: Date.now(),
    }
    await threads.put(thread.id, thread)
  }

  const note: NoteRow = {
    id: randomUUID(),
    threadId: thread.id,
    sessionId: input.sessionId,
    parentSessionId: '',
    createdAt: Date.now(),
    title: input.title,
    body: input.body,
    files: input.files,
    provenance: 'curated',
  }
  await notes.put(note.id, note)
  return { note, thread }
}

/** 生成核心：命令与 write_handoff 工具共用同一引擎（三入口一引擎）。 */
export async function generateHandoff(
  deps: HandoffDeps,
  sessionId: string,
): Promise<{ body: string; title: string; note: NoteRow; thread: ThreadRow }> {
  const surface = await deps.ctx.sessionQuery.readSurface(sessionId)
  const header = surface?.session ?? {}
  const material = extractMaterial(surface?.events ?? [])
  if (!material.transcript) throw new Error('该会话没有可总结的对话内容')

  const route = deps.ctx.agentDefaultModel.currentSelection()
  const materialRedacted = redact(material.transcript)
  let body = ''
  const stream = deps.ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: buildWorkerSystem(),
    messages: [
      createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: `会话 ${sessionId} 的材料如下：\n\n${materialRedacted}` }],
      }),
    ],
    temperature: 0,
    reasoningEffort: ReasoningEffortId('off'),
    maxTokens: WORKER_MAX_TOKENS,
  })
  const timeout = AbortSignal.timeout(WORKER_TIMEOUT_MS)
  for await (const chunk of stream) {
    if (timeout.aborted) throw new Error('工人摘要超时（120s）')
    if (chunk.type === 'text-delta' && chunk.text) body += chunk.text
  }

  const check = validateSections(body)
  if (!check.ok) {
    throw new Error(`工人输出缺少段落：${check.missing.join('、')}——已放弃入库，可重试`)
  }
  body = redact(body)

  const title = (material.firstUserText || header.cwd || sessionId).replace(/\s+/g, ' ').slice(0, 60)
  const { note, thread } = await saveHandoff(deps.domain, {
    sessionId,
    cwd: header.cwd,
    title,
    body,
    files: material.files,
  })
  return { body, title, note, thread }
}

/** 组装 /handoff 命令定义（host 注册表直执行，不经模型）。 */
export function createHandoffCommand(deps: HandoffDeps): Record<string, unknown> {
  return {
    name: 'handoff',
    description: '为当前会话生成六段交接条并存入交接板',
    handler: async (invocation: any): Promise<{ kind: 'success' | 'error'; text?: string }> => {
      try {
        const sessionId: string | undefined =
          invocation?.agent?.session?.id ?? invocation?.agent?.sessionId
        if (!sessionId) return { kind: 'error', text: 'handoff: 当前上下文没有活动会话' }

        const { body, note, thread } = await generateHandoff(deps, sessionId)
        return {
          kind: 'success',
          text: `${body}\n\n---\n✅ 已存入交接板：${thread.title} / ${note.title}（${note.id.slice(0, 8)}）`,
        }
      } catch (e) {
        return { kind: 'error', text: 'handoff 失败: ' + String(e).slice(0, 200) }
      }
    },
  }
}
