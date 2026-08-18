---
document_type: contract
name: Runtime Launch and Verification
version: v4
status: accepted
source_version: v1.01
last_updated: 2026-08-17
---

# Runtime Launch and Verification v4

本合同继承 v3 的 light discovery、按需深检、manager-owned attempt、Probe process owner、TRAE
execution-deferred verification、ACP continuation、Prompt fence 与 response-only input ACK，并按
[ADR-0207](../versions/v1.01/decisions.md#adr-0207)冻结 TRAE/Kiro 的队员权限默认与
Kiro Host 启动映射。

## 1. Member permission defaults

`memberRuntimeDefaults.permissions` 只能由 Core Adapter policy 生成。Renderer 选择 Runtime 时复制该值作为
新 draft；`PermissionOptionDescriptor.recommendedValue` 不得替代它。

当前十 Runtime 默认值为：

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
| Antigravity | `{"mode":"accept-edits","sandbox":"off","dangerously_skip_permissions":"on"}` |

后台 discovery、refresh、Probe、migration 和 capability drift 不得创建成员配置或把已有值改成以上默认。

## 2. TRAE installed-unverified configuration

TRAE 的静态 `installed_unverified` descriptor 固定为：

```ts
{
  key: 'permission_mode',
  choices: ['default', 'bypass_permissions'],
  recommendedValue: 'default',
  scope: 'host',
  required: true
}
```

该 descriptor 允许 Runtime-default model 与上述两个权限值原子保存；新 draft 选择
`bypass_permissions`。它只拥有配置与 admission 语义，不证明当前 CLI Session 实际广告该 mode。

首次真实 AgentRun 必须把保存值传给唯一 TRAE Host：

```text
traecli acp serve --permission-mode <saved-value>
```

同一 Host 的 Session 结果必须建立 Ready snapshot。若动态 mode catalog 不含保存值，现有
`runtime_permission_value_invalid`/`needs_attention` 语义生效，不改写保存值，也不启动 replacement Probe。

## 3. Kiro trust-all configuration

Kiro 的静态和 Ready descriptor 固定为：

```ts
{
  key: 'trust_all_tools',
  choices: ['off', 'on'],
  recommendedValue: 'off',
  scope: 'host',
  risk: 'dangerous',
  required: true
}
```

`on` 的真实执行命令为：

```text
kiro-cli acp --agent rovai --trust-all-tools
```

`off` 不传 `--trust-all-tools`。Health Probe、显式 Runtime Check 和 light discovery 永远使用 `off`。
当 `permissionSemantics=core_enforced_v1` 且 Workspace 为 `read_only` 时，即使保存值为 `on`，该次 Host
也不得传 `--trust-all-tools`。保存配置不变。

`trust_all_tools` 是 Host-scoped 值，必须进入 `hostConfigDigest`，不得进入 Session-only binding digest。
不同值不能命中同一 resident Host。

## 4. Permission schema drift

Light discovery 只可在以下条件全部成立时保留既有 Ready snapshot：

```text
same executable path
AND same executable fingerprint
AND same Adapter permission schema digest
```

permission schema digest 改变时，Core 用新的 `light_ready`（TRAE 仍用 `installed_unverified`）替换旧 Ready，
不增加 Installation generation，也不自动深检。旧成员配置继续持久化；静态状态先投影 verification-deferred，
深检建立新 Ready 后必须通过新 descriptor 验证。缺少新 required field 或保存值不再存在时投影
`needs_attention`，由用户显式重存。

## 5. Unchanged v3 boundaries

- launch purpose、两路深检并发、attempt identity、90 秒 deadline 与 process-tree cleanup 不变；
- TRAE 只允许真实 AgentExecution，检查与诊断不启动 `traecli`；
- `light_ready`/`installed_unverified` 不成为认证、模型、Session 或 capability evidence；
- Adapter-specific read-only narrowing、外部 MCP、Prompt fence、input ACK 与 continuation 不变；
- wire request/event 名称和数据库表结构不变，本合同不要求 clean break migration。

## References

- [Runtime Launch and Verification v3（历史）](runtime-launch-and-verification-v3.md)
- [ADR-0207](../versions/v1.01/decisions.md#adr-0207)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Runtime compatibility evidence](../runtime-compatibility.md)
