---
document_type: contract
name: Camp Open Projection
version: v10
status: accepted
source_version: v1.36
last_updated: 2026-08-31
---

# Camp Open Projection v10

v10 replaces [v9](camp-open-projection-v9.md)。有界集合、事务 high-water、历史分页、membership、
非终态 Evidence、文件变化与可选 member.fast 不变。

CampSnapshot/Open 的 `camp` 与 NavigationCampItem 增加可选 `channelSource`，来源、组合与
只读展示规则由 [Channel Camp Naming v1](channel-camp-naming-v1.md) 拥有；`title` 始终是未加渠道前缀的原始标题。
读取只在既有事务连接已有绑定，不访问网络，不写数据库。闭合绑定也参与投影。

字段为 additive：旧 reader 可忽略，新 reader 接受缺失/null。因此 Navigation schema 3、
Snapshot schema 34 / Open schema 5 不变；消息、coverage、cursor、Fast 资格及执行输入均不改变。
