---
document_type: implementation-plan
version: v1.14
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-19
---

# v1.14 Windows x64 实施与验收计划

## Checkpoint 0：v1.13 集成与版本治理

- [x] 将已发布的 v1.13 main 合入 Windows worktree，保留双方语义；
- [x] 冻结产品版本 v1.13，建立唯一 current v1.14 与 Data Contract v1.14/schema 52/Migration 97；
- [x] 保留 v1.12 AgentRun 局部停止和 v1.13 实际 Runtime 模型观测、Migration 96 与 Read Model schema；
- [x] 继续采用 [v1.05 Windows 决策记录](../v1.05/decisions.md)和当前 Windows Contracts，不把历史
  v1.05 状态当作实施事实；
- [x] 完成本版所有代码后的 macOS 基线、Windows x64 交叉编译、文档全门禁和 base-aware CI 检查。

## Checkpoint 1：平台、进程与私有文件系统

- [x] 建立 Windows x64 compile baseline、平台 local IPC seam、target-aware sidecar staging 与 native frame；
- [x] 建立 Runtime platform admission、native executable resolver 与集中 managed process launcher；
- [x] 实现创建时 Job/handle list 原子启动及 owner-loss cleanup 测试；
- [x] 实现 Core/Desktop 私有 data root、local NTFS/DACL admission 与 handle-relative Attachment；
- [ ] 在 Windows 10 22H2/11 真实环境完成进程 race、DACL、reparse、long-path 与 lifecycle 验收。

## Checkpoint 2：Skill Library 与 crash-recoverable Projection

- [x] 实现 Windows logical-mode Skill import、bundled bootstrap、私有 Library copy 与完整 digest 重验；
- [x] 实现 schema 2 journal、同父 staging/final/backup、多阶段恢复与 operationId DB 幂等；
- [x] 将 NTFS entry identity 写入 journal/observation，并在 replace/delete/recovery 前与 digest、DACL 一起验证；
- [x] 实现持久 `agent_run + execution_epoch + root_identity` registration 和 active Run 延迟更新；
- [x] 覆盖 publish/replace/remove、Git exclude、project-owned drift、identity drift、ambiguous recovery 与全 transition crash injection；
- [ ] 在固定 Windows CI 执行全部 Windows Skill projection lifecycle/crash tests，并保留通过证据。

## Checkpoint 3：Transport、Renderer 与 Desktop 行为

- [x] 将 `rovai` CLI 与 compaction hook 统一到同一异步 Local IPC client，Windows 与 Unix 共用 framing、超时、
  重试和 outcome-indeterminate 分类；
- [x] Named Pipe 每个实例使用 session logon SID + SYSTEM protected DACL，并在创建后回读 DACL；覆盖
  first-instance、non-inheritable handle、partial byte frame、listener replenish、busy retry、malformed 与 response-loss；
- [ ] 在固定 Windows CI 实跑 Named Pipe v16 matrix，并补齐 wrong token、stale lease、idempotent replay 与
  compaction hook 的完整端到端证据；
- [ ] 对照现有 macOS 页面实现同组件树的 frame、shortcut、copy、Explorer、路径与 Runtime availability 差异；
- [ ] 完成 Forced Colors/High Contrast、keyboard-only、NVDA、中文 IME、DPI/zoom/Snap/multi-monitor 验收；
- [ ] 用 Windows Interaction Delta HTML 作为差异清单，不以原型替代现有 macOS 视觉真源。

## Checkpoint 4：打包、升级与发布安全

- [ ] 完成 target-isolated resources、x64 per-user NSIS、三个 PE 与 longPathAware manifest；
- [ ] unpacked/installer verifier 校验架构、资源、manifest、hash 与 Core ready；
- [ ] clean-user install/start/uninstall、data 保留、显式删除和 planned-shutdown upgrade 通过；
- [ ] 完成 Electron/Core/CLI/installer Authenticode、RFC 3161 timestamp 与 release signer/hash 验证。

## Checkpoint 5：逐 Runtime 资格与最终发布

- [ ] 十个 Adapter 分别完成 Windows 10 22H2 与 Windows 11 的 immutable digest-bound evidence；
- [ ] 未完成 Adapter 保持 `not_qualified` 且不可 discovery/check/install/select/migrate/execute；
- [ ] macOS 全 Runtime、Transport、process-group、打包和 Renderer 回归通过；
- [ ] 发布 support matrix、安装/升级/故障排查与已知限制后，才更新 Root README 并关闭 v1.14。

## References

- [v1.14 版本概览](README.md)
- [v1.05 历史设计快照](../v1.05/README.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md#历史-adr-索引)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
