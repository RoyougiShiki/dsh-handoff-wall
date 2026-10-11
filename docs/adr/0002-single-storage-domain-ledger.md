# 全部数据进 storageDomain 单账本，不落独立 md 文件夹

## 状态

已采纳并已实施（Accepted, implemented）——依据：`src/store.ts` 的 `boardSpec`（`defineDomain`，name `handoff_board`，version 1，threads/notes/links 三表同库）经 `ctx.storageDomain.open` 打开，数据落在单账本 `~/.dsh/storages/handoff_board.json`（README.md「使用」节末行）；src/ 内无任何 md 目录写出（`writeFileSync`/`mkdir`/`createWriteStream` grep 零命中）。ADR-0007 与 ADR-0009 说的「独立表」按本件口径仍是同一 storageDomain 账本内加表（两篇都没有另立存储的决定），属沿用而非推翻本件。本件登记的雾区「导出 md 目录再挂 doc-atlas 知识面」至今未做，仍在 `.scratch/v0/spec.md` 的雾区清单里。

交接条正文与线程索引进 `ctx.storageDomain`（单 json 文件、原子重写、版本校验），而不是"每条一个 md 文件 + 自管 index.json"。触发重估的原始方案是混合式（官方账本存目录、md 存正文供人翻阅与 doc-atlas 扫描）。

用户否决混合式的理由：非工作区路径的文件在 agent 界面里不可见，手动翻目录麻烦；人的消费入口就是插件界面与 AI 工具（read_handoff/board），文件可读性是伪需求。

## Considered Options

- **混合（被否）**：账本 json + 正文 md 文件夹——换来 doc-atlas 第〇档握手（目录即知识面），代价是多一套路径约定
- **全文件系统自管**：绕开宿主 API 自己保证原子性——纯劣势
- **全官方账本（采纳）**：最简、事务可靠、AI 与界面即全部消费者

## Consequences

- doc-atlas 的"目录当知识面"握手不成立；日后若需要，走「导出 md 目录」命令再挂知识面（已登记雾区）
- 账本是单文件：体量预期为数百 KB 级（每条约 2KB），远未触及写放大担忧
