---
document_type: interface-contract
contract: diagnostics-center
version: 1
authority: diagnostics-read-repair-and-export
status: accepted
last_updated: 2026-08-18
---

# Diagnostics Center v1

本文冻结设置诊断中心的 Core Read Model、状态分类、显式修复映射与 v5 导出边界。决策理由见
[ADR-0148](../adr/0148-read-only-diagnostics-and-data-minimized-export.md)。

## 1. `diagnostics.check`

Renderer 通过无参数 Core Method `diagnostics.check` 读取：

```ts
interface DiagnosticsReport {
  schemaVersion: 1
  checkedAt: string
  summary: { ok: number; attention: number; unknown: number }
  checks: DiagnosticCheck[]
}

interface DiagnosticCheck {
  id: string
  group: 'local_dependencies' | 'managed_content' | 'agent_runtimes'
  subjectKind: string
  subjectId: string | null
  label: string
  status: 'ok' | 'attention' | 'unknown'
  code: string
  detail: string
  observedAt: string
  stale: boolean
  facts: Array<{ key: string; value: string }>
}
```

`summary` 必须从同一返回对象的 `checks` 逐项计算，三项之和等于检查总数。`attention` 才进入
“需要处理的问题”；`unknown` 只进入摘要和完整结果。Renderer 不根据文案、版本或路径补造状态。

固定机器检查范围为 Rust Core、应用数据目录、Git、SQLite `PRAGMA quick_check`、Skill 投影、MCP
配置和 Product Runtime Catalog 中当前宿主平台已 `qualified` 的 Runtime。Runtime 结果附稳定
`subjectId = AdapterKind`；
未被未移除队员选择的 Runtime 即使未安装也返回 `ok / runtime_not_in_use`。已被选择的 Runtime：

- 当前可用为 `ok`；
- 需要登录、缺失、不兼容、路径缺失或停用为 `attention`；
- 正在检测、证据不完整、瞬时刷新失败或读取失败为 `unknown`；
- 保留最近成功 Runtime 证据时 `stale = true`，并在 facts 中提供非路径的最近成功时间。

`not_qualified` 与 `unsupported` Adapter 不进入机器 health 状态，也不启动 discovery/probe；Diagnostics UI 从
[Runtime Platform Admission v1](runtime-platform-admission-v1.md)合并只读 platform row、closed reason 与 evidence
revision。它们不得被映射为 `runtime_not_in_use`、`attention`、`unknown` 或“重新检查”动作。

该 Method 只读。调用前后不得出现 Skill reconcile、MCP 初始化/权限修改、Runtime rescan/check、
SQLite 写入、登录或 Runtime replacement。Skill 检查只读取已持久化的 Observation、root-access 与
dirty 状态；不得 resolve、canonicalize、stat 或枚举任何历史 Project execution root。

## 2. 显式下一步

| 检查结果 | 唯一允许的下一步 |
| --- | --- |
| Skill `attention` | 用户点击后调用 `skills.reconcile`，完成后重读 `diagnostics.check` |
| MCP 权限过宽 | 用户点击后调用 `mcp.config.repairPermissions`，完成后重读 |
| MCP malformed / 非普通文件 | 前往 MCP 设置；不得调用修复权限或覆盖文件 |
| Runtime `attention` | 前往对应 Agent 运行时设置 |
| Runtime `unknown` | 用户点击后调用一次 `runtime.product.check` 并有界等待诊断结果 |
| SQLite / 数据问题 | 导出诊断 JSON；不得自动修改数据库 |

任何单项操作只有在复检返回同一 `id` 且 `status = ok` 后才能显示 Success。复检失败保留最近成功
报告并进入 Recovery；没有批量修复 Method 或 UI。

## 3. `diagnostics.export` / v5

Core Method `diagnostics.export` 返回唯一格式：

```json
{
  "format": "rovai-diagnostics-v5",
  "exportedAt": "RFC3339",
  "appVersion": "string",
  "redaction": {
    "absolutePaths": "removed",
    "sensitiveValues": "removed",
    "excluded": ["tokens", "cookies", "login_data", "messages", "memory_bodies", "attachment_bodies", "tool_outputs"]
  },
  "diagnostics": { "schemaVersion": 1, "checkedAt": "RFC3339", "summary": {}, "checks": [] },
  "aggregate": {
    "agentCount": 0,
    "currentAgentCount": 0,
    "configuredRuntimeMemberCount": 0,
    "campCount": 0,
    "runtimeCatalogCount": 9
  }
}
```

对象只由 typed report 和上表 allowlisted count 组成，随后整体通过同一个 Core redaction 函数。
任意层级的敏感 key value 与绝对 POSIX、Windows drive 或 file URL 路径都必须替换；测试必须包含
Token 和 Home/Runtime/Project 路径 canary。v4 不再输出，也没有协商或兼容字段。

Electron Save Dialog 取消时零写入；成功时使用平台 private atomic write（Unix `0600`，Windows 创建时 protected
DACL）。Renderer 只可请求宿主文件管理器显示当前 Main session 最后一次成功导出的精确路径；用户文案在 macOS
为 Finder，在 Windows 为文件资源管理器。

## 4. 错误与恢复

- 首次读取失败：保留诊断页头，显示 Error 与重试；
- 已有成功报告后读取失败：保持旧报告，显示 Recovery、失败原因和旧 `checkedAt`；
- 修复请求失败：保持报告和问题，不显示成功；
- Runtime 有界等待到期：保持 `unknown`，不得转换为 `attention` 或 `ok`；
- Core 无法启动：不构造 DiagnosticsReport，继续使用 Startup Recovery。
