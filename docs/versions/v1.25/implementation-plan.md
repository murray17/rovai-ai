---
document_type: implementation-plan
version: v1.25
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-22
---

# v1.25 Codex 最终 Camp 答案发布指导实施验收计划

## 1. 模型上下文确认门禁

- [x] 从真实 Codex AgentRun 核对 `rovai send` 单段摘要与后续 Markdown Runtime final 的双输出差异；
- [x] 固定 Codex-only exact guidance、过程消息不变边界、evidence owner 与 compatibility 策略；
- [x] 开发者阅读完整 revision 1 后二次确认；
- [x] 确认记录与文档门禁通过后才修改 Rust、版本轴或当前长期权威。

## 2. Codex Charter 与 Native Binding

- [x] 在 `ContextService` 构建 Session Charter 时只为 `AdapterKind::CodexCli` 追加 exact guidance；
- [x] 保持共享 `charter-rovai-cli.md` bytes 与所有非 Codex Charter bytes 不变；
- [x] 在 Codex Binding compatibility 中冻结 `codexSessionGuidanceRevision: 1`，不提升共享
  `sessionCharterRevision`；
- [x] 正常 start/resume 与 replacement thread 都只传递 Core-prepared、已取证 Bootstrap payload；
- [x] 历史 Bootstrap Evidence 不重写，既有 Codex Binding 不承载新 guidance。

## 3. 验证与交付

- [x] exact Charter snapshot 覆盖 Codex inclusion、单次出现与所有非 Codex omission；
- [x] Bootstrap Evidence blob/digest 覆盖新句，Codex legacy/current Binding digest 不同且非 Codex digest 不变；
- [x] start/resume/replacement request 验证 `developerInstructions` 与 prepared payload 一致，无调用点 suffix；
- [x] Rust fmt、定向单元测试、PR Rust gate、严格 library Clippy、文档门禁与 Desktop build 通过；
- [ ] workspace all-targets Clippy 恢复绿色；当前仅被未改动的 `antigravity.rs` 既有
  `large_enum_variant` 与 `collapsible_if` lint 阻塞；
- [ ] 使用隔离 `userData` 运行多次真实 Codex AgentRun，记录 Camp final 的 Markdown 质量观察；
- [x] 按本地工作流构建、验签、隔离启动验证并以非终止方式交接 macOS App；当前旧日常进程未重启，
  新版本将在用户稍后从规范安装路径启动时生效。

## References

- [v1.25 版本概览](README.md)
- [模型上下文变更 revision 1](model-context-change-codex-final-camp-answer.md)
- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
