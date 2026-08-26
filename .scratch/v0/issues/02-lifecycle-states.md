# 生命周期状态机

Labels: wayfinder:grilling
Type: grilling
Status: resolved

## Question

一条交接条有哪些状态、谁在何时切换？至少要回答：① 除 active / archived 外还需要别的吗（如 draft——AI 工具预生成待人确认的半成品）② 切换纯手动（画布归档按钮 / 命令）还是允许自动（检测到该会话后续无活动 N 天）③ 归档后能否重开、重开算新版本还是原地改④ 灰节点（回填）有没有状态可言，还是天然冻结。产出一张两列状态机小图放进 Answer。

## Answer

- **不自建生命周期**：lifecycle 字段取消，运行时从 sessionQuery 的 live/persisted 标记映射显示（live→进行中，persisted-only→已归档）
- 归档按钮从界面删除；按钮集缩为三个：打开原对话 / 开新对话 / 补写交接
- 实现时须验证：归档后的会话经 sessionQuery/readSession 是否仍可读；若不可读，detail() 对归档条降级提示
- 灰节点天然冻结，无状态可言
