# MVP 范围切割与验收标准

Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 01, 04, 05, 06

## Question

「MVP 快速实现看完整效果」的可操作定义。① 最小闭环清单：哪几件事必须在 v0.1（预期核心：写条入库→列表可见→brief 接续→开新对话拿到上下文；画布是否延后到 v0.2 待议）② 明确推迟项写成 fog 毕业或 out of scope③ 验收脚本：写一份 5 分钟手测流程（装上→在测试会话 A 生成交接→新会话 B brief 拿到上下文→列表看到链条→who_else 防撞车演示），逐步可勾选④ 实现顺序建议（host 先行还是 client 先行、几个里程碑提交）。

## Answer

### v0.1 范围（全做，对应目标原文"完整闭环"）
- host：storageDomain 两表、/handoff 命令、AI 四工具、spawn 会话接续
- client：betterSidebar Tab 列表视图 + React Flow 时间线墙（talkmap 组件改造）

### 明确推迟（雾区已有登记）
灰卡回填、doc-atlas 导出命令、自定义脱敏词表、编辑已有条目、多看板管理（v0.1 固定单看板）

### 验收脚本（逐步可勾选）
1. dev_build 通过、dev_inject 成功、侧边栏出现「交接板」Tab
2. 测试会话 A 敲 /handoff → 回显六段摘要，列表出现新条目
3. 列表点「开新对话」→ 新会话首条消息含交接内容并可继续对话
4. 新会话内调 board() → 能看到该条目
5. 画布视图显示线程链（A 的条挂在线上）
6. systemctl --user restart dsh-web 后数据仍在（持久化验证）

### 实现顺序
M1 host 存储域+命令 → M2 四工具 → M3 列表视图 → M4 画布时间线 → M5 验收脚本全绿
