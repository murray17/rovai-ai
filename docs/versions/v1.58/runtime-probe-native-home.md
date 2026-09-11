---
document_type: implementation-plan
version: v1.58
lifecycle: historical
authority: implementation-status
status: completed
last_updated: 2026-09-11
---

# 普通 Runtime Probe 使用原生 Home

用户确认本次只取消 Grok BYOK、Kimi Code 和 Kiro CLI 普通 Probe 的额外临时 Home，保留临时 cwd、
进程清理、非交互认证及原有协议。正式 AgentRun 已使用原生 Home，本次不修改其启动语义。
当前合同为 [Runtime Launch and Verification v38](../../contracts/runtime-launch-and-verification-v38.md)，
当前边界见 [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md#native-home-probes)。

## 修改与保留项

- `health::run_acp_probe` 不再覆盖 `GROK_HOME`、`KIMI_CODE_HOME`、`KIRO_HOME`；通用 `HOME` / `USERPROFILE`
  继续继承。Grok 认证方法选择和原生环境注入、Kimi 模型 overlay 保持现状。
- 删除只供 Grok Probe 使用的配置复制 helper；不复制配置或凭据，也不迁移或清理用户原生 Session。
- 保留 Probe 自有 cwd、Kiro `.kiro/agents/rovai.json`、非交互认证、无消息 Session 创建/恢复/模型校验、
  `RuntimeProbeProcess` 超时及子进程清理。
- 本次没有 Renderer、运行时界面文案/字段/操作或模型输入改动，无需 UI 验收或模型上下文 revision。
- 本次是局部可逆的启动环境修正，不单独新增 Version Decision；已冻结合同保留，当前合同递增为 v38。

## 继续独立评估的差异

| 差异 | 当前用途 | 本次处理 |
| --- | --- | --- |
| Kiro additive agent | 临时 Agent 配置和 `--agent rovai` 追加 Rovai MCP，保留原生 MCP 来源 | 保留；后续单独评估默认 Agent、工具与资源行为 |
| Kimi 专属配置入口 | `~/.config/rovai/kimi-code.env` / `ROVAI_KIMI_CONFIG` 向目标子进程注入 `KIMI_MODEL_*` | 保留；后续单独评估官方配置来源，不改优先级或迁移凭据 |
| Pi `prompt.images` | Pi 既有结构化图片投递 | 不在本次修改范围内 |

## 回归 owner 与测试准入

退役 `acp::tests::grok_byok_probe_copies_official_config_without_copying_the_env_file`，因为配置复制 helper 和
对应生产合同同时退出；官方密钥文件权限和 allowlist 仍由已有 Grok 配置测试拥有，不删除其安全 case。

新增唯一 owner `health::native_home_probe_tests::acp_probes_keep_native_homes_without_prompting`。它验证跨进程的实际 Home 继承、
非生成 RPC 边界和临时资源所有权，不能用仅检查常量或 argv 的纯函数测试代替。现有 Grok resume 正负
用例和通用 Probe 后代清理测试分别继续拥有恢复 wire 与进程回收边界，无同等的环境继承 owner。

矩阵为 Grok BYOK/account、Kimi、Kiro × 原生变量设置/未设置 × Session 初始化成功/失败。每个 case 在新
测试进程内使用独立假 Home、假凭据和假 Runtime，不修改测试宿主的全局环境，不接触用户配置或联网。
断言包括：Home 原样继承、Kimi/Grok 子进程 overlay 保留、Grok headless auth 选择正确、Kiro additive Agent
保留、没有 Prompt/compact/标题/工具请求、成功和失败都清理 Probe cwd 且保留原生配置。
隔离子测试放在 `health/native_home_probe_tests.rs` 中，避免测试夹具的环境清空被生产 Runtime 入口静态门禁误判；
不修改该门禁或增加例外。
修复前 Kimi/Kiro override 及 Grok BYOK 临时 Home 分支会使 Home 对比失败。可执行测试数净变化为 0。

最小命令：

```bash
cargo test -p rovai-core --bin rovai-core health::native_home_probe_tests::acp_probes_keep_native_homes_without_prompting
```

## 验证结果

| 实际执行 | 结果 |
| --- | --- |
| 定向跨进程回归 | 1 个 owner 通过，覆盖上述 16 种组合 |
| `cargo test -p rovai-core --bin rovai-core` | 236 通过、0 失败、5 个既有 ignored |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |
| `pnpm docs:test` | 10 通过、0 失败 |

文档通用门禁随最终文档内容执行并记录在本次 worktree 的外部验证证据中；不为此新增 checker 例外。
本次未执行真实 Grok/Kimi/Kiro、真实模型调用、Windows 运行或 UI 验收，不新增平台资格和真实认证成功声明。
确定性回归的子进程全部使用隔离假 Home 和假 Runtime；这不改变普通用户 Probe 沿用原生环境的产品行为。
