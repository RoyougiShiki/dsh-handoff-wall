/**
 * 交接条存储域：threads（线程）+ notes（交接条）两张表。
 *
 * 决策依据（wayfinder 票03/04）：
 * - 全进 ctx.storageDomain 单库（json 后端 ~/.dsh/storages/handoff_board.json，原子重写）
 * - 不存 lifecycle 字段：显示态由 sessionQuery 的 live/persisted 实时映射
 * - projectKey 移植 FleetingEcho pathSlug 键控
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
// 注意：@deepseek-ai/schemastery 是宿主 vendor 的 fork，storageDomain 用它做记录校验，
// 必须与其同实例（build.sh 已做 npm 模式链接）。官方包均为 default 导入。
import { z } from 'zod'

export interface ThreadRow {
  id: string
  title: string
  projectKey: string
  createdAt: number
  /** 来源会话 cwd（用于按工作区过滤） */
  cwd?: string
}

export interface NoteRow {
  id: string
  threadId: string
  /** 被总结的会话 */
  sessionId: string
  /** 接续来源会话；空串=线程首条 */
  parentSessionId: string
  createdAt: number
  title: string
  /** 六段 md 全文 */
  body: string
  files: string[]
  /** curated=正式交接；raw 预留给回填占位卡（v0.2） */
  provenance: 'curated' | 'raw'
}

/** FleetingEcho pathSlug：非法字符折叠为 `-`，超长取尾部+hash 防碰撞 */
export function pathSlug(abs: string): string {
  let s = abs.replace(/[^A-Za-z0-9._-]+/g, '-')
  s = s.replace(/^-+|-+$/g, '') || 'default'
  if (s.length > 200) s = s.slice(-199) + '-' + hash8(abs)
  return s
}

export function resolveProjectKey(cwd?: string): string {
  if (!cwd) return 'default'
  let dir = cwd
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return pathSlug(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return pathSlug(cwd)
}

export function hash8(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectKey: z.string(),
  createdAt: z.number(),
  cwd: z.string().optional(),
})

const noteSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  sessionId: z.string(),
  parentSessionId: z.string(),
  createdAt: z.number(),
  title: z.string(),
  body: z.string(),
  files: z.array(z.string()),
  provenance: z.enum(['curated', 'raw']),
})

export const boardSpec = defineDomain({
  name: 'handoff_board',
  version: 1,
  tables: {
    threads: domainTable(threadSchema),
    notes: domainTable(noteSchema),
  },
})

export type BoardDomain = Domain<typeof boardSpec>

/** 打开存储域。调用方负责在 ctx.effect 里 close。 */
export async function openBoard(ctx: {
  storageDomain: { open(spec: unknown): Promise<unknown> }
}): Promise<BoardDomain> {
  return ctx.storageDomain.open(boardSpec) as Promise<BoardDomain>
}
