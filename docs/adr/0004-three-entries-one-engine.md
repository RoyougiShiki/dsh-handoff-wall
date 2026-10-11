# 三入口共用一个生成引擎与一本账本

## 状态

已采纳并已实施（Accepted, implemented）——依据：三个入口都调同一个引擎 `generateHandoff`（定义在 `src/command.ts`）——斜杠命令 `/handoff`（`src/command.ts` 的命令定义里调用，`src/index.ts` 经 `ctx.commands.register` 注册）、界面动作（`src/routes.ts` 的 `/handoff-board/generate`，供「补写交接条／重新生成」按钮用）、AI 工具 `write_handoff`（`src/tools.ts`）；三者同走 `src/command.ts` 的 `saveHandoff` 写同一 storageDomain 账本，产物无来源特判。措辞过时但不影响结论：本件说的「画布/列表按钮」里列表模式已废弃（`.scratch/v0/spec.md` §5.5 记「单视图……列表模式均已废弃」），界面入口现为画布与详情栏按钮。ADR-0009 决策第 7 条明确「`board`/`read_handoff`/`write_handoff`/`who_else` 四工具……全部不改」，属沿用。

斜杠命令 `/handoff`、画布/列表按钮、AI 工具 `write_handoff` 是三个入口，但它们调用同一个 `generateHandoff()` 核心、写同一个 storageDomain 账本、产出同构的六段交接条。

理由：入口可以有多个（人在对话里、人在墙上、AI 在干活中），但产物必须无法区分来源——否则视图与工具要对每种入口做特判，行为也不可预测。这是对 WeiYe6（只有命令口）与 bridge（只服务跨 preset 迁移）的结构性改进，也是「三入口一引擎一存储、视图两张皮」总原则的落地。

## Considered Options

- 各入口各自实现生成与落库：被否——同一份会话可能因入口不同产生不同质量的条
- 只保留 AI 工具口、命令退化为语法糖：被否——暴毙会话场景下命令不经模型的特性是救援关键
