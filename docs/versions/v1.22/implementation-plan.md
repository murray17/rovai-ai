---
document_type: implementation-plan
version: v1.22
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-21
---

# v1.22 Windows x64 本机实现与 Runtime 复核计划

## 1. 最新 `main` 集成

- [x] 在可恢复的 `codex/windows-x64-adaptation` 分支保存 Windows 改动；
- [x] 获取并合入 `origin/main` 的 v1.16—v1.21 共 59 个提交，不使用 reset/stash 覆盖本地工作；
- [x] 按当前 Attachment View、Runtime Files Root、Built-in Transport 与 ACP metadata 语义解决重叠；
- [x] 合并后通过 Rust fmt/Clippy、TypeScript、Node/Vitest、Rust PR、文档和 diff 门禁。

## 2. Windows build、package 与 installation

- [x] 合并前完成 Rust PR profile、前端/Node tests、native x64 unpacked/NSIS build 和 release verifier；
- [x] 合并前完成 clean install/start/same-version upgrade/uninstall/data-preserve；
- [x] 合并前以真实 Claude Runtime 完成 packaged planned shutdown、7-descendant Job cleanup 与重启恢复；
- [x] 在最新 `main` 合并结果上重新执行 build、NSIS、verifier、installer lifecycle 和 planned shutdown；
- [ ] 在 Windows 11 client OS 重跑并保存发布证据；
- [ ] 完成 Authenticode、RFC 3161 timestamp、release signer/hash allowlist 与 SmartScreen 证据。

## 3. 十 Runtime 本机矩阵

- [x] 安装/探测 Codex、OpenCode、Copilot、Claude、Antigravity、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE；
- [x] 完成账号登录或 API-key 配置；DeepSeek 路径固定为 `deepseek-v4-flash`；
- [x] 合并前完成真实 ACP、Approval、Built-in CLI、Missing-Send、MCP Projection 与适用 Skill smoke；
- [x] 修正 CodeBuddy 官方 API-key ACP、显式 custom model、Idle `usage_update`/private command metadata；
- [x] 在最新 `main` 合并结果上重新执行十 Runtime 全矩阵；
- [ ] 为每个 Adapter 分别形成 Windows 10/11 immutable digest-bound qualification evidence。

## 4. 发布与清理

- [x] 正式 Release 对所有缺证据 Windows Runtime 保持 `runtime_platform_not_qualified`；
- [x] 删除临时登录 helper、失败 Fixture 和已恢复的 sidecar backup，保留非敏感验收报告；
- [x] 以不回显内容的扫描确认用户 API key 未进入 Git diff 或 tracked files；验收报告与诊断只保留非敏感事实；
- [x] 全量复跑通过后将本版状态更新为 implemented；按用户最终指令不执行关机。

## References

- [v1.22 版本概览](README.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
