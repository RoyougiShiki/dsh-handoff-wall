# 触发面与 AI 工具签名

Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 04, 05

## Question

① 斜杠命令：名字定夺（/handoff 有潜在冲突风险要不要避开，比如 /note /wall /jiaojiex？）、参数语法（无参=当前会话；可选 sessionId 或数字轮数？要不要 --go 二段确认像 bridge）。② 画布/列表按钮终稿：打开原对话、开新对话、补写交接、归档——每个按钮的前端行为与后端路由。③ AI 四工具签名与返回格式：write_handoff(sessionId?, note?)、board(filter?)、read_handoff(id)、who_else(path) 各自返回什么结构化文本（AI 吃的表格形状）。④ 新会话接续链采纳 WeiYe6 流程但修三 bug（超时接线、结构化 payload 传递子会话 id 不用散文正则、attachSession 兜底）。⑤ 列表视图 v0.1 是否先于画布落地（同一 store 两张皮的技术分工）。

## Answer

### 斜杠命令
- `/handoff`：无参=总结当前会话。本地无冲突（bridge 占 /bridge，WeiYe6 未安装）。**单阶段**：生成即入库并在命令结果里回显六段摘要（写条低风险且后续可再生，不做 --go 两段确认）

### 卡片按钮（三个，归档按钮已随票02删除）
- 打开：跳转原会话
- 开新对话：从此条 spawn，注入文本预填六段全文、可编辑后放行（talkmap SpawnPreview 改造）
- 补写交接：对没有条的会话现场调 write_handoff

### AI 工具四件套签名
- `write_handoff({sessionId?})` → `{noteId, threadId, title}`；省略 sessionId=当前会话
- `board({project?, limit?=20})` → 结构化文本表：线程分组的条目清单（标题|日期|状态|文件数），时间倒序
- `read_handoff({id})` → 六段全文 markdown
- `who_else({path})` → 近期触碰该文件的会话列表+此刻是否存活

### 会话接续链
采纳 WeiYe6 流程修三 bug 版：先总结（失败零副作用）→ sessions.create 同建 agent+mount preset → workspaceRegistry.attachSession → 标题改名 → 子会话注入首条消息（结构化 payload 通知客户端，不用散文正则）

### 视图分工
列表与画布读同一个 storageDomain，走同一组 webServer 路由+SSE；列表先做（信息密度高），画布随后（复用 talkmap 组件）
