# 地图：交接条插件 v0

Labels: wayfinder:map

## Destination

一个装进 DSH、日常可用的 v0.1 插件：「换班写张交接条」完整闭环跑通——任何会话（善终或暴毙）经命令 / 画布按钮 / AI 工具生成六段交接条并存入极简线程库；新对话经 brief 或注入接上上下文；人有一面按时间排队的时间线墙（列表先行、画布随后），AI 有 board / read_handoff / write_handoff / who_else 四件套。MVP 先跑通全链路看完整效果，细节与美化是之后的路。

## Notes

- **领域**：DSH cordis 插件（host 半部 + client bundle），运行于本机 ~/.dsh。
- **参考件分工**（侦察已完成，详见两票决策）：
  - bridge → 命令注册骨架、apiProxy ROUTES、一次性工人三段式（取材→工人→落库）
  - WeiYe6 版 → llm.stream 辅助调用封装、会话接续完整链（须修它三个 bug：timeoutMs 未接 AbortSignal、字节当字符、客户端散文正则抠 id）
  - talkmap → 画布 / SSE / store 五表骨架 / SpawnPreview 面板（拔除 digest 管线与 spawn 注入链；入口改走 betterSidebar.registerTab）
  - FleetingEcho → 只抄三样：项目 slug 键控、13 条脱敏正则、七段模板作对照
- **宿主 API 已确认齐备**：读 = ctx.sessionQuery（readSurface 窗口上限 50 条，长会话用 readSession 全量）；写 = ctx.storageDomain（json 后端 ~/.dsh/storages，zod 表定义，caller 在 ctx.effect 里 close）；交互 = commands.register + agents.create/inject（消息需 source:{kind:'plugin'}）+ workspaceRegistry.attachSession；辅助摘要 = llm.stream（provider/model 必填，purpose 是封闭枚举须留空，路由用 agentDefaultModel.currentSelection()）。
- **既定架构**（绘图前与用户长谈敲定，视为此图的既定上下文）：L2-only，无采集器无 fold；三入口一引擎一存储；同一数据两张皮（人看图形 / AI 吃结构化文本）；灰节点 = 按需回填的低置信补漏；doc-atlas 三档渐进握手（第〇档零代码：把交接条目录配成它的知识面）。
- **硬约束**：本地 git 不推远端；最大化复用现有代码；与用户交流用中文大白话；密钥类内容不落库（脱敏归模板票管）。
- **技能**：决策票一律用 /grilling + /domain-modeling。

## Decisions so far

- [参考件侦察](issues/09-donor-repos-recon.md) — 四个插件的保留/拔除/改造清单与必避的坑已盘点完毕
- [DSH 宿主服务面调研](issues/10-dsh-host-api-recon.md) — 最小 API 集全部可行，无缺项；仅两个配套注入需补
- [命名与定位](issues/01-name-and-position.md) — 定名 dsh-handoff-board；定位采用技术版一句话
- [生命周期](issues/02-lifecycle-states.md) — 不自建状态，直接同步 DSH 会话归档标记；归档按钮删除
- [存储位置](issues/03-store-location-keying.md) — 全进 storageDomain 单库、正文入表；md 文件夹方案放弃
- [模板与脱敏](issues/05-template-and-redaction.md) — 六段合并版定稿；13 条脱敏正则三时机执行
- [回填时机](issues/07-backfill-interaction.md) — v0.1 不做，进雾区（纯墙面装饰）

## Not yet specified

- doc-atlas 握手改道：存储全在官方账本后无目录可扫，日后需要时走「导出 md 目录」命令再配知识面
- 画布自动布局算法细节（线程分行、时间轴刻度、缩放）
- 入仓归档「毕业」机制（活跃层留 home、毕业快照选择性入仓——位置是变量）
- 多项目聚合总览视图
- 细节与美化：空状态、错误态、快捷键、动画
- 打包与本地分发形态（dev_install/link 之外的正式安装方式）

- 灰卡回填（v0.2 候选）：机械占位卡补时间断层，纯墙面装饰

## Out of scope

- L1 自动沉淀采集器与 fold 引擎（已论证删除：DSH 日志本身就是真相层，不抄第二遍）
- GitHub 发布（用户明示本地即可）
- 跨 harness 格式兼容（pi-handoff 字节级互通）
- AI 全自动判定边界并自行发起交接（mattpocock 教训：边界由人定）
