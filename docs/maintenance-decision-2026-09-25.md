# 交接板维护价值评估（2026-09-25）

> 结论、证据与行动建议。本轮**没有改动插件代码**，只新增本文档（未提交）。
> 数据来源：本机账本 `~/.dsh/storages/handoff_board.json`、`~/.dsh/sessions/` 会话日志、
> `~/.dsh/profiles/web/{package.json,node_modules}`、GitHub API、DSH 安装包内置 README。

---

## 0. 结论（先看这个）

| 问题 | 结论 |
|---|---|
| 还值得继续维护吗？ | **值得，但只值得"维护态"**：冻结功能，只做 DSH 兼容与正确性修复。 |
| 有现成的"工作摘要账本"插件可替代吗？ | **没有整套的**。同类仓库 44~185 个，但最接近的两个（`dsh-report-ledger` 有血缘+账本+UI、`dsh-project-context` 有归档+自动交接+开新会话）都是 0~1★；上量的两个（bridge 165★ 跨 preset 迁移、dsh-memory 181★ 记忆）解决的是**另一个问题**。见 §5.6。 |
| 用记忆类插件替代？ | **不建议替代**。二者解决的不是同一个问题；记忆类插件解决"自动回想"，交接板解决"策展过的项目状态契约"。DSH 官方也不提供记忆层，只给"自带 MCP"的非背书示例。 |
| 有"摘要交接 + 记忆"二合一的插件吗？ | **有，而且很多**（Memory 分类下注册表有 202 条），peer 声明多能覆盖本机 `0.1.7-rc.1`；但都未在本机实测，且会与你的 KB + 交接板形成三重覆盖。若哪天真要装，**唯一推荐先试 [`dsh-memento`](https://github.com/PerryLink/dsh-memento)**（写入有不可绕过的审批闸、硬字符预算失败即报错、可重建审计、纯本地 SQLite）。 |
| 结合起来好不好？ | 方向对，但**现在不划算**。你已经用 `.ai-knowledge/` + `AGENTS.md` 手动实现了这套分层（策展、可人审）；再加一层自动记忆是三重覆盖，且把"自动写入 → 污染 → 修剪"这条链引进来。真正该补的是**交接板的过期/收敛机制**，以及**只读的回忆入口**（见 §6）。 |

**一句话**：插件本身没问题，有问题的是**部署链**——修好的版本没发布，线上跑的还是 9 天前那个会漏注入内容的旧包（见 §3）。

---

## 1. 实测使用量：它真的在用，不是玩具

从 `handoff_board.json`：

- **47 条交接条 / 4 个线程 / 44 条接续血缘**，时间跨度 2026-08-26 → 2026-09-20。
- 按"主会话"（`session-` 前缀目录）统计覆盖率：

| 工作区 | 主会话数 | 有交接条 | 覆盖率 |
|---|---|---|---|
| DigitalTextBooks | 58 | 31 | **53%** |
| TCMAnatomyModule | 11 | 4 | 36% |
| dsh-plugins | 22 | 5 | 22% |
| .dsh | 29 | 2 | 6% |

- DigitalTextBooks 那条线程有 **35 条**，且 `links` 表里存在 5 级以上的连续接续链
  （`67e4cee9 → b491cad4 → 16ee77af → 92f64de2 → {6f2291a9, da51e106}`）——
  说明"一个阶段做完就换会话、靠交接条重新进入"是**已经固化的工作方式**，不是一次性试用。
- 大量人类提示就是"请你理解交接信息…"，即交接条承担了**冷启动简报**的日常职责。

> 注：ADR-0008 里"68 个会话只有 2 条交接条"的观察已经过时（那是 8 月底的数据）；
> 也不要把子代理会话（无 `session-` 前缀）算进分母，它会把覆盖率压得虚低。

**判断**：这项能力有真实需求，且已被日常使用验证。

---

## 2. DSH 原生能力对照：它替代了什么，没替代什么

| 能力 | DSH 0.1.7 原生 | 交接板 |
|---|---|---|
| 找历史会话（按 cwd 亲缘排序） | ✅ `session-reference` 候选发现 | — |
| 把别的会话内容带进上下文 | ✅ `@` 引用，有界只读快照 | — |
| 会话内压缩 | ✅ `/compact` | — |
| 每轮首提示/末回答短预览 | ✅ `session-turn-outline` | — |
| 跨会话全文检索 | ✅ `session-query` + sqlite 后端（面向应用代码，非 UI） | 账本内查找 |
| **策展过的六段事实契约** | ❌ | ✅ 唯一真源 |
| **谁接续了谁（血缘）** | ❌ | ✅ `links` 表 |
| **按项目排的时间线墙 + 未交接会话视图** | ❌ | ✅ |
| **"这个文件被谁碰过"撞车检查** | ❌ | ✅ `who_else` |
| **跨会话长期记忆（自动回想）** | ❌（本机未见原生 memory 包） | ❌ |

原生引用是**只读快照，不是实时链接**，也不做摘要（官方 README 明示）。所以"能引用对话"削弱了"找会话"的价值，但没有替代六段契约与血缘。

---

## 3. 线上缺陷（本轮最该修的，且不在功能层）

### 3.1 部署漂移：修好的代码没上线

| 位置 | 版本 | 时间 |
|---|---|---|
| `~/.dsh/profiles/web/node_modules/@dsh-external/dsh-handoff-board` | **v0.0.8** | 2026-09-06 构建 |
| 仓库 `lib/`（已构建） | HEAD `db1dd28` | 2026-09-24 18:16 |
| GitHub Release 最新 tag | **v0.0.8** | 2026-09-06 |

`db1dd28`（0.1.7-rc.1 的 kind 适配）**既没发布也没部署**，而本机 DSH 已是 `0.1.7-rc.1`。
profile 依赖指向的是 release tgz，不是本地 link —— 正是工作区 AGENTS.md 记录过的那个坑。

### 3.2 旧过滤规则在 0.1.7 下会漏注入内容（实测）

旧规则：`if (source.kind === 'plugin') continue`。0.1.7 起每个产出方自带 kind，实测同一批会话的
`user/message` 里出现了 `user / plugin / skill-catalog / agent-instructions / skill-invocation` 五种：

| 会话 | 人类输入 | 助手正文 | 会被漏进取材的注入内容 |
|---|---|---|---|
| `session-e5860427`（DigitalTextBooks） | 5,135 字 | 1,045,259 字 | `skill-catalog` 11,161 + `agent-instructions` 5,108 |
| `session-b78ed7ba` | 5,845 字 | 535,432 字 | `agent-instructions` 15,761 + `skill-catalog` 22,514 + `skill-invocation` 18,778 |
| `session-e7dfe93d` | 1,134 字 | 450,418 字 | `skill-catalog` 11,405 + `agent-instructions` 5,998 |

读法要准确，别夸大也别缩小：

- 漏进来的注入量是**人类真实输入的 3~50 倍**（1.1k~5.8k 人话 vs 6k~57k 注入文本）；在长会话里助手正文才是材料主体（45 万~100 万字），所以注入并不是"材料的大头"。
- 但危害不取决于占比：这些文本是**指令与技能目录**，混进给总结模型的材料后会被当作"对话内容"引用进交接条；
  而且它会**随技能生态自然增长**（skill-catalog 已经从 11k 涨到 22k）。
- 在"刚开会话就 `/handoff`"这类短会话里，注入量反而会压过真实对话，问题更明显。
- 这与 2026-08-28 记录的 874→2290 字复读膨胀是同一类故障，只是注入源从"接续全文"换成了"技能目录/工作区指令"。
  HEAD 的正面规则（只认 `kind === 'user'`）已修掉它——修法是对的，问题只在于没上线。

### 3.3 已发生过的真实事故（2026-09-24）

`session-94b164cb` 里你报的"交接结果是无材料"，根因**不在插件**：上游 `a61/deepseek-v4.1-flash`
路由把整条 user 消息吞了（`prompt_tokens` 恒在 system 量级），工人如实回答"没有材料"。
但插件侧的连带缺陷把它变成了**成功入库的废条**：`validateSections()` 只校验六个二级标题，
一份"材料缺失"的拒答稿结构完全合格 → 判定成功 → 覆盖掉已有的好条。

---

## 4. 维护成本模型（决定"值不值"的真正变量）

| 变量 | 实测 | 含义 |
|---|---|---|
| 上游改动频率 | DSH 从 alpha→rc 几乎每 1~3 天一发（09-22 alpha.1/alpha.2、09-23 rc.1、09-24 rc.2） | 兼容税是**持续性**的，不是一次性的 |
| 本插件耦合面 | 仅 6 处内部 seam import（`dsh-storage-domain`/`dsh-llm`/`dsh-tools`/`dsh-session-title`）+ slots 注册 | 不算深，但都在 pre-1.0 的私有接口上 |
| 提交节奏 | 8 月 52 次（建设期）→ 9 月 4 次（1 兼容 + 2 正确性 + 1 功能） | **功能期已经结束**，进入少量维护 |
| 自动化测试 | 无（只有 `.scratch/v0/spec.md` 的人工验收清单） | 每次兼容修复都要手工验证一轮，是维护成本的主要放大器 |
| 代码体量 | host ~1.4k 行 + client 1.3k 行 = 2.7k 行 | 单人可读，不构成负担 |

**结论**：真正的成本不是"功能写不完"，而是"每次上游动 kind/seam，都要人工重验一遍"。

---

## 5. 记忆类插件生态（替代/合并选项核对）

> 生态膨胀很快：GitHub `topic:dsh-plugin` + `memory` 的仓库搜索返回 **525** 个结果
> （含通用记忆框架，不只是 DSH 插件）。以下只列经 GitHub API / README 核实过的一手信息。

### 5.1 DSH 专用

| 项目 | 体量（GitHub API 实测） | DSH 兼容（npm peer 实测） | 写入路径 | 存储 | 备注 |
|---|---|---|---|---|---|
| ⭐ [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | 118★，Apache-2.0，push 2026-09-25，npm `0.5.18`（09-24） | peer `>=0.1.7-0 <0.2.0` → **显式覆盖 0.1.7 线**（README 记录已适配 `dsh-v0.1.7-rc.2`） | **审批闸**（`ask`/`auto`/`off`，闸在服务层，"no model path can bypass"） | 本地 SQLite（`node:sqlite` WAL，0600） | 硬字符预算超限**报错而非截断**、可重建审计。**若哪天真要装记忆层，从这个开始** |
| [omdsh-dev/dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 412★，npm `0.5.14`（09-25） | peer 允许 `^0.1.7-alpha.1`（README 开发基线仍 `0.1.5-rc.1`） | Runtime 自动投影 + Documents 按需读 + Memory Spaces | 本地 + 外部 Provider 可选 | 三档记忆；Documents 档明确含 "handoffs"——最接近"二合一"；依赖较重（自带 mem0 / honcho provider） |
| [Aik358/dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) | 78★，npm `0.2.0`（09-24） | peer `>=0.1.5-rc.2 <0.2.0` → 覆盖 0.1.7-rc.1 | 自动唤回 + 三层自动沉淀 | 本地 Markdown（+ 可选语义层） | README 明写 "Handoff, not compression"：四段交接条 + PLAN 白板；依赖最轻（yaml+schemastery） |
| [seriousz158/dsh-memory](https://github.com/seriousz158/dsh-memory) | 181★，push 09-23 | 未声明 | 模型改隔离副本 → 宿主校验后写入（dry-run/apply） | **本地 Git 仓库**（`summary.md` ≤12KiB + `handbook/` + `rollouts/`） | 对 git 原生用户最顺手：可回滚、两步确认删除、拒绝符号链接逃逸 |
| [tinqiao-oss/engramory](https://github.com/tinqiao-oss/engramory) | 191★，`dsh-engramory@0.2.5`（09-24） | peer 为空（host-agnostic） | **人 + 模型策展纪律**（靠 AGENTS.md 规则） | Markdown，一事一文件 + 常驻索引 | 自标 experimental，并诚实写明"索引上限不是全局写入闸（Bash/MCP/外部编辑器可绕过）"；零基础设施、零 embedding |
| [slow-stack/mneme](https://github.com/slow-stack/mneme) | 121★，v0.8.7（09-24），14 open issues | peer 覆盖 | 自动 + `autoDream` 后台合并 | SQLite + 可人编 Markdown 镜像 | 冲突**冻结待人工复核**而非覆盖，设计好但 issue 偏多 |
| [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | 117★，v0.29.0（09-24） | **peer 为空——无任何兼容承诺** | `memory_remember` 工具显式写入 + 空闲合并 | SQLite 七层（soul/user/project/fact/lesson/rules/topic） | BM25 × 时间衰减 × 重要度；设计细，但兼容零承诺 |
| [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) | 332★ | 未核实 | 五轨记忆 + 后台自进化 | 本地 | 中文项目 |
| [boomzikazita/dsh-memory](https://github.com/boomzikazita/dsh-memory) | 0★，push 08-25 | 未核实 | confirm-before-write | Fernet 加密 vault | 有确认闸，但基本无人验证 |

### 5.2 跨代理通用层（支持 DSH）

| 项目 | 体量 | 接法 | 存储 | 关键代价 |
|---|---|---|---|---|
| [zilliztech/memsearch](https://github.com/zilliztech/memsearch) | 2.6k★，npm `@zilliz/memsearch-dsh@0.1.5`（2026-09-12） | 官方 DSH 插件 + `memory-recall` skill，peer 只声明 `@deepseek-ai/dsh-llm: *` | `.memsearch/memory/*.md` 为真源 + Milvus 可重建索引 | 自动捕获+自动注入（污染面）；需 `uv` + 本地 ONNX 模型（~558MB），另有 Python 运行时面 |
| [EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS) | 13k★ | 官方 [DSH 插件](https://github.com/EverMind-AI/plugins/tree/main/dsh) | Markdown 真源 + SQLite + LanceDB | 需要 OpenRouter API key 才能启动 |
| [volcengine/OpenViking](https://github.com/volcengine/OpenViking) | 38k★ | 记忆 Bundle | 上下文数据库 | 体量大，定位是"上下文数据库"而非交接 |

### 5.3 评估这些替代品时要盯的四件事

1. **写入是否自动**：自动抽取 = 污染与修剪负担（与你担心的一致）；`confirm-before-write` 型的更接近你的哲学。
2. **兼容声明≠实测**：`dsh-auto-memory` 的 peer 范围覆盖 `0.1.7-rc.1`，`dsh-mnemon` 的 npm peer 允许 `^0.1.7-alpha.1`
   （但 README 的开发基线仍是 `0.1.5-rc.1`），`memsearch-dsh` 只声明 `dsh-llm: *`。
   这些是**声明**，不是在本机 `0.1.7-rc.1` 上的实测；RC 周更的情况下，声明与现实之间通常隔着一两次上游改动。
3. **是否要新基建**：embedding 模型 / Milvus / Python `uv` / 云 key / mem0·honcho provider，都是新的运维面。
   轻依赖的只有 `dsh-auto-memory`（yaml + schemastery）。
4. **是否与 `.ai-knowledge/` 重复**：你已经有一套**策展、git 版本化、可人审**的跨项目记忆
   （Karpathy 三层 wiki + `kb-access` skill，且明确规定"项目内容不进 KB"）。再叠一层自动记忆 = 三套记忆源互相漂移。

### 5.4 DSH 独有的坑（装任何"注入型"插件前必读）

1. **compaction 遮蔽（最致命）**：`compaction/summary` 会遮蔽已注入的记忆块，而 harness 的内容指纹去重随后**不会再注入**——
   记忆在第一次压缩后就永久消失。[#5333](https://github.com/deepseek-ai/deepseek-harness/discussions/5333)
   任何不做 `compaction/summary` 特判的注入型插件都会中招。
2. **发送路径被阻塞**：下载量最高的 OpenViking 插件在 `agent/pre-step` 里同步 HTTP 调用，实测每条消息**延迟 300–2000ms**
   （[OpenViking #4515](https://github.com/volcengine/OpenViking/issues/4515)）。
3. **DSH 没有插件兼容检查**：0.1.1 升级就出现过"第三方插件静默崩"，
   [讨论 #4013](https://github.com/deepseek-ai/deepseek-harness/discussions/4013)；0.1.7 换了整套 settings 注册面——
   `dsh-memento` 因此要维护 4 套 settings 分支。**兼容税对谁都一样重，这一点不会因为换插件而消失。**
4. **卸载不会删记忆文件**；且已出现过"记忆涨到 218 个文件 / 46KB 索引被 harness 静默截断"的案例。

### 5.5 反向证据（说明这条路对 DSH 尤其难走）

- 把 hermes-agent 的 MEMORY.md/USER.md 机制（2200/1375 字符预算、快照冻结、漂移检测、100% 测试覆盖）移植到 DSH 的尝试
  **最终归档并删除**，作者的结论是：*"these mechanisms are not useful for DeepSeek Harness: the harness deliberately keeps session state in the session log"*。
  [讨论 #525](https://github.com/deepseek-ai/deepseek-harness/discussions/525)
- DSH 官方**尚未实现**的设计（[recallable-compaction.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md)，
  状态 proposed）是：**冻结的索引检查点 + 一个可变状态检查点 + `history_read`/`history_search` 召回工具**，并把
  "工作区与其工作树本身就是长期记忆和真源"作为前提——**这与交接板独立演化出的形态高度一致**。
  也就是说：交接板不是在与上游竞争，而是在上游尚未落地前先做了一遍。
- 同类的功能孪生品 `FleetingEcho/dsh-handoff`（按 git 分支写 `handoff.md`）**自 2026-08-31 起就没再更新**（2★）。

### 5.6 "工作摘要账本"这一类的现成替代品（2026-09-25 逐个核对）

交接板的正确定位不是"记忆"，而是**工作摘要账本**（换班时写下的策展状态索引）。按这个定义去 GitHub 找：

- `topic:dsh-plugin` + `handoff` → **44 个**仓库；+ `summary|checkpoint|ledger` → **185 个**。
- 绝大多数是 **0~3★ 的单人项目**，创建时间都在最近 6 周内；上量的两个（165★ / 181★）解决的是**另一个问题**。

| 候选 | ★ | 它实际做的 | 与交接板的差距 |
|---|---|---|---|
| [Totoro-qaq/dsh-plugin-bridge](https://github.com/Totoro-qaq/dsh-plugin-bridge) | **165** | 跨 preset 的**会话迁移**：五段式 handoff、执行前可预览、只搬状态不搬工具痕迹 | **最成熟**（有分版本兼容矩阵与 doctor 自检，`0.1.7-rc.1` 已实测 13/13），但不是账本：没有线程/血缘/历史墙，目标是换模型/preset 而非项目续接 |
| [seriousz158/dsh-memory](https://github.com/seriousz158/dsh-memory) | **181** | 本地 Git 仓库式记忆：`summary.md`(≤12KiB) + `handbook/` + `rollouts/`，模型改隔离副本、宿主校验后写入 | 记忆+摘要混合，**无六段契约、无血缘、无撞车检查** |
| [P02-1010751281/dsh-project-context](https://github.com/P02-1010751281/dsh-project-context) | 1 | 项目级上下文全家桶：会话自动归档（JSONL+MD+INDEX）、历史回填、**④交接**= 上下文越阈且无后台子代理时自动摘要并**另开新会话**+`HANDOFF.md`、技能沉淀 | 形态最全（归档+索引+交接+开新会话），但 1★、无接续血缘、无墙/看板、无 `who_else`；且走"自动触发"哲学，与"换班时刻才写"相反 |
| [stone-brick/dsh-report-ledger](https://github.com/stone-brick/dsh-report-ledger) | 0 | 把"汇报"做成一等原语：**可追溯的传递路径账本**（parent/children 跳转）+ 回执/结案/修正 + 时间线标签页 + `peer_start` 开同伴会话 | **结构最接近**（血缘树 + 账本 + UI + 按需读正文）。但它是**代理间汇报协议**（多代理协作），不是"人在会话间换班"；0★ |
| [snow-The/dsh-session-handoff](https://github.com/snow-The/dsh-session-handoff) | 3 | `handoff_export`（结构化 Markdown 落 `<workspace>/.dsh-handoff/`）+ `handoff_resume`（新会话加载续接）+ `handoff_status`，外加上下文修剪与模型路由 | 有 export/resume/status，**无账本线程、无血缘、无撞车检查、无墙** |
| [0mn1si2i5/dsh-handoff](https://github.com/0mn1si2i5/dsh-handoff) | 1 | `/handoff save` → `docs/handoffs/current.md`，`/handoff load` → 注入新会话；**确定性脱敏 + Git 状态捕获** | 只有单文件 save/load（无历史、无多项目），README 自述"没有跨工具交接格式，也没有 UI" |
| [ChenneyZhuang/project-handoff](https://github.com/ChenneyZhuang/project-handoff) | 0 | 一个 **skill**：每项目一份 dated `handoff.md`（状态/决策与理由/坑：症状·成因·修法） | 是 skill 不是插件，无账本/血缘/UI |

**核对结论**：这套契约**没有现成替代品**。三个方向各有人走了一段——
bridge 走"迁移 + 工程成熟度"，report-ledger 走"血缘 + 账本 + UI"，project-context 走"归档 + 自动交接 + 开新会话"——
但没有一个把"策展六段 + 跨会话线程/血缘 + 撞车检查 + 从条开新会话 + 人可看的墙 + AI 工具"整套做完。
反过来看：公开 star 最高的两个解决的都不是这个问题（165★ 迁移、181★ 记忆），
而本机实测的**私有使用量（47 条 / 主项目 53% 覆盖）远高于这些替代品的公开采用度**。

**该借的三个设计（低成本、直接降维护）**：

1. **分版本兼容矩阵 + doctor 自检**（bridge 的做法：每个 DSH 版本记录 doctor 通过项）——
   把"每次上游升级要人工重验一遍"变成一条命令，这是当前维护成本的最大项。
2. **修正即新记录，不覆盖**（report-ledger 的做法）——与 §3.3 的"废条覆盖好条"事故正好互为解药。
3. **正文留账本、工具只回头部与定位**（report-ledger 的做法）——`read_handoff` 默认返摘要+id，
   需要全文再分页取；可同时缓解 token 膨胀与"注水"。



---

## 6. 建议

### 立即做（半天内）

1. **发布并部署 v0.0.9**：把 `db1dd28` 的 kind 修复送上 profile。
   `bash scripts/build.sh` → 打 tag + 上传 tgz → `dsh plugin --profile web add <tgz-url>`（按工作区铁律，profile 改动需你确认）。
2. **给工人加"拒答守卫"**：工人正文自称"未提供材料/材料缺失"而 `material.transcript` 非空时判失败，
   **不覆盖**已有条并报真因（对应 §3.3 的事故）。
3. **给取材过滤加一条冒烟测试**：用一份真实会话日志（如 `session-b78ed7ba`）断言
   "material 只含 `kind==='user'` 与 assistant 正文"，防止下一种新注入 kind 又漏进来。

### 可选（若想进一步降低维护面，需要一个设计决定）

- **砍掉"工人"这条链**：现在 `/handoff` 会另起一次模型调用（`command.ts` 的 worker），
  历史事故几乎都出在这条链上——上游路由吞消息（§3.3）、档位不支持白烧重试、注水导致复读膨胀。
  而 `write_handoff` 工具本来就允许**当前会话自己写条**：主会话最清楚刚做完什么，
  一次调用即可落库，无路由依赖、无取材、无复读。
  代价：交接条质量取决于当时会话的自觉程度，且不再能用"便宜的小模型"批量补写历史会话。
  这是一个取舍，建议先按 1–3 修好再观察一轮，不必现在决定。

### 冻结不做

- ADR-0007/0008 的工作区 Brief（归纳产物）；
- 占位卡自动回填、doc-atlas 导出、transcript 语义检索；
- 跨 harness 记忆层。

理由：§1 显示瓶颈从来不是"没有 Brief 算法"，而是"交接条只覆盖了 4 个工作区里的 2 个"。
把工程投入放在**提高写入的可靠性**（上面 1–3）比放在**归纳已有少量条**回报高得多。

### 记忆层：先不装，保留观察

- 如果痛点是"新会话不知道项目状态" → 交接板 + 原生 `@` 引用已经对了，不需要记忆插件。
- 如果痛点是"换项目要重新解释环境和偏好" → 那是 `AGENTS.md` 与 `.ai-knowledge/` 的职责，已经解决。
- 如果痛点是"想不起来某件事在哪说过" → **不要装记忆层，加一个只读回忆入口**：本机自带的
  `dsh-session-query-sqlite` 已对整个会话语料建了 SQLite FTS5 索引（`current | shadowed | log-only` 分类）。
  **只读方案写入为零，因此不可能累积垃圾**——这正是"记忆类插件"最容易出问题的那一环。
- 只有当痛点是"**不想写笔记，也想被自动想起**"时，才轮到记忆插件。真要试：
  1. **开独立 profile 试**（`dsh --from-default-profile web`），不要在 web 主 profile 上做实验；
  2. 首选 [`dsh-memento`](https://github.com/PerryLink/dsh-memento)（审批闸 + 硬预算 + 本地 SQLite + 显式适配 0.1.7 线）；
  3. 观察两件事：注入内容里有多少是无关的；下次 DSH 换 RC 后它还能不能起来（上游无兼容检查，只有运行时才知道）。
  4. 顺手装 [`dsh-memory-archive`](https://github.com/vv5v5/dsh-memory-archive) 这类**提示词检查器**，
     它能把每轮实际发出去的 system 段落按顺序与体积列出来——用来验证"注入了什么"比读插件作者的自述可靠。

### 停止维护的触发条件

连续 3 周内：`/handoff` 使用 ≤ 2 次/周，且你不再从交接条续接会话 → 说明工作方式已经不需要它，
退回"DSH 原生引用 + `/compact` + KB"即可。

---

## 7. 不确定性与未验证项

- §3.2 的数字是**按旧过滤规则对真实日志重算**得出的（静态推演），没有跑一次真实生成来复现；
  跑生成会写入你的账本，需要你同意后再做。
- §5 各候选的"兼容"列取自 **npm peerDependencies 声明**（已用 registry API 实测取值），
  不是在本机 `0.1.7-rc.1` 上安装运行验证过的；也没有对任何候选做过注入质量或性能实测。
- `dsh-mnemon` 的 README 开发基线（`0.1.5-rc.1`）与其 npm peer 范围（允许 `^0.1.7-alpha.1`）互相矛盾，
  我按 peer 范围记录，未核对其"兼容矩阵"究竟验证到哪个版本。
- 本环境 web 检索到的插件市场站点（`dsh-plugin.org`、`awesome-dsh-plugin.com` 等）为聚合站，
  star 数与描述未逐条核实；上表中"体量"列以 GitHub API 实测为准。
- 没有找到"策展交接账本 vs 自动记忆层"的同负载公开基准；本结论依据的是使用量实测、
  原生能力对照、以及自动记忆的公开故障报告（见 [../../research/handoff-vs-memory-patterns.md](../../research/handoff-vs-memory-patterns.md)）。

## 8. 参考

- 记忆类插件清单与故障模式（2026-09-25 核）：[dsh-memory-landscape.md](../../research/dsh-memory-landscape.md)
- 记忆 vs 交接的行业做法与故障证据：[handoff-vs-memory-patterns.md](../../research/handoff-vs-memory-patterns.md)
- 上一轮的替代方案调研（2026-09-24）：[maintenance-alternatives-research.md](maintenance-alternatives-research.md)
- 排障笔记：[troubleshooting.md](troubleshooting.md)
- 本轮新建的取材体检脚本：[../.scratch/kind-audit.mjs](../.scratch/kind-audit.mjs)
  （用法：`node .scratch/kind-audit.mjs "<项目目录名>|<session-id>"`，输出该会话 `user/message` 的 kind 分布与体积）
