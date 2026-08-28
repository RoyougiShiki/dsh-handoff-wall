# 交接板 v0.1 实现规格（spec）

> 名称 **dsh-handoff-board** —— DSH 会话间上下文交接与线程时间线可视化插件。
>
> 本文件是实现的唯一契约：聚合 wayfinder 地图（`.scratch/v0/map.md`）、十张决策票答案、CONTEXT.md 术语与 docs/adr/ 四份 ADR。实现与验收以本文为准；冲突时先改本文再改码。

## 1. 任务目标

一个装进 DSH、日常可用的 v0.1 插件：换班时写下「交接条」，条按项目串成线程，人和 AI 都能翻。完整闭环 = 任意会话生成六段交接条入库 → 新对话经接续或查询拿到上下文 → 人有单视图关联时间线（以交接关联为主轴）→ AI 有四工具。

术语以 [CONTEXT.md](../../CONTEXT.md) 为准；四项架构决策见 [docs/adr/](../../docs/adr/)（L2-only 无采集器 · 单账本 · 生命周期同步宿主 · 三入口一引擎）。

## 2. 范围

**v0.1 内**：host（storageDomain 两表账本、`/handoff` 命令、AI 四工具、接续）；client（主区视图 `conversation.view` 插槽——与「对话」「轨迹」并列切换、排最后；🧭 单视图关联时间线 + 右侧详情栏，以交接关联为主轴、时间为次级标签）。

**明确不做**（地图 Out of scope）：自动沉淀采集器、GitHub 发布、跨 harness 格式兼容、AI 自动判定边界。

**雾区（可后补，不阻塞验收）**：占位卡回填、doc-atlas 导出握手、画布布局打磨、空态/错误态美化、多项目聚合、打包分发形态、编辑已有条目、多看板管理、自定义脱敏词表、SSE 实时刷新（当前为手动 ↻）。

## 3. 数据模型（票04 定稿）

domain `handoff_board` v1，两张表：

| 表 | 字段 |
|---|---|
| threads | id(uuid) · title · projectKey(pathSlug(git根，回退 cwd)) · createdAt(ms) |
| notes | id(uuid) · threadId · sessionId · parentSessionId(''=首条) · createdAt · title · body(六段md全文) · files[] · provenance('curated'\|'raw') |

- **不存 lifecycle**：显示态实时映射 sessionQuery 的 live/persisted（ADR-0003）
- **迁移规则**：仅允许加可选字段原地升 patch；破坏性改动必须 version+1 并写迁移
- **归档可读性义务**（ADR-0003）：实现期须验证归档会话经 sessionQuery/readSession 仍可读；不可读则旧条详情降级提示
- 线程按 projectKey 聚合：一个 cwd 一条线，首条 note 即锚点

## 4. 六段模板（票05 定稿）

`## 任务目标` / `## 已完成` / `## 当前状态与开放问题` / `## 关键决策与否决` / `## 踩坑与阻塞` / `## 下一步与新会话先读清单`

工人纪律（system 段首）：不许猜（未运行写"未运行"）；引用不复制；禁输出密钥。三条硬性纪律位于 system 提示（角色句之后）。产物缺任一段=废稿响亮失败。**脱敏 11 条正则（移植上游 13 条并合并等价项），三时机执行：材料进 LLM 前 / 正文落库前 / LLM 输出后**。工人参数：maxTokens 8000 起 · temperature 0 · effort off · AbortSignal.timeout(120s) · 路由取 agentDefaultModel.currentSelection() · purpose 参数必须留空（封闭枚举）。
重试策略：空文本或段缺失时三轮递进——8000(effort off) → 24000(+直接输出指令) → 24000(去掉 effort 参数)；每轮分块遥测计入错误信息。

## 5. 接口

### 5.1 斜杠命令
- `/handoff`：无参总结当前会话；单阶段（生成即入库并回显六段全文+落库回执）；命令不经模型。

### 5.2 AI 工具四件套（ctx.tools.register，defineTool 定义）
| 工具 | 参数 | 返回 |
|---|---|---|
| `board` | （无参数，全量返回） | 按关联族分组的条目 bullet 清单（日期 \| 标题 \| 状态 \| 类型(主对话/🤖子代理+父id) \| 文件数 \| id），时间倒序 |
| `read_handoff` | id(string, required) | 六段全文 markdown |
| `write_handoff` | session_id?(string，缺省=当前会话) | 回执文本 + `{note_id, thread_title, title}` |
| `who_else` | path(string, required) | 仅「活着的」其他会话（剔除调用者自身），附最后触达时间 |

### 5.3 卡片按钮（列表与画布共用）
打开原对话（客户端 sessions.open）· 开新对话接续（成功后自动跳转新会话）· 补写交接条。归档按钮不存在（ADR-0003）。注入文本可编辑预览移至雾区（v0.2）。

### 5.4 会话接续链
读源会话 cwd → `agents.create({sessionId:'session-'+uuid, meta:{cwd,parentSession}})` → `workspaceRegistry.resolveByPath(cwd).attachSession()`（失败降级不阻断）→ `agent.inject` 注入「引导语+六段全文+来源会话 id」为模型可见首条消息（source:{kind:'plugin'}）。不自动唤醒。attachSession 失败不静默——以 warning 字段回传前端提示手动归组。标题改名步骤 v0.1 未实现（登记雾区）。

### 5.5 视图（同一 storageDomain，单张皮：关联时间线，v0.5 定稿）
- **单视图：关联时间线**（主区视图 conversation.view 插槽，order=100 排轨迹后；better-sidebar Tab 方案与列表模式均已废弃）：以「交接关联」为主轴、时间为次级标签的竖向时间线 + 右侧详情栏。
- **关联模型（v0.5，见 ADR-0005）**：`notes.parentSessionId`（`''`=首条）为血缘键建树，按「交接族」分组；🤖 子代理与正式条按血缘缩进挂父卡下；跨工作区父会话补虚线「外部原对话」节点；家族按子树最新活动倒序（`subtreeMax`）。
- **反向关联显式化**：每卡标注「↳ 被 N 接续」「源: 前8位父id」与 进行中/🤖子代理/↪外部 徽章；时间退为卡片内次级标签。
- **交互**：父节点默认折叠、点 ▶ 展开；点卡在右侧详情栏看六段全文 + 打开原对话/开新对话/补写三按钮；右栏独立滚动（根容器对齐插槽 100% 高度链、去 46vh 内部 caps）。
- **设计约束**：不引入 React Flow；关联关系全部由静态数据（parentSessionId/kind/sessionQuery live）派生、零 LLM 成本，与 talkmap 弃用（仅指 LLM 滚动摘要）不冲突。
### 5.6 数据读取路径（澄清，防混淆）
- 账本里有交接条 → 工具/UI 直接返回原文，永不重复总结
- 无条的时段 → 查询时现场机械提取原始日志干事实（零 LLM）；detail 式深挖=一次性 LLM+缓存
- 占位卡回填（v0.2 候选）只服务墙面视觉连续性，AI 不依赖

## 6. 里程碑与验收

M1 ✅ 存储域+命令 → M2 四工具+接续（本轮）→ M3 列表视图 → M4 时间线墙 → M5 验收全绿。

**验收脚本（全绿=v0.1 完成）**：
1. `dev_build_plugin` 通过、`dev_inject_plugin` 成功、主区出现「📌 交接板」视图（与对话/轨迹并列，排最后）
2. 测试会话 A 敲 `/handoff` → 回显六段全文与落库回执，列表出现新条目
3. 列表点「开新对话」→ 新会话首条消息含交接内容并可继续对话
4. 新会话内调 `board()` → 能看到该条目
5. 时间线墙显示 A 所在线程的链条
6. （延后，由用户择机）`systemctl --user restart dsh-web` 后数据仍在（持久化验证）
