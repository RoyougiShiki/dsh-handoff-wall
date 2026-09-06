/**
 * /handoff 命令与生成核心。
 * 编排三段式（bridge 模式）：取材 → 一次性工人 LLM → 落库回显。
 * 命令由 host 注册表直接执行，不经模型；结果文本由 UI 直接渲染。
 */
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { BoardDomain, NoteRow, ThreadRow } from './store.js'
import { parentOfSession, resolveProjectKey } from './store.js'
import { buildWorkerSystem, validateSections } from './prompt.js'
import { redact } from './redact.js'

/** 取材预算：字符数（不是字节——修 WeiYe6 中文按字符计的坑） */
export const MAX_MATERIAL_CHARS = 24_000
/** 单轮正文压缩标记：保留开头+结尾，不丢整轮、不只切开头。 */
export const COMPRESS_MARK = '…(压缩，保留开头与结尾)…'
const WORKER_MAX_TOKENS = 3_000
/** 每轮独立超时：glm 思考型路由首轮普遍 >120s，统一短超时会整轮报废；signal 直入流真正掐断请求 */
const WORKER_TIMEOUTS_MS = [150_000, 210_000, 240_000]
interface MaterialResult {
  transcript: string
  files: string[]
  firstUserText: string
  compressed: boolean
}

/**
 * 取一条消息事件的正文文本。
 * 宿主日志里两种消息形状不同（实测 2026-09-03）：
 *   user/message      → data.content
 *   assistant/message → data.message.content（多一层 message）
 * 只读 data.content 会把助手轮次全部取成空串，材料从约 10 万字符塌到约 1.4 千，
 * 生成的交接条因此写不出任何「已完成/已改动」。两种形状都要认。
 */
function eventPlainText(e: any): string {
  const data = e?.data ?? {}
  const blocks: any[] =
    Array.isArray(data.content) ? data.content
    : Array.isArray(data.message?.content) ? data.message.content
    : []
  const fromBlocks = blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
  return fromBlocks || (typeof data.text === 'string' ? data.text : '')
}

/** 超长单轮：两端都留。只切开头会把后半段的「已修好」丢掉。 */
export function foldText(text: string, cap: number): string {
  if (cap <= 0) return ''
  if (text.length <= cap) return text
  if (cap <= COMPRESS_MARK.length + 16) return text.slice(0, Math.max(1, cap - 1)) + '…'
  const keep = cap - COMPRESS_MARK.length
  const head = Math.max(8, Math.floor(keep * 0.45))
  const tail = keep - head
  return text.slice(0, head) + COMPRESS_MARK + text.slice(text.length - tail)
}

function weightOf(index: number, n: number): number {
  if (index === 0) return 3
  if (index === n - 1) return 5
  if (index === n - 2) return 3
  if (index === n - 3) return 2
  return 1
}

/**
 * 限尺寸但不丢轮次：每一轮都出现在材料里。
 * 预算按权重分给「首条目标 + 最近几轮」，中间轮分得少，用开头+结尾压缩，而不是整段省略。
 */
export function packTurns(
  turns: { role: string; text: string }[],
  budget = MAX_MATERIAL_CHARS,
): { transcript: string; compressed: boolean } {
  if (turns.length === 0) return { transcript: '', compressed: false }
  const sep = '\n\n'
  const prefix = (role: string) => `[${role}] `
  const n = turns.length
  const fixed = turns.reduce((sum, t, i) => sum + prefix(t.role).length + (i > 0 ? sep.length : 0), 0)
  let available = budget - fixed
  if (available < n * 48) available = n * 48

  const weights = turns.map((_, i) => weightOf(i, n))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const fairs = turns.map((_, i) => Math.max(48, Math.floor(available * (weights[i]! / weightSum))))
  const caps = turns.map((t, i) => Math.min(t.text.length, fairs[i]!))
  // 把「正文比配额短」省下的额度补给还被压着的轮次（从最近一轮往前）
  let spare = 0
  for (let i = 0; i < n; i++) spare += fairs[i]! - caps[i]!
  for (let i = n - 1; i >= 0 && spare > 0; i--) {
    const need = turns[i]!.text.length - caps[i]!
    if (need <= 0) continue
    const give = Math.min(need, spare)
    caps[i] = caps[i]! + give
    spare -= give
  }

  let compressed = false
  const lines = turns.map((t, i) => {
    const folded = foldText(t.text, caps[i]!)
    if (folded.length < t.text.length) compressed = true
    return prefix(t.role) + folded
  })
  return { transcript: lines.join(sep), compressed }
}

/** 从 surface 事件里防御性提取对话文本与文件路径线索。 */
export function extractMaterial(events: any[]): MaterialResult {
  const files = new Set<string>()
  let firstUserText = ''
  const turns: { role: string; text: string }[] = []

  for (const e of events) {
    const type = e?.type ?? ''
    if (type !== 'user/message' && type !== 'assistant/message') continue
    // 插件注入消息（接续全文/通知）不是人类对话：混进取材会让交接条逐轮复读膨胀
    // （2026-08-28 事故：接续注入的上一条全文被工人再总结进新条，874字→2290字循环增长）
    if (e?.data?.source?.kind === 'plugin') continue
    const text = eventPlainText(e)
    if (!text.trim()) continue

    for (const m of text.matchAll(/[\w./-]+\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs|md|json|ya?ml|toml|py|cs|cpp|h|rs|go|sh)/g)) {
      if (files.size < 30) files.add(m[0])
    }

    const role = type === 'user/message' ? '用户' : '助手'
    turns.push({ role, text })
    if (role === '用户' && !firstUserText && !/取材|以下是某个 AI 编程会话|用户消息全文/.test(text.slice(0, 60))) {
      firstUserText = text.slice(0, 80)
    }
  }
  const packed = packTurns(turns)
  return { transcript: packed.transcript, files: [...files], firstUserText, compressed: packed.compressed }
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
  const existing = [...notes.entries()].find(([, r]) => {
    const row = r as NoteRow
    return row.sessionId === input.sessionId && row.provenance === 'curated'
  })
  const note: NoteRow = existing
    ? {
        ...(existing[1] as NoteRow),
        threadId: thread.id,
        parentSessionId: input.parentSessionId ?? (existing[1] as NoteRow).parentSessionId,
        createdAt: Date.now(),
        title: input.title,
        body: input.body,
        files: input.files,
      }
    : {
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
  const events = surface?.events ?? []
  const material = extractMaterial(events)
  // 取材遥测：此前这段链路零日志，生成失败后完全不可查
  console.info('[hb-handoff] 取材:', sessionId.slice(0, 14),
    '事件=' + events.length,
    '正文=' + material.transcript.length + '字',
    '压缩=' + material.compressed,
    '文件=' + material.files.length)
  if (!material.transcript) {
    console.info('[hb-handoff] 取材为空，放弃生成:', sessionId.slice(0, 14))
    throw new Error('该会话没有可总结的对话内容')
  }

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
    let finishError: string | undefined
    const timeout = AbortSignal.timeout(attempt.timeoutMs)
    const stream = deps.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system: buildWorkerSystem(),
      messages: [
        createUserMessage({
          source: { kind: 'user' },
          content: [{ type: 'text', text: (attempt.directive ? attempt.directive + '\n\n' : '') + (material.compressed ? '材料中部分长轮次做了「开头+结尾」压缩，中间未删除、时间顺序完整。开放问题以末尾仍成立的事实为准。\n\n' : '') + `会话 ${sessionId} 的材料如下：\n\n${materialRedacted}` }],
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
        if (t.startsWith('finish')) {
          lastFinish = JSON.stringify(chunk).slice(0, 300)
          const failure = (chunk as any)?.reason?.failure
          if (failure?.code) finishError = `${failure.code}: ${String(failure.message ?? '').slice(0, 200)}`
        }
      }
    }
    // 上游 finish 错误不是模型正文。不抛出来就会落到「空正文 → 换下一轮」，
    // 最后报成「工人未产出合格正文」，指不到真因（实测 UNSUPPORTED_REASONING_EFFORT
    // 与 TRANSPORT/业务错误都属于此类）。
    if (finishError) {
      throw new Error(`上游返回错误（${finishError}）`)
    }
    const hist = Object.entries(chunkTypes).map(([k, v]) => `${k}x${v}`).join(',') || '(零分块)'
    const stats = `text块=${textChunks} 正文=${text.length}字 思考=${reasonChars}字 maxTokens=${attempt.maxTokens} effortOff=${!!attempt.withEffortOff} 分块[${hist}]${firstNonText ? ` 首个非文本=${firstNonText}` : ''}${lastFinish ? ` finish=${lastFinish}` : ''}`
    return { body: text, stats }
  }

  const startedAt = Date.now()
  let body = ''
  let lastStats = ''
  // 档位与 token 预算保持上游原样，插件不替用户决定推理强度。
  const attempts = [
    { maxTokens: WORKER_MAX_TOKENS, withEffortOff: true, timeoutMs: WORKER_TIMEOUTS_MS[0] },
    { maxTokens: WORKER_MAX_TOKENS * 3, withEffortOff: true, directive: '跳过一切思考/解释/前缀，直接以「## 任务目标」开头的 Markdown 正文作为全部输出。', timeoutMs: WORKER_TIMEOUTS_MS[1] },
    { maxTokens: WORKER_MAX_TOKENS * 3, withEffortOff: false, directive: '跳过一切思考/解释/前缀，直接以「## 任务目标」开头的 Markdown 正文作为全部输出。', timeoutMs: WORKER_TIMEOUTS_MS[2] },
  ]
  console.info('[hb-handoff] 工人开工:', sessionId.slice(0, 14),
    '路由=' + route.provider + '/' + route.model,
    '轮数=' + attempts.length,
    '每轮超时=' + WORKER_TIMEOUTS_MS.join('/') + 's')

  /**
   * 墙钟兜底：runWorker 里的 AbortSignal.timeout 只在 for-await 循环体内检查，
   * 一旦模型流一块都不发、适配器也不因 abort 抛错，runWorker 就永久挂住
   * （用户观感＝点了没反应、永远不报错）。这里用 race 强制推进：超时即判本轮失败。
   */
  const runWorkerGuarded = async (
    attempt: { maxTokens: number; directive?: string; withEffortOff?: boolean; timeoutMs: number },
  ): Promise<{ body: string; stats: string }> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`墙钟超时（${attempt.timeoutMs / 1000}s）：适配器未响应 abort，本轮判失败`)),
        attempt.timeoutMs + 5_000,
      )
    })
    try {
      return await Promise.race([runWorker(attempt), guard])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * 供应商处理超时回执不是模型正文（实测 a61：「[req_xxx] **Request exceeded
   * 296s limit:** Your prompt took too long…」）。不识别就会拿它去验六段，
   * 最后报成「工人未产出合格正文」，完全指不到真因。
   */
  const isProviderLimitText = (t: string): boolean =>
    /Request exceeded \d+s limit|Your prompt took too long/i.test(t)

  let round = 0
  let effortUnsupported = false
  let providerLimitHit = false
  let upstreamError = false
  const allStats: string[] = []

  const runRound = async (attempt: {
    maxTokens: number
    directive?: string
    withEffortOff?: boolean
    timeoutMs: number
  }): Promise<void> => {
    round += 1
    const idx = round
    if (effortUnsupported && attempt.withEffortOff) {
      console.info(`[hb-handoff] 跳过第${idx}轮（该模型不支持 reasoningEffort=off）`)
      return
    }
    const t0 = Date.now()
    const cost = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
    try {
      const r = await runWorkerGuarded(attempt)
      lastStats = r.stats
      allStats.push(`#${idx}(${cost()}) ${r.stats}`)
      body = r.body.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      if (!body.trim()) {
        console.info(`[hb-handoff] 第${idx}轮空正文:`, sessionId.slice(0, 14), cost(), r.stats)
        return
      }
      if (isProviderLimitText(body)) {
        providerLimitHit = true
        const why = body.slice(0, 200).replace(/\s+/g, ' ')
        console.info(`[hb-handoff] 第${idx}轮命中供应商处理上限:`, sessionId.slice(0, 14), why)
        allStats.push(`#${idx} 供应商上限回执=[${why}]`)
        body = ''
        return
      }
      const check = validateSections(body)
      if (check.ok) {
        console.info(`[hb-handoff] 第${idx}轮合格:`, sessionId.slice(0, 14), cost(), '正文=' + body.length + '字')
        return
      }
      lastStats += ` 缺段=[${check.missing.join('、')}]`
      const headings = (body.match(/^\s*#{1,6}\s*.+$/gm) ?? []).map((x) => x.trim()).slice(0, 14).join(' / ')
      allStats.push(`#${idx} 缺段=[${check.missing.join('、')}] 实际标题=[${headings || '(无标题)'}] 正文开头=[${body.slice(0, 200).replace(/\s+/g, ' ')}]`)
      console.info(`[hb-handoff] 第${idx}轮实际标题:`, sessionId.slice(0, 14), headings || '(无标题)')
      console.info(`[hb-handoff] 第${idx}轮正文开头:`, sessionId.slice(0, 14), body.slice(0, 300).replace(/\s+/g, ' '))
      body = ''
    } catch (e) {
      const msg = String(e)
      if (msg.includes('上游返回错误')) upstreamError = true
      if (msg.includes('UNSUPPORTED_REASONING_EFFORT')) effortUnsupported = true
      lastStats = `attempt异常: ${msg.slice(0, 120)}`
      allStats.push(`#${idx}(${cost()}) 异常: ${msg.slice(0, 200)}`)
      console.info(`[hb-handoff] 第${idx}轮异常:`, sessionId.slice(0, 14), cost(), msg.slice(0, 160))
      body = ''
    }
  }

  for (const attempt of attempts) {
    await runRound(attempt)
    if (body.trim()) break
    // 同尺寸材料再试也是同一个结局，立刻停手，别白烧时间和 token
    if (providerLimitHit) {
      console.info('[hb-handoff] 命中供应商处理上限，提前终止重试')
      break
    }
  }

  if (!body.trim()) {
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1)
    // 全轮遥测都要带出来：只报最后一轮会把真正的原因盖掉
    const detail = allStats.length ? allStats.join(' | ') : lastStats
    console.info('[hb-handoff] 生成失败:', sessionId.slice(0, 14), '耗时=' + cost + 's', detail)
    const tag = upstreamError ? '【上游返回错误】'
      : providerLimitHit ? '【上游限流·材料过大】'
      : effortUnsupported ? '【模型参数不兼容】'
      : '【工人未产出合格正文】'
    const advice = upstreamError
      ? '模型供应商返回了业务错误（商家不可用 / 能力不匹配 / 限流 / 连接失败），与会话内容和插件无关。处置：在模型市场切换到可用的商家，或开启智能路由/兜底后重试。'
      : providerLimitHit
        ? '上游供应商对该请求有处理时长上限，本会话材料过大导致思考过程跑不完。处置：给该模型配置更低的推理档位、换更轻量的模型，或缩短取材范围。'
        : effortUnsupported
          ? '当前模型不接受 reasoningEffort=off（该档位未在该模型的 reasoningEfforts 中声明），已自动跳过带该参数的轮次。'
          : '可能是模型输出不合六段格式，或 token 预算不足。'
    throw new Error(`${tag} 耗时 ${cost}s。${advice}\n各轮遥测：${detail.slice(0, 700)}\n完整日志：journalctl --user -u dsh-web | grep hb-handoff`)
  }
  body = redact(body)

  if (typeof (deps.domain as any).table !== 'function') {
    throw new Error('账本已关闭（插件重载/卸载发生在生成途中）——请重试补写')
  }
  const title = deriveTitle(material.firstUserText)
  const { note, thread } = await saveHandoff(deps.domain, {
    sessionId,
    parentSessionId: parentOfSession(deps.domain, sessionId, (header as any).parentSession),
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
