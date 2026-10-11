# 只做换班交接，不做自动沉淀采集器

## 状态

已采纳并已实施（Accepted, implemented）——依据：src/ 全仓无 `ctx.interval`、无 `session/*`／`agent/*` 事件订阅、无后台写入（grep 零命中），`src/index.ts` 的 `inject` 数组只有服务依赖不含定时器；历史消费走 `ctx.sessionQuery.readSurface/load` 现场读取；写入只发生在换班边界（`src/command.ts` 的 `saveHandoff`、`src/spawn.ts` 写 links）；本件 Consequences 设想的断层占位卡在界面侧已存在（`src/client/index.ts` 的 `note|ph|ext` 三类节点）。张力待用户拍板：ADR-0009 拟新增 `ctx.interval` 定时对账器（尚未落地），并在其 Consequences 里自记「ADR-0001 需要一条修订说明，把『定时对账』与『滚动采集器』区分开——待补」，该修订至今未补；ADR-0005 与 ADR-0008 都写作「不构成对本件的违反」而非推翻，故本件仍是唯一在位的边界决策。

DSH 本身把每个会话全量 append-only 落盘——原始事实层已经存在，任何"后台逐轮抄写对话"的采集器都只是在复制真相。我们曾计划过自动沉淀＋折叠引擎（FleetingEcho 式 L1 层），最终整体砍掉。

决定：插件零后台进程、零预生成流水账。历史消费一律现场读取会话日志（zstd 多帧解码已验证）＋按需 JIT 摘要缓存；唯一写入发生在换班边界的交接条。

## Consequences

- 废弃且无人交接的会话在墙上留断层（v0.2 可用占位卡回填补洞）
- brief 类查询每次现场机械提取（零 LLM 成本，但依赖日志可读性）
- 不需要防堆积的 fold/修剪/review 机器——那一整类屎山风险被删除而非被治理

前代证据：talkmap 因给活跃会话滚动烧 LLM 摘要而被弃用；"自动总结一切"的两个失败模式（成本爆炸 / 产出水话）均已被此决策规避。
