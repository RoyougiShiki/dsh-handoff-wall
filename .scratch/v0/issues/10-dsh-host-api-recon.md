# DSH 宿主服务面调研

Labels: wayfinder:research
Type: research
Status: resolved

## Question

交接条插件所需的宿主 API 最小集是否存在且可行？逐项给出签名、最小用法与出处。

## Answer

| 能力 | API | 要点 |
|---|---|---|
| 读历史 | `ctx.sessionQuery.listSessions / readSurface / readSession` | 主读通道；readSurface 窗口上限 50 条（长会话配 readSession 全量 raw log）；记录带 live/persisted 双标记 |
| 判活 | `ctx.sessions.list()` | 只有活会话 |
| 写存储 | `ctx.storageDomain.open(spec)` | spec=`{name,version,global?,tables(zod)}`；json 后端落 ~/.dsh/storages/<name>.json 原子重写；caller 持有并在 ctx.effect 里 close；重复 open 抛 already-open |
| 斜杠命令 | `ctx.commands.register(def)` | name 无斜杠小写；handler 收 invocation{rawInput,agent,signal} 返回 {kind,text}；结果不经模型 |
| 辅助摘要 | `ctx.llm.stream({provider,model,messages,maxTokens?})` | provider/model 必填无默认（用 agentDefaultModel.currentSelection() 取当前路由）；**purpose 是封闭枚举（compaction/session-title），留空**；返回 AsyncIterable StreamChunk |
| 事件订阅 | `ctx.on("session/event",(session,event)=>…)` | user/message、assistant/message、tool/call·result、turn/start·end 等 |
| 会话接续 | `ctx.agents.create({sessionId,meta{cwd,parentSession,agentPreset}})` | 返回 {agent,dispose}；agent.inject(userMsg) 注入不唤醒、followup() 唤醒；消息需 source:{kind:'plugin',plugin}；裸建后必须 workspaceRegistry.attachSession 否则输入框置灰 |

**结论**：读/写/交互/辅助 LLM 四类 API 全部存在且可行，最小集无缺项；仅需补 `workspaceRegistry.attachSession` 与 `agentDefaultModel.currentSelection()` 两个配套注入。出处均为 dsh-* 包 lib/types 声明 + dsh-talk-map 实战用例。

## Comments
- 由 workflow「handoff-wall-recon」探员于绘图当日完成。
