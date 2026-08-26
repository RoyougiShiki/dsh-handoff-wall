# index 与正文的字段级 schema

Labels: wayfinder:grilling
Type: grilling
Status: claimed
Blocked by: 02, 03

## Question

定稿数据模型：① storageDomain 的 zod 表设计——threads 表（id、title、projectKey、createdAt…）与 nodes/entries 表（id、threadId、parentSession、sessionId、createdAt、lifecycle、provenance(curated/raw)、files[]、summary、mdPath…）逐字段过一遍② 每节点 md 文件的命名规则与 frontmatter 字段（和索引重复的字段谁是权威、不同步了听谁的）③ 灰节点的字段差异（置信度标注、来源时间窗）④ 版本迁移策略：spec.version 从 1 起，什么改动允许原地升版本。

产出：字段表贴进 Answer，作为 04 之后所有实现的唯一依据。

## Proposed Answer（草案，待用户过目）

### storageDomain spec

```
name: "handoff_board", version: 1
tables:
  threads:
    id          string   uuid
    title       string   线程名（默认取首条的会话标题）
    projectKey  string   FleetingEcho pathSlug(项目根)
    createdAt   number   ms
  notes:
    id              string   uuid
    threadId        string   →threads.id
    sessionId       string   被总结的会话
    parentSessionId string?  接续来源（线程首条可空）
    createdAt       number   ms
    title           string   列表短标题
    body            string   六段 md 全文
    files           string[] 关键文件路径
    provenance      enum     curated | raw（v0.1 只产 curated，raw 预留）
```

- **不存 lifecycle 字段**：显示态由 sessionQuery 的 live/persisted 实时映射（票02 决定）
- 单表无嵌套；thread 首条 note 的 parentSessionId 为空即线程锚点
- 版本迁移：仅允许"加可选字段"原地升 patch；破坏性改动必须 version+1 写迁移
