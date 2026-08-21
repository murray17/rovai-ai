---
document_type: implementation-plan
version: v1.24
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-21
---

# v1.24 Windows x64 本机实现与 Runtime 复核计划

## 1. 最新 `main` 集成

- [x] 在可恢复的 `codex/windows-x64-adaptation` 分支保存 Windows 改动；
- [x] 获取并合入 `origin/main@645994cc`，不使用 reset/stash 覆盖本地工作；
- [x] 保留 v1.23 为 historical，并把 Windows current scope 迁到 v1.24；
- [x] 按 Built-in Transport v20、Probe supersession、Attachment View、Runtime Files Root 与法律文件门禁解决重叠；
- [ ] 合并后通过 Rust fmt/Clippy、TypeScript、Node/Vitest、Rust PR、文档和 diff 门禁。

## 2. Windows build、package 与 installation

- [x] 合并前完成 Rust PR profile、前端/Node tests、native x64 unpacked/NSIS build 和 release verifier；
- [x] 合并前完成 clean install/start/same-version upgrade/uninstall/data-preserve；
- [x] 合并前以真实 Claude Runtime 完成 packaged planned shutdown、7-descendant Job cleanup 与重启恢复；
- [x] 把上游外置 legal payload 生成、复制与完整性门禁接入 Windows unpacked/NSIS 命令；
- [ ] 在最新 `main` 合并结果上重新执行 build、NSIS、verifier、legal payload、installer lifecycle 和 planned shutdown；
- [ ] 在 Windows 11 client OS 重跑并保存发布证据；
- [ ] 完成 Authenticode、RFC 3161 timestamp、release signer/hash allowlist 与 SmartScreen 证据。

## 3. 十 Runtime 本机矩阵

- [x] 安装/探测 Codex、OpenCode、Copilot、Claude、Antigravity、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE；
- [x] 完成账号登录或 API-key 配置；DeepSeek 路径固定为 `deepseek-v4-flash`；
- [x] 合并前完成真实 ACP、Approval、Built-in CLI、Missing-Send、MCP Projection 与适用 Skill smoke；
- [x] 修正 CodeBuddy 官方 API-key ACP、显式 custom model、Idle `usage_update`/private command metadata；
- [x] 修正 warm Runtime 文件 handle 下的 Windows Skill 投影即时 unlink，并完成 Qwen→TRAE 边界回归；
- [x] 修正 CodeBuddy 环境下 native `--input-file` Win32 path、resume evidence path 与 Missing-Send
  PowerShell/cmd Tool 投递；
- [ ] 在最新 `main` 合并结果上按 Built-in Transport v20 重新执行可用 Runtime 全矩阵；
- [x] 按用户要求验证 Groq/Gemini 替代线路并记录真实边界：OpenCode/CodeBuddy/Qwen 点测通过，Groq TPM、Gemini
  free-tier request window、Qoder/TRAE Provider/账号 quota 阻止替代线路的高频全矩阵；用户授权继续 DeepSeek 后
  恢复的路径固定为 `deepseek-v4-flash`，不回退 DK V4 Pro；
- [ ] 为每个 Adapter 分别形成 Windows 10/11 immutable digest-bound qualification evidence。

## 4. 发布与清理

- [x] 正式 Release 对所有缺证据 Windows Runtime 保持 `runtime_platform_not_qualified`；
- [ ] 删除最终复跑产生的临时登录 helper、失败 Fixture 和 sidecar backup，保留非敏感验收报告；
- [ ] 以不回显内容的扫描确认用户 API key 未进入 Git diff 或 tracked files；验收报告与诊断只保留非敏感事实；
- [ ] 全量复跑通过后将本版状态更新为 implemented；按用户最终指令不执行关机。

## References

- [v1.24 版本概览](README.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
