# 生命周期直接同步 DSH 会话归档态，不自建字段

## 状态

已采纳并已实施（Accepted, implemented）——依据：显示态渲染时实时取宿主标记（`src/routes.ts` 的 `statusOf` 与 `src/tools.ts` 的 `infoOf` 都是 `s.live ? '进行中' : '已归档'`，后者注释还写明「零额外请求：listSessions 一次带 header.origin」），`src/store.ts` 的 ThreadRow/NoteRow/LinkRow 里没有任何 lifecycle 字段，界面无归档按钮；本件「实现期必须验证」的归档后可读性已落实——`src/routes.ts` 给磁盘无日志的会话打 `missing` 并隐藏，客户端 `src/client/index.ts` 对「打开原对话」给「原会话已不存在（日志已被清理）」降级提示；ADR-0009 的背景清单把它列为「已有（ADR-0003 实时同步宿主 live/persisted）」，其决策第 3 条进一步确认「会话只有 live/persisted 维度，归档是另一维度」，无反转记录。

交接条挂在某个会话上，它的"进行中/已归档"显示态在渲染时实时取自宿主的 live/persisted 标记——不在 notes 表里存任何 lifecycle 字段，也不提供归档按钮。

理由：用户已在 DSH 里管理会话生死（归档是既有操作），再造一套平行的手动归档等于两处记账必然漂移。单一事实来源、零维护。原三按钮方案因此缩成两个半：打开 / 开新对话 / 补写交接。

## Consequences

- 归档语义完全继承宿主，无法单独"归档条但保留活跃会话"（评估为伪需求）
- 实现期必须验证：归档后的会话经 sessionQuery/readSession 是否仍可读；若不可读，旧条的 detail 视图降级提示
- 若未来确需手动覆盖（如钉住某条），schema 加一个可空覆盖字段即可原地升级
