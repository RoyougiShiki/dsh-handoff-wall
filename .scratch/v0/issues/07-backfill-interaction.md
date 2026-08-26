# 灰节点回填交互

Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 09, 10

## Question

没写过交接条的时段，从原始日志现场挖粗节点的交互定稿：① 入口有哪些（列表页按钮？命令 /backfill？AI 工具 backfill(since)?）② 提取范围怎么表达（最近 N 天 / 指定会话 id 列表 / 全部缺口一键扫）③ 机械提取哪些字段（标题截断、活跃起止、碰过的文件集合——zstd 多帧解码方案已验证可行）④ 低置信度如何在列表和画布上展示（灰色徽章？斜体？）⑤ 回填产物能不能被人工确认后转正为 curated（还是永远保持 raw 血统）。⑥ v0.1 要不要包含回填，还是进雾区。
