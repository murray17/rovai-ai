---
document_type: contract
contract: runtime-file-change-observation
version: v2
status: accepted
source_version: v1.29
last_updated: 2026-08-28
---

# Runtime File Change Observation v2

v2 replaces [v1](runtime-file-change-observation-v1.md). v1 的三层产品模型、Evidence 语义、Runtime profiles、
Run projection、读取授权、Renderer presentation、限额与无 Git/无扫描边界全部保持不变。本版只增加一个
Core-owned negative admission boundary：当前 Runtime Host 的精确 `ROVAI_RUN_TMP` 及其后代是临时交付区，
不得成为 Command 文件行、Command Diff 或 AgentRun `Files Changed` 内容。

## 1. Managed output root identity

Core 为每个 Built-in Tool Process 创建精确的绝对 `run-tmp`，并把同一路径作为 `ROVAI_RUN_TMP` 注入 Runtime。
这个 root：

- 是当前进程配置拥有的 typed path，不从 Runtime payload、环境文本、用户目录名或固定平台前缀猜测；
- 不是 Camp workspace、execution/display root、Published Attachment View、Managed Attachment 或用户选择的输出目录；
- 会在 lease 绑定前重置，并可在 unbind、进程回收或后继绑定时清理，因此其中路径不是稳定的用户文件事实；
- 只排除该 exact root 本身及其 path-component descendants；父目录、同名前缀目录（例如 `run-tmp-copy`）、
  其他进程的临时目录和普通 execution-root-external 文件都不受影响。

比较必须先使用 execution root 的既有规则把 Runtime-reported path 纯词法解析为绝对路径，再按目标平台的 path
component 语义判断 containment。Unix 保持大小写敏感；Windows 接受 `\`/`/` 与 ASCII 大小写等价的组件。
不得以裸字符串 `startsWith`、全局小写路径 key、目录扫描、文件打开、canonicalize 或 symlink 解析代替该判断。
这条规则只拥有文件变化 presentation admission，不构成 Runtime 文件访问授权。

## 2. Operation and Command Diff admission

v1 Common Admission 第 3 条收敛为以下顺序：

1. 按冻结 execution root 验证并解析 reported path；
2. 若解析结果等于当前 managed output root 或位于其下，拒绝该文件变化 presentation；
3. 否则继续沿用 v1：display root 内保存相对路径，root 外保存规范化绝对路径。

`runtimeFileOperation` 命中 managed output root 时写入 `status=unavailable` 与
`safeReasonCode=runtime_file_operation_managed_output_root`，不产生可读取 path。`runtimeDiff.entries[]` 对 path
和 Codex move path 逐项执行相同过滤：

- mixed payload 保留所有非 managed entries，统计和 projection 只基于保留项；
- 全部 entries 被过滤时写入 `status=unavailable` 与
  `safeReasonCode=runtime_diff_managed_output_root`；
- 同一 ACP ToolCall 的唯一 operation 已确定命中 managed root，而单 entry Diff 使用 rooted-relative path 时，
  该 Diff 同样 unavailable，不能通过路径对齐把临时输出重新标成普通文件；
- unavailable 诊断可以留在私有 Evidence/Canonical projection，但不提供可展示 path、不让 Diff 成为 available，
  也不生成 `修改 <basename>`、inline diff 或 Run-card fallback。原 Tool Activity 仍可按其可靠 Runtime kind 保持
  普通 file/tool 分类与通用 presentation。

普通 Tool Activity、命令输出与 Runtime 生命周期 Evidence 可以继续存在；本合同只移除文件变化产品声明。

## 3. Authoritative Run snapshot

Codex terminal `runtimeRunDiff` 在进入 append-only Execution Evidence 前按完整 `diff --git` section 过滤：

- source 或 destination path 命中 managed output root 的 section 整体删除，其他 section 按原字节和顺序保留；
- mixed snapshot 仍是保留 section 的权威 snapshot；
- 全部 section 被删除时保存空 snapshot。它是 display root 内的权威 no-change，不得回退到同 Run 更早的
  managed operation Evidence；
- 冻结 execution root 缺失时写 `status=unavailable` 与
  `safeReasonCode=runtime_run_diff_execution_root_missing`，不得保留无法归属的 diff bytes；
- snapshot 不能安全拆分或识别 section identity 时，改写为 `status=unavailable` 与
  `safeReasonCode=runtime_run_diff_managed_output_filter_unsafe`，删除原 diff bytes，并沿用 v1 的 terminal
  operation fallback；不得读取文件系统补偿。

过滤发生在 durable Evidence ingress，而不是 Renderer 或 read projector，因此正常 terminal projection 与 startup
recovery 消费同一份已收敛 Evidence。

## 4. Historical data and compatibility

本版不迁移、不重写、不重新分类已持久的 v1 Evidence、Canonical Activity 或 AgentRun projection；已有
`Files Changed` 卡片保持其原始历史结果。managed output exclusion 只适用于部署 v2 逻辑后新进入 Core 的 Runtime
Evidence。读取 wire、Camp Open schema、detail blob schema、Command Diff schema 与数据库 schema 均不变，不需要
dual read、alias、backfill 或 migration。

Published Attachment 是独立的 durable product resource。Runtime 先在 `ROVAI_RUN_TMP` 生成文件、再通过
`rovai send --file` 发布时，临时源路径不进入文件变化 presentation；成功 ingest 后的受管附件由 Camp Attachment
合同单独展示和授权。

## 5. Acceptance

- macOS/Linux 的 exact `.../run-tmp/report.html` 与 Windows 的 exact
  `%LOCALAPPDATA%\Rovai AI\Core\runtime\builtin-tools\<process>\run-tmp\report.html` 不进入 Command 或 Run card；
- Windows drive/root 大小写和 `/`/`\` 差异仍命中 exact component containment；`run-tmp-copy` 不命中；
- 普通 workspace 内文件与 managed output 混合时只展示普通文件；普通 root 外用户文件继续显示绝对路径；
- path-only、full before/after、exact mutation、Codex move 与 whole-turn snapshot 共享同一 exclusion；
- 全 managed snapshot 形成权威空结果，不被旧 operation fallback 复活；
- 重启 recovery 不重新引入已在 ingress 过滤的路径；旧 v1 数据不发生写入或展示变化。

## References

- [Runtime File Change Observation v1](runtime-file-change-observation-v1.md)
- [Runtime File Change Observation 架构](../architecture/runtime-file-change-observation.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Camp Attachment v6](camp-attachment-v6.md)
- [V1.29-D13](../versions/v1.29/decisions.md#v1-29-d13)
