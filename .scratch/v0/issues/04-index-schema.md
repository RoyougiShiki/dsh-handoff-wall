# index 与正文的字段级 schema

Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 02, 03

## Question

定稿数据模型：① storageDomain 的 zod 表设计——threads 表（id、title、projectKey、createdAt…）与 nodes/entries 表（id、threadId、parentSession、sessionId、createdAt、lifecycle、provenance(curated/raw)、files[]、summary、mdPath…）逐字段过一遍② 每节点 md 文件的命名规则与 frontmatter 字段（和索引重复的字段谁是权威、不同步了听谁的）③ 灰节点的字段差异（置信度标注、来源时间窗）④ 版本迁移策略：spec.version 从 1 起，什么改动允许原地升版本。

产出：字段表贴进 Answer，作为 04 之后所有实现的唯一依据。
