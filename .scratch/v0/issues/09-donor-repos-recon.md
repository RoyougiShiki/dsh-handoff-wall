# 参考件侦察：bridge / WeiYe6 / talkmap / FleetingEcho

Labels: wayfinder:research
Type: research
Status: resolved

## Question

四个参考插件各有什么可直接复用的零件、必须避开的坑，以及保留/拔除/改造清单？

## Answer

### bridge（命令与编排骨架）
- **直搬**：`lib/api-rpc.js` 的 ROUTES 表（方法名→apiProxy[domain][key]，读 envelope.result）；`lib/command.js` 命令定义 `{name,input.hint,handler}` + pending Map(TTL) 两段确认流；`lib/fold.js` 事件折叠；`lib/migrate.js` 三段式（取材→一次性工人→双注入）。
- **改**：`compression.js` 摘要指令五段→六段；入库替代 archive 收尾。
- **关键机制**：斜杠命令由 host 注册表执行、不经模型、结果不进历史；goal 双注入是必须的（goal.create 不进模型上下文，须同时放首轮 prompt；pause 失败 fail-closed 取消 kickoff）；worker 用完必归档；等待用 history 尾页按 seq 过滤。

### WeiYe6/dsh-session-handoff（辅助摘要与会话接续链）
- **照抄模式**：constants 集中+加载期校验响亮失败；parseHandoffArgs / extractRecentMessages 纯函数；resolveRoute（配置优先→session.requestHeader 最近路由）。
- **接续链顺序即 fail-fast**：先总结（失败零副作用）→ `agents.create`（sessionId+agent 同建并 mount preset，裸会话客户端打不开）→ `workspaceRegistry.attachSession` → 标题改名 → 子会话 append 首条消息。
- **必须修的三个 bug**：① timeoutMs 从未接 AbortSignal，120s 超时是死的② maxInputChars 按 Buffer 字节算，中文≈8千字③ 客户端靠散文前缀+正则抠子会话 id，宿主改文案就断链——我们用结构化 payload。

### talkmap（视图层供体）
- **保留**：dsh-host.ts 服务契约声明、store 五表骨架（boards/cards/edges/digests/global）、routes（SSE 25s ping+same-origin POST 护栏）、MapCanvas、canvas-store、api 封装、SpawnPreview 可编辑面板。
- **拔除**：digest 管线四文件+L2 注入块+refresh 路由、spawn/inject 全链路、fs/ensure-dir、auto-sync 死代码。
- **改造**：domain 改名换字段为静态交接条库；入口从 shell.overlay 改走 `betterSidebar.registerTab({id,title,icon,single,order})`；confirm 流程改为纯本地落库。
- **坑**：客户端 apply() 绝不能 throw；CardId≠SessionId 是特性别简化；路由前缀避开 /api。

### FleetingEcho（三块边角料）
- **项目键控**：git 根两级探测（.git 祖先→git rev-parse 兜底）→回退 cwd；pathSlug = 非法字符折叠为 `-`，超 200 字符取尾+sha256 前 8 位；碰撞自愈靠 meta.json 认主。
- **脱敏**：redact.ts 13 条正则（私钥块/AWS/OpenAI/Anthropic/GitHub/Slack/Google/Bearer/JWT/通用 KEY=值 赋值式），三时机执行：落盘前、LLM 输入前、LLM 输出后。
- **七段模板**：Current Goal/Progress/Decisions/Constraints/Open Questions/Active Files/Next Steps——常量单点驱动+结构校验，作六段模板的对照参照系。

## Comments
- 由 workflow「handoff-wall-recon」4 个并行探员于绘图当日完成，全文报告已并入本 Answer。
