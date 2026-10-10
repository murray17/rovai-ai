---
document_type: research-report
status: implemented
last_updated: 2026-10-11
---

# 队员环境变量验收

实现合同为 [Runtime Launch v57](../contracts/runtime-launch-and-verification-v57.md)。本轮平台为 macOS arm64；
所有进程使用独立目录、合成凭据或 loopback 服务，没有访问日常 Core 数据、原生账号或真实模型服务。

## 实际 Claude Code

`python3 scripts/probe-claude-member-environment.py --claude <absolute-cli-path>` 对已安装的
Claude Code **2.1.287** 启动两个并行进程，共享安装和同一份隔离原生设置。

- A 使用 `ANTHROPIC_API_KEY`，B 使用 `ANTHROPIC_AUTH_TOKEN`，各有自己的 URL 和模型。
- 原生设置故意包含错误地址、Auth Token、模型、Vertex 开关和 `apiKeyHelper`。
- 两个端点各收到一个 `/v1/messages?beta=true` 请求；A 只有预期 API Key，B 只有预期 Bearer Token；
  模型分别匹配，各进程正常退出并收到 `fixture-ok`。
- 另一次双 API Key 对照也通过。脚本校验所有请求，不能用一次正确请求掩盖其他串用请求。

这证明上述版本的原生覆盖防护与两种静态认证头，不能推断所有旧版本、托管政策或其他 Runtime 的原生优先级。
脚本只记录匹配布尔值；CLI 输出和凭据不进入公共报告。版本保护范围与缺少凭据时的拒绝由合同定义。

## Core、进程和 Warm

`cargo build -p rovai-core --bins` 后运行 `node scripts/smoke-member-environment.mjs`。
生产 Core RPC 已覆盖私有读取/遮蔽、队员和 Runtime 作用域、命令幂等、Profile/环境原子 CAS、地址确认、
模型冲突、旧 Runtime 保存和检查拒绝、重启恢复、删除覆盖及 SQLite 密文存储。

扩展 Rust owner 验证真正的 ManagedProcess 子进程并行传递字面量、不改变父进程、不用队员 PATH 选择 CLI、
冻结配置跨重启重试、丢失 key 不回退、Migration 191 receipt 故障整体回滚、归档确认与程序路径修改互不影响。
Claude 现有进程 owner 另验证实际 Adapter 收到冻结环境、凭据只进入私有 settings、原权限参数保持、错误脱敏。

既有 fleet owner 的模拟 Host 验证 Pi 原工作区跨 Camp/队员范围不变，相同摘要复用、不同摘要分开。
这是 fleet 与真实子进程边界的分层证据；没有声称本轮已完成所有 warm Runtime 的真实 Provider 端到端验收。

## 界面与回归

浏览器 fixture 使用生产 MemberRuntimeForm 和 LegacyEnvironmentIssue：初始 104px、内容增长至 360px、
清空收缩、无 focus outline/shadow、保存后密钥遮蔽、中英文切换、旧配置显隐与人工确认均通过。
390px 移动视口无横向溢出，JSON 字号为 16px。fixture 没有启动 Electron 或访问日常数据。

已执行 typecheck、五个相关 Vitest 文件（25 项）、Desktop/Web 构建、Rust workspace 默认回归（465 项通过、
1 项既有人工测试忽略），以及环境、迁移、原生配置保存、Check Manager、Warm、Claude、Antigravity 定向回归。
Windows 大小写规则有解析覆盖；Windows 真机、打包安装和各 Runtime 原生账号优先级不属于本轮实测结果。
