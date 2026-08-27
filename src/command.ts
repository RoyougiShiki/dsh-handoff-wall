/**
 * /handoff 命令与生成核心。
 * 编排三段式（bridge 模式）：取材 → 一次性工人 LLM → 落库回显。
 * 命令由 host 注册表直接执行，不经模型；结果文本由 UI 直接渲染。
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { BoardDomain, NoteRow, ThreadRow } from './store.js'
import { resolveProjectKey } from './store.js'
import { buildWorkerSystem, validateSections } from './prompt.js'
import { redact } from './redact.js'

/** 取材预算：字符数（不是字节——修 WeiYe6 中文≈8千字的坑） */
export const MAX_MATERIAL_CHARS = 24_000
const WORKER_MAX_TOKENS = 3_000
/** 每轮独立超时：glm 思考型路由首轮普遍 >120s，统一短超时会整轮报废；signal 直入流真正掐断请求 */
const WORKER_TIMEOUTS_MS = [150_000, 210_000, 240_000]
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
    // 标题线索只取真正的用户轮：跳过工人取材语料这类「包装文本」，
    // 否则补写场景的标题会变成整段取材指令（真实案例）
    if (role === '用户' && !firstUserText && !/取材|以下是某个 AI 编程会话|用户消息全文/.test(text.slice(0, 60))) {
      firstUserText = text.slice(0, 80)
    }
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
        signal?: AbortSignal
      }): AsyncIterable<{ type: string; text?: string }>
    }
    agentDefaultModel: { currentSelection(): { provider: string; model: string } }
    tools?: { register(def: unknown): () => void }
  }
  domain: BoardDomain
}

/** 六段全文入库；线程按项目聚合（一个 cwd 一条线）。 */
export async function saveHandoff(
  domain: BoardDomain,
  input: { sessionId: string; parentSessionId?: string; cwd: string | undefined; title: string; body: string; files: string[] },
): Promise<{ note: NoteRow; thread: ThreadRow }> {
  const projectKey = resolveProjectKey(input.cwd)
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
      cwd: input.cwd,
    }
    await threads.put(thread.id, thread)
  }

  const note: NoteRow = {
    id: randomUUID(),
    threadId: thread.id,
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId ?? '',
    createdAt: Date.now(),
    title: input.title,
    body: input.body,
    files: input.files,
    provenance: 'curated',
  }
  await notes.put(note.id, note)
  return { note, thread }
}

/** 标题派生：去开头命令、折叠长路径为 …/末段、按长度截断。 */
function deriveTitle(firstUserText: string): string {
  let t = firstUserText.trim().replace(/^\/\S+\s*/, '')
  t = t.replace(/[\w.\-/]+\/([\w.\-]+)/g, '…/$1').replace(/\s+/g, ' ')
  if (t.length > 48) t = t.slice(0, 46) + '…'
  return t || '未命名交接条'
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

  // 工人调用：带分块统计；空文本自动翻倍 maxTokens 重试一次（推理型路由兜底）
  // 工人调用：全量分块遥测；空文本按 预算↑→指令强化→去effort参数 三段递进重试
  const runWorker = async (attempt: {
    maxTokens: number
    directive?: string
    withEffortOff?: boolean
    timeoutMs: number
  }): Promise<{ body: string; stats: string }> => {
    let text = ''
    let reasonChars = 0
    let textChunks = 0
    const chunkTypes: Record<string, number> = {}
    let firstNonText: string | undefined
    let lastFinish: string | undefined
    const timeout = AbortSignal.timeout(attempt.timeoutMs)
    const stream = deps.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: buildWorkerSystem(),
      messages: [
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: (attempt.directive ? attempt.directive + '\n\n' : '') + `会话 ${sessionId} 的材料如下：\n\n${materialRedacted}` }],
        }),
      ],
      temperature: 0,
      ...(attempt.withEffortOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
      maxTokens: attempt.maxTokens,
      // 契约：适配器必须遵守 GenerateOptions.signal——超时真正掐断请求，不放任后台烧 token
      signal: timeout,
    })
    for await (const chunk of stream) {
      if (timeout.aborted) throw new Error(`工人摘要超时（${attempt.timeoutMs / 1000}s）`)
      const t = String((chunk as any).type ?? 'unknown')
      chunkTypes[t] = (chunkTypes[t] ?? 0) + 1
      if (t === 'text-delta') {
        if ((chunk as any).text) { text += (chunk as any).text; textChunks += 1 }
      } else if (t.includes('reasoning')) {
        reasonChars += ((chunk as any).text ?? '').length
      } else {
        if (!firstNonText) firstNonText = JSON.stringify(chunk).slice(0, 300)
        if (t.startsWith('finish')) lastFinish = JSON.stringify(chunk).slice(0, 300)
      }
    }
    const hist = Object.entries(chunkTypes).map(([k, v]) => `${k}x${v}`).join(',') || '(零分块)'
    const stats = `text块=${textChunks} 正文=${text.length}字 思考=${reasonChars}字 maxTokens=${attempt.maxTokens} effortOff=${!!attempt.withEffortOff} 分块[${hist}]${firstNonText ? ` 首个非文本=${firstNonText}` : ''}${lastFinish ? ` finish=${lastFinish}` : ''}`
    return { body: text, stats }
  }

  let body = ''
  let lastStats = ''
  const attempts = [
    { maxTokens: WORKER_MAX_TOKENS, withEffortOff: true, timeoutMs: WORKER_TIMEOUTS_MS[0] },
    { maxTokens: WORKER_MAX_TOKENS * 3, withEffortOff: true, directive: '跳过一切思考/解释/前缀，直接以「## 任务目标」开头的 Markdown 正文作为全部输出。', timeoutMs: WORKER_TIMEOUTS_MS[1] },
    { maxTokens: WORKER_MAX_TOKENS * 3, withEffortOff: false, directive: '跳过一切思考/解释/前缀，直接以「## 任务目标」开头的 Markdown 正文作为全部输出。', timeoutMs: WORKER_TIMEOUTS_MS[2] },
  ]
  for (const attempt of attempts) {
    try {
      const r = await runWorker(attempt)
      lastStats = r.stats
      body = r.body.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      if (!body.trim()) continue
      const check = validateSections(body)
      if (check.ok) break
      lastStats += ` 缺段=[${check.missing.join('、')}]`
      body = ''
    } catch (e) {
      lastStats = `attempt异常: ${String(e).slice(0, 120)}`
      body = ''
    }
  }
  if (!body.trim()) {
    throw new Error(`工人三轮均未产出合格正文（${lastStats}）。建议：给该路由模型如实声明 contextWindow、或换非思考路线。`)
  }
  body = redact(body)

  if (typeof (deps.domain as any).table !== 'function') {
    throw new Error('账本已关闭（插件重载/卸载发生在生成途中）——请重试补写')
  }
  const title = deriveTitle(material.firstUserText)
  const { note, thread } = await saveHandoff(deps.domain, {
    sessionId,
    parentSessionId: (header as any).parentSession ?? '',
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
