# 存储位置与多项目键控

Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 09, 10

## Question

交接条库放在哪、怎么按项目分？

背景事实（来自两票侦察）：宿主有现成 ctx.storageDomain（json 单文件、原子重写、~/.dsh/storages/<name>.json，机器友好但人不便直读）；也可以 host 侧直接 fs 写独立 md 文件夹（人能双击打开、doc-atlas 第〇档握手靠它成为知识面）。FleetingEcho 的项目键控（git 根两级探测→pathSlug 折叠→meta.json 认主防碰撞）可直接移植。

要决定：① 索引进 storageDomain、正文 md 另落一个人类可浏览文件夹的混合方案，还是全进 domain，还是全文件系统② 目录要不要按项目分（多项目键控抄不抄 FleetingEcho 方案）③ md 文件夹的根路径选哪（~/.agent/handoff-wall/? ~/.dsh/下? 其他）④ 这个选择如何影响 doc-atlas 第〇档握手。

## Answer

- **全进 ctx.storageDomain**（单 domain json，原子重写），每张条的六段正文存表内 text 字段
- 用户理由：非工作区路径的文件在 agent 界面里看不见、手动翻文件夹麻烦；消费入口就是插件界面与 AI 工具
- 后果：doc-atlas「目录即知识面」握手不成立→雾区改为备选方案「导出 md 目录命令」（见地图）
- 多项目键控保留：threads.projectKey，slug 算法移植 FleetingEcho pathSlug
