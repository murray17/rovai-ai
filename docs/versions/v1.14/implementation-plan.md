---
document_type: implementation-plan
version: v1.14
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-08-19
---

# v1.14 实施与验收计划

## 1. 合同与版本切换

- [x] 冻结 Camp History Retrieval v4 与 Built-in Tool Transport v17；
- [x] 建立 V1.14-D01，冻结 v1.13 并切换唯一 current version；
- [x] 更新 Built-in/History/Camp Identity 架构与文档路由，记录模型上下文不变。

## 2. CLI 与 Catalog

- [x] 在三种输入源汇合后、canonical Schema 校验前补全 Timeline 默认；
- [x] 保持 message-anchored mode 显式，并为冲突字段提供定向 `fix_input`；
- [x] 更新 exact help、operation description、Transport/History version 与 Runtime capability。

## 3. Skill 教学

- [x] 更新 `cli-operations` 路由与 Camp/History reference；
- [x] 保持 Session Charter 与 `agents/openai.yaml` 不变。

## 4. 验证

- [x] 通过 Rust format、CLI/transport/history 测试与严格 Clippy；
- [x] 通过 Skill quick validation、Skill tests/checks 与文档 tests/checks/CI diff gate；
- [x] 通过 smoke JavaScript/generated-shell 语法检查，以及 bare/explicit/stdin/input-file 默认补全验收。

完整十 Runtime `pnpm smoke:builtin-cli` 会实际调用上游模型，本版收口未把它作为非模型门禁执行；脚本已加入
四种默认调用路径，后续真实 Runtime qualification 可复用同一入口。

## References

- [v1.14 版本概览](README.md)
- [V1.14-D01](decisions.md#v1-14-d01)
- [Camp History Retrieval v4](../../contracts/camp-history-v4.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
