---
document_type: contract
name: Camp Open Projection
version: v11
status: accepted
source_version: v1.37
last_updated: 2026-08-31
---

# Camp Open Projection v11

v11 replaces [v10](camp-open-projection-v10.md)。所有既有集合、high-water、分页、coverage、channelSource、
Fast 和文件变化语义不变；Snapshot/Open 只增加可选 `agentRunImages`，字段与只读规则由
[Runtime Images v1](runtime-images-v1.md) 拥有。新 reader 将缺失视为 `[]`，旧 reader 可忽略，
所以 Snapshot schema 34 / Open schema 5 保持不变。此字段不进入 Agent 模型 Context。

图片入库后按 `agent_run.images.updated` 中的 campId 刷新当前 Camp；相同 global sequence 也可接受
新的图片元数据，不能因为没有新增 CampMessage 就拒绝这次只读投影。
