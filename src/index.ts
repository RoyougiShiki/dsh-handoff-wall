/**
 * @dsh-external/dsh-handoff-board — host 入口。
 *
 * 「交接条」机制（wayfinder 地图 .scratch/v0/map.md）：
 * 换班时 /handoff 生成六段交接条 → 全量存入 storageDomain 单账本 →
 * 新对话经 AI 工具或画布消费。无采集器、无自动流水账（票03/07）。
 */
import type { Context } from 'cordis'
import { openBoard, type BoardDomain } from './store.js'
import { createHandoffCommand } from './command.js'
import { registerBoardTools } from './tools.js'
import { mountBoardRoutes } from './routes.js'

export const name = 'dsh-handoff-board'

/**
 * 服务依赖：storageDomain 必须先于本插件挂载（inject 保证次序）。
 * agents/workspaceRegistry 留给 M2 会话接续功能再加，最小化 M1 失败面。
 */
export const inject = ['storageDomain', 'commands', 'sessionQuery', 'llm', 'agentDefaultModel', 'tools', 'agents', 'workspaceRegistry', 'webServer']

type HandoffContext = Context & {
  storageDomain: { open(spec: unknown): Promise<unknown> }
  commands: { register(def: unknown): () => void }
  sessionQuery: { readSurface(id: string): Promise<unknown>; listSessions(signal?: AbortSignal): Promise<unknown[]> }
  llm: Parameters<typeof createHandoffCommand>[0]['ctx']['llm']
  agentDefaultModel: { currentSelection(): { provider: string; model: string } }
  tools: { register(def: unknown): () => void }
  agents: { create(options: unknown): Promise<unknown> }
  workspaceRegistry: { resolveByPath(path: string): Promise<unknown> }
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => unknown }): () => void }
}

export async function apply(ctx: HandoffContext): Promise<void> {
  const domain: BoardDomain = await openBoard(ctx)

  // 存储域生命周期归 caller（票10 调研结论）：fiber 卸载时关闭
  ctx.effect(() => () => void domain.close())

  // /handoff 命令注册；register 返回反注册函数，交给 fiber 管理
  ctx.effect(() =>
    ctx.commands.register(
      createHandoffCommand({
        ctx: {
          sessionQuery: ctx.sessionQuery as never,
          llm: ctx.llm,
          agentDefaultModel: ctx.agentDefaultModel,
        },
        domain,
      }),
    ),
  )

  // AI 四件套（M2）：board / read_handoff / write_handoff / who_else
  ctx.effect(() =>
    registerBoardTools({
      ctx: {
        sessionQuery: ctx.sessionQuery as never,
        llm: ctx.llm,
        agentDefaultModel: ctx.agentDefaultModel,
      },
      domain,
    }),
  )

  // M3：client 列表视图的数据与动作面
  ctx.effect(() => mountBoardRoutes(ctx, domain))

  ctx.logger?.info?.('[dsh-handoff-board] 交接板就绪：/handoff 已注册，账本 handoff_board 已打开，四工具已上线，路由 /handoff-board/* 已挂载')
}
