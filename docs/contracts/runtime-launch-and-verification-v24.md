---
document_type: contract
name: Runtime Launch and Verification
version: v24
status: accepted
source_version: v1.27
last_updated: 2026-08-23
---

# Runtime Launch and Verification v24

v24 replaces [v23](runtime-launch-and-verification-v23.md). v23 的用户原生 Runtime Home、Probe 隔离、
Kimi warm/cold continuation、External MCP、Cursor 默认隐藏及逐平台准入边界保持不变；本版把 Kimi 新队员的
Product permission default 从 `default` 修正为原生最高权限 `yolo`，并冻结十二种 Runtime 的统一最高权限默认。

## Product permission default 所有权

`memberRuntimeDefaults.permissions` 只能由 Core Adapter policy 生成。Renderer、Onboarding 和成员 Runtime
切换只复制该值建立新 draft；`PermissionOptionDescriptor.recommendedValue` 是保守的 descriptor 提示，不得
替代 Product default。

当前十二种 Runtime 的新 draft 默认值为：

| Runtime | `permissions.values` |
| --- | --- |
| Codex CLI | `{"sandbox_mode":"danger-full-access","approval_policy":"never"}` |
| OpenCode | `{"permission":"allow"}` |
| GitHub Copilot CLI | `{"allow_all":"on"}` |
| Claude Code | `{"permission_mode":"bypassPermissions"}` |
| Kiro CLI | `{"trust_all_tools":"on"}` |
| Qoder CLI | `{"permission_mode":"bypass_permissions"}` |
| CodeBuddy | `{"permission_mode":"bypassPermissions"}` |
| Qwen Code | `{"approval_mode":"yolo"}` |
| TRAE CLI CN | `{"permission_mode":"bypass_permissions"}` |
| Cursor Agent | `{"execution_mode":"agent","approval_policy":"force"}` |
| Kimi Code | `{"permission_mode":"yolo"}` |
| Antigravity | `{"mode":"accept-edits","sandbox":"off","dangerously_skip_permissions":"on"}` |

这些值只定义用户显式选择 Product Runtime 时的新配置默认。Background discovery、refresh、Probe、migration、
schema drift 和 App upgrade 不得新建成员配置，也不得把已有成员的保存值静默扩大为本表值。用户保存的较窄
模式继续按 exact-version 配置执行，直到用户显式切换或保存。

最高 Runtime-native 权限不取消 Core 自己拥有的边界：产品私有路径、凭据、Binding、Camp/附件授权、
Built-in IPC、execution fencing 和平台准入继续 fail closed。`CoreEnforcedV1 + read_only Workspace` 仍按各
Adapter 的既有规则收窄实际启动或 Session 值，保存配置本身不被改写。

## Kimi `yolo` 映射

Kimi descriptor 继续公开 `default | plan | auto | yolo`，其中保守 `recommendedValue` 保持 `default`。
新成员或显式切换到 Kimi 时，Core 生成 `permission_mode=yolo`。Writable AgentRun 在 `session/new`、
`session/resume` 或 `session/load` 建立目标 Session 后，通过标准 ACP `session/set_config_option` 把
`mode=yolo` 投递给该 Session；read-only AgentRun 的 effective value 固定为 `plan`。

`default`、`auto` 与 `plan` 仍是有效的用户保存值，不做数据迁移或自动扩权。Capability/Deep Probe 可以使用
无副作用的保守模式；Probe 的权限选择不定义 Product member default，也不能替代真实 writable AgentRun 验证。

## Acceptance

- Core 对全部十二种 `AdapterKind` 生成上表唯一 exact default，Kimi 为 `permission_mode=yolo`；
- Renderer 从 Core `memberRuntimeDefaults` 建立 Kimi draft，并显示选中的 `yolo`，不从
  `recommendedValue=default` 重建默认；
- 真实 writable Kimi AgentRun 接受 `mode=yolo` 并完成 Runtime Tool；read-only 路径仍投递 `plan`；
- 已保存为 `default`、`auto` 或 `plan` 的 Kimi 成员在 discovery、重启和升级后保持原值；
- Probe、Runtime Check 与 background discovery 不因本合同启用自动副作用或成员扩权；
- 其他十一种 Runtime 的 Product defaults、read-only narrowing、Host compatibility 与启动映射不发生变化。

## References

- [Runtime Launch and Verification v23](runtime-launch-and-verification-v23.md)
- [Runtime Launch and Verification v4](runtime-launch-and-verification-v4.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime 平台安全不变量](../architecture/foundational-invariants.md#runtime-platform-security)
- [Kimi Code Runtime Research](../research/kimi-code-runtime-research.md)
