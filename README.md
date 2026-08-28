# @dsh-external/dsh-handoff-board

DSH 会话间上下文交接与线程时间线可视化插件：换班写交接条，串成时间线，人和 AI 都能翻。

## ⚠️ 安装/卸载必读

**铁律与正确流程在工作区根目录 [../AGENTS.md](../AGENTS.md)**（所有会话自动加载）。速记：

- 开发/调试期只用 super-injector 三件套（inject / uninject / clear-routes）
- 禁止 `dev_install_package`、禁止手改 `~/.dsh/profiles/**`
- 任何情况不重启 dsh-web
- 正式转正：`dsh plugin --profile web add link:/mnt/f/AIProjects/dsh-plugins/dsh-handoff-wall`

## 使用

| 动作 | 做法 |
|---|---|
| 生成交接条 | 任意会话输入 `/handoff`；或让 AI 调 `write_handoff`（可传 session_id 为暴毙会话补条） |
| 看板 | 主区视图切到「📌 交接板」（排在对话/轨迹之后）：🧭 竖向时间线 + 右侧详情栏（单视图，已去掉列表模式） |
| 打开原对话 | 「↗ 打开原对话」跳回来源会话 |
| 补写交接条 | 未交接的会话：点会话树行，详情里「⚡ 补写交接条」 |
| 重新生成 | 已有交接的卡片：点开详情，「↻ 重新生成」用当前会话最新内容覆盖本条 |
| AI 查历史 | 让 AI 调 `board` / `read_handoff`；改文件前让它 `who_else` 撞车检查 |

数据存于宿主账本 `~/.dsh/storages/handoff_board.json`。界面底部「❓ 使用说明」可折叠展开。

## 文档

- 术语表 [CONTEXT.md](CONTEXT.md) · 决策记录 [docs/adr/](docs/adr/)
- 实现契约与验收脚本 [.scratch/v0/spec.md](.scratch/v0/spec.md)
- wayfinder 地图与决策票 [.scratch/v0/](.scratch/v0/)

## 构建

```bash
bash scripts/build.sh   # 双模式自动探测依赖来源
```
