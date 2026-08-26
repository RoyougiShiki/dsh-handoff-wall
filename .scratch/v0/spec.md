# 交接板 v0.1 实现规格（spec）

> 本文件是实现的唯一契约：聚合 wayfinder 地图（`.scratch/v0/map.md`）、十张决策票答案、CONTEXT.md 术语与 docs/adr/ 四份 ADR。实现与验收以本文为准；冲突时先改本文再改码。

## 1. 任务目标

一个装进 DSH、日常可用的 v0.1 插件：换班时写下「交接条」，条按项目串成线程，人和 AI 都能翻。完整闭环 = 任意会话生成六段交接条入库 → 新对话经接续或查询拿到上下文 → 人有列表与时间线墙两视图 → AI 有四工具。

术语以 [CONTEXT.md](../../CONTEXT.md) 为准；四项架构决策见 [docs/adr/](../../docs/adr/)（L2-only 无采集器 · 单账本 · 生命周期同步宿主 · 三入口一引擎）。

## 2. 范围

**v0.1 内**：host（storageDomain 两表账本、`/handoff` 命令、AI 四工具、接续）；client（betterSidebar Tab 列表视图、React Flow 时间线墙——复用 talkmap 组件改造）。

**明确不做**（地图 Out of scope）：自动沉淀采集器、GitHub 发布、跨 harness 格式兼容、AI 自动判定边界。

**雾区（可后补，不阻塞验收）**：占位卡回填、doc-atlas 导出握手、画布布局打磨、空态/错误态美化、多项目聚合、打包分发形态。

## 3. 数据模型（票04 定稿）

domain `handoff_board` v1，两张表：

| 表 | 字段 |
|---|---|
| threads | id(uuid) · title · projectKey(pathSlug(cwd)) · createdAt(ms) |
| notes | id(uuid) · threadId · sessionId · parentSessionId(''=首条) · createdAt · title · body(六段md全文) · files[] · provenance('curated'\|'raw') |

- **不存 lifecycle**：显示态实时映射 sessionQuery 的 live/persisted（ADR-0003）
- 线程按 projectKey 聚合：一个 cwd 一条线，首条 note 即锚点

## 4. 六段模板（票05 定稿）

`## 任务目标` / `## 已完成` / `## 当前状态与开放问题` / `## 关键决策与否决` / `## 踩坑与阻塞` / `## 下一步与新会话先读清单`

工人纪律（system 段首）：不许猜（未运行写"未运行"）；引用不复制；禁输出密钥。产物缺任一段=废稿响亮失败。脱敏 13 正则三时机（材料进 LLM 前 / 落库前）。工人参数：maxTokens 3000 · temperature 0 · effort off · AbortSignal.timeout(120s) · 路由取 agentDefaultModel.currentSelection()。

## 5. 接口

### 5.1 斜杠命令
- `/handoff`：无参总结当前会话；单阶段（生成即入库并回显六段全文+落库回执）；命令不经模型。

### 5.2 AI 工具四件套（ctx.tools.register，defineTool 定义）
| 工具 | 参数 | 返回 |
|---|---|---|
| `board` | project?(string) limit?(number,默认20) | 线程分组的条目清单 md 表（标题\|日期\|状态\|id），时间倒序 |
| `read_handoff` | id(string, required) | 六段全文 markdown |
| `write_handoff` | session_id?(string，缺省=当前会话) | `{note_id, thread_title, title}` 文本回执 |
| `who_else` | path(string, required) | 近期触碰该路径的其他会话清单（存活态+最后触达），剔除调用者自身 |

### 5.3 卡片按钮（列表与画布共用）
打开原对话 · 开新对话（从此条接续，注入文本可编辑预览）· 补写交接。归档按钮不存在（ADR-0003）。

### 5.4 会话接续链
读源会话 cwd → `agents.create({sessionId:'session-'+uuid, meta:{cwd,parentSession}})` → `workspaceRegistry.resolveByPath(cwd).attachSession()`（失败降级不阻断）→ `agent.inject` 注入「引导语+六段全文+来源会话 id」为模型可见首条消息（source:{kind:'plugin'}）。不自动唤醒。

### 5.5 视图（同一 storageDomain 两张皮）
- **列表**（先做）：Tab 注册进 better-sidebar；线程分组 → 条目行（状态徽章 live/persisted 映射 进行中/已归档）→ 点开看六段全文 + 三按钮。
- **时间线墙**（随后）：React Flow；每线程一行泳道、条按 createdAt 横向排布；卡片=标题/日期/状态/文件 chips；SSE 订阅 domain 变更增量刷新。

## 6. 里程碑与验收

M1 ✅ 存储域+命令 → M2 四工具+接续（本轮）→ M3 列表视图 → M4 时间线墙 → M5 验收全绿。

**验收脚本（全绿=v0.1 完成）**：
1. `dev_build_plugin` 通过、`dev_inject_plugin` 成功、侧边栏出现「交接板」Tab
2. 测试会话 A 敲 `/handoff` → 回显六段摘要，列表出现新条目
3. 列表点「开新对话」→ 新会话首条消息含交接内容并可继续对话
4. 新会话内调 `board()` → 能看到该条目
5. 时间线墙显示 A 所在线程的链条
6. `systemctl --user restart dsh-web` 后数据仍在（持久化验证）
