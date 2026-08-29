# v0.0.3 接续血缘迁入账本 links 表，取材过滤插件注入

两个 2026-08-28/29 用户反馈暴露的同根问题：接续会话被当成「子代理子会话」对待。

1. **交接条循环增长**：`continueWithNote` 注入的上一条交接条全文（`source.kind=plugin` 的 user/message）被 `extractMaterial` 当成对话轮收进取材，工人再总结进新条——874 字 → 2290 字逐轮膨胀；无实际工作的接续会话也产出复读条（`7148da5c`）。
2. **会话树折叠错误**：spawn 给主会话写 `meta.parentSession`，而该字段在宿主（dsh-subagent / 官方侧边栏 / `indexSubagentDescendants`）语义里**专属于子代理血缘**（要求 `origin === 'subagent'` 才消费）。交接板自己的会话树却对一切节点按它做父子嵌套，接续出的主会话被折进原会话子树；附带伤害：session-title 只给 `parentSession === undefined` 的会话自动起标题，接续会话永远拿不到自动标题。

## 决策

- **接续血缘迁入账本**：`boardSpec` 新增 `links` 表（childSessionId / parentSessionId / noteId / createdAt），`continueWithNote` 建会话后写入；**不再写 `header.parentSession`**。读取侧（`generateHandoff` 的 note 行、`/state` 的 `parentSessionFull`）统一走 `parentOfSession`：links 优先，回退 `header.parentSession`（存量接续会话与子代理的真实血缘）。json 后端同版本加表已确认安全（descriptor 缺表初始化为空，`version-mismatch` 只在版本号变化时抛）。
- **客户端会话树只折叠子代理**：`buildTree` 仅对 `kind === 'subagent'` 的节点建立父子边；主会话（含接续会话）一律根级。接续关系只在「交接关系」画布（note chain）表达。
- **取材过滤插件注入**：`extractMaterial` 跳过 `data.source.kind === 'plugin'` 的 user/message（事件形态已从真实日志实锤：`type=user/message, surfaceOp=append, data.source={kind:'plugin',plugin:'dsh-handoff-board'}`）。注入后无真实对话的会话将正常报「没有可总结的对话内容」。
- **存量污染不动**：已落盘的接续会话头部（如 `42a60e81`）不改写——显示层已修正，血缘链靠 header 回退保持完整。

## Considered Options

- 保留 `header.parentSession` 写入、仅改客户端树（最小改动）：被否（用户裁决走账本方案）——宿主数据仍带伪造血缘，接续会话永远不自动起标题。
- 从注入消息散文里解析来源会话 id：被否——正是 ADR 前身「不靠客户端散文正则」要避免的形态。

## Consequences

- 接续出的新会话在宿主里是干净的主会话：官方侧边栏平铺显示、自动起标题（session-title 只收 `source.kind=user` 的消息，注入不会污染标题内容）。
- 接续血缘与宿主子代理血缘从此两套来源、互不干扰；`/state` 单点合并。
- 旧接续会话（header 带 parentSession 的）在树上同样不再嵌套（显示按 kind 判定），画布链路靠回退不断。
