---
document_type: implementation-plan
version: v1.24
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-08-21
---

# v1.24 Runtime Probe v18 与 Windows x64 本机闭环实施计划

## 1. 版本与权威

- [x] 冻结已交付 v1.23，建立唯一 current v1.24；
- [x] 接受 [V1.24-D01](decisions.md#v1-24-d01) 与 Runtime Launch and Verification v18；
- [x] 同步 Runtime Architecture、基础不变量、Contract/Decision/Documentation routing；
- [x] 把 Windows 分支合入 `origin/main@217a46d4`，合并上游 v1.24 与 Windows v1.24 文档而不覆盖任一范围；
- [x] 在该最终合并结果上完成全部代码/文档门禁、Windows package 与七 ACP Runtime 复跑；其余重复 Runtime
  矩阵按用户指令停止，沿用上一 main 基线的最近完整证据。

## 2. Runtime Check Manager

- [x] 删除 identity 保护外重复的 managed-resolution version gate；
- [x] 让 Adapter version、认证、能力、协议与模型检查共同进入完整 identity 复核；
- [x] 把永久 Execution deferral 集合替换为三秒、不被 deferred 请求续期的进程内冷却；
- [x] 冷却到期后允许 Scheduler 自动建立下一次有界 attempt，Catalog/User Check 可提前清除；
- [x] manager-level fake Runtime + SQLite 覆盖 version 自替换后的 Ready commit、新 fingerprint failure 与冷却放行；
- [x] 上游 Rust、TypeScript/Vitest、Node、文档、macOS package/legal/signature 和隔离 App 验收通过。

## 3. Windows build、package 与 installation

- [x] 合并前完成 Rust PR、前端/Node tests、native x64 unpacked/NSIS、release verifier 与 legal payload；
- [x] 合并前完成 clean install/start/same-version upgrade/uninstall/data-preserve；
- [x] 合并前以真实 Claude Runtime 完成 packaged planned shutdown、7-descendant Job cleanup 与重启恢复；
- [x] 把外置 legal payload 生成、复制与完整性门禁接入 Windows unpacked/NSIS 命令；
- [x] 在 `origin/main@217a46d4` 合并结果上重跑 build、NSIS、verifier、legal、installer lifecycle 与 planned shutdown；
- [ ] 在 Windows 11 client OS 重跑并保存发布证据；
- [ ] 完成 Authenticode、RFC 3161 timestamp、release signer/hash allowlist 与 SmartScreen 证据。

## 4. 十 Runtime 本机矩阵

- [x] 安装/探测 Codex、OpenCode、Copilot、Claude、Antigravity、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE；
- [x] 完成账号登录或 API-key 配置；DeepSeek 路径固定为 `deepseek-v4-flash`；
- [x] 合并前完成真实 ACP、Approval、Built-in CLI、Missing-Send、MCP Projection 与适用 Skill smoke；
- [x] 修正 CodeBuddy API-key ACP、显式 custom model、Idle metadata 与 Windows path；
- [x] 修正 Kiro lifecycle/Skill lineage、warm Runtime handle unlink、Missing-Send PowerShell/cmd Tool 投递；
- [x] Qoder 使用官方 DeepSeek BYOK Flash 条目，直连、ACP、Built-in、Missing-Send、MCP 与 Skill 通过；
- [x] 在最终合并结果上重跑七 ACP，完整覆盖回复、固定命令输出、allow/deny 与原生会话延续；
- [x] 修正 Windows debug 本地资格开关只放行执行门、却未同步 Runtime Catalog 准入投影的问题；训练营现在只对
  显式列出的 Adapter 展示 `local-debug` qualified，正式 Release 继续忽略该开关；
- [x] 根据用户停止重复测试的指令，不再重跑九个当前可调用 Runtime 的 Built-in、Missing-Send、MCP、Skill
  与专项恢复；保留上一 main 基线的最近完整通过证据，不把本项写成最新基线复跑通过；
- [ ] Antigravity `1.1.17` 账号恢复可用 Flash quota 后重跑最终在线矩阵；当前认证成功但返回
  `429 RESOURCE_EXHAUSTED`，备用 Gemini API key 不改变账号 Code Assist quota 路由；
- [x] 记录 Groq TPM、Gemini free-tier request window、Qoder/TRAE Provider/账号 quota 等替代线路真实边界；
- [ ] 为每个 Adapter 分别形成 Windows 10/11 immutable digest-bound qualification evidence。

## 5. 发布与清理

- [x] 正式 Release 对所有缺证据 Windows Runtime 保持 `runtime_platform_not_qualified`；
- [x] 删除既有复跑产生的临时登录 helper、失败 Fixture 和 sidecar backup，保留非敏感验收报告；
- [x] 不回显扫描确认用户 API key 未进入 Git diff 或 tracked files；
- [x] 最终 secret scan 确认三个用户密钥均未进入 Git diff/tracked files；再次 fetch 后
  `origin/main` 仍为 `217a46d4`，本地不落后；
- [ ] 删除本次中止产生的一个 Built-in 与两个 planned-shutdown 隔离临时目录；精确路径已验证在系统 Temp，
  但本机安全策略拒绝递归删除，未使用跨 shell 或绕过策略的危险命令；
- [ ] Antigravity quota、Windows 11、签名与 immutable evidence 全部闭环后才把整版状态更新为 implemented；
  按用户最终指令不执行关机。

## References

- [v1.24 版本概览](README.md)
- [V1.24-D01](decisions.md#v1-24-d01)
- [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
