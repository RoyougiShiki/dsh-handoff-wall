# 六段模板与脱敏规则终稿

Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 09

## Question

① 六段模板终稿：我们的草案是 任务/已完成(带路径与验证结果)/当前状态/关键决策含否决/踩坑阻塞/下一步+新会话先读清单；FleetingEcho 七段是 Current Goal/Progress/Decisions/Constraints/Open Questions/Active Files/Next Steps。逐段比对取谁舍谁，中文段名定稿；「没跑过的验证必须写未运行不许猜」「引用不复制」这两条纪律写在 prompt 哪个位置。② 脱敏：FleetingEcho 的 13 条正则原样搬 + 三时机执行（落盘前/LLM 前/LLM 后），要不要给用户留自定义词表入口（v0.1 要不要）。③ 工人调用的固定参数定稿（maxTokens、reasoningEffort off、路由取 agentDefaultModel、超时必须自己接 AbortSignal——WeiYe6 的死配置坑）。

## Answer

- **六段合并版定稿（中文段名）**：①任务目标 ②已完成（逐条文件路径+验证结果，没跑过的必须写"未运行"）③当前状态与开放问题 ④关键决策与否决（含理由）⑤踩坑与阻塞 ⑥下一步与新会话先读清单
- 「不许猜」「引用不复制」两条纪律写入 worker prompt 的 system 段首
- 脱敏：redact.ts 13 条正则照搬，三时机执行（落盘前/LLM 输入前/输出后）；自定义词表入口 v0.1 不做
- 工人参数定稿：maxTokens 3000；超时自接 AbortSignal.timeout(120000)（修 WeiYe6 死配置坑）；路由取 agentDefaultModel.currentSelection()
