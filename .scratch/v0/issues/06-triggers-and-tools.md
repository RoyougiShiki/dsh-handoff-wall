# 触发面与 AI 工具签名

Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 04, 05

## Question

① 斜杠命令：名字定夺（/handoff 有潜在冲突风险要不要避开，比如 /note /wall /jiaojiex？）、参数语法（无参=当前会话；可选 sessionId 或数字轮数？要不要 --go 二段确认像 bridge）。② 画布/列表按钮终稿：打开原对话、开新对话、补写交接、归档——每个按钮的前端行为与后端路由。③ AI 四工具签名与返回格式：write_handoff(sessionId?, note?)、board(filter?)、read_handoff(id)、who_else(path) 各自返回什么结构化文本（AI 吃的表格形状）。④ 新会话接续链采纳 WeiYe6 流程但修三 bug（超时接线、结构化 payload 传递子会话 id 不用散文正则、attachSession 兜底）。⑤ 列表视图 v0.1 是否先于画布落地（同一 store 两张皮的技术分工）。
