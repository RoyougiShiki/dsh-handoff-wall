# 六段模板与脱敏规则终稿

Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 09

## Question

① 六段模板终稿：我们的草案是 任务/已完成(带路径与验证结果)/当前状态/关键决策含否决/踩坑阻塞/下一步+新会话先读清单；FleetingEcho 七段是 Current Goal/Progress/Decisions/Constraints/Open Questions/Active Files/Next Steps。逐段比对取谁舍谁，中文段名定稿；「没跑过的验证必须写未运行不许猜」「引用不复制」这两条纪律写在 prompt 哪个位置。② 脱敏：FleetingEcho 的 13 条正则原样搬 + 三时机执行（落盘前/LLM 前/LLM 后），要不要给用户留自定义词表入口（v0.1 要不要）。③ 工人调用的固定参数定稿（maxTokens、reasoningEffort off、路由取 agentDefaultModel、超时必须自己接 AbortSignal——WeiYe6 的死配置坑）。
