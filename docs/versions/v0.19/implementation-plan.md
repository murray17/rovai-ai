---
document_type: implementation-plan
version: v0.19
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-29
---

# Rovai-ai v0.19 实施计划与验收清单

> 状态：生产实现、自动验证与本机 macOS 打包验收完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0065](../../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
>
> 调研证据：[Runtime 兼容性清单](../../runtime-compatibility.md)

`[x]` 只表示已有代码、Migration、测试或可复现本机证据；产品文档声称支持某能力不等于
Rovai-ai 已验证。

## 检查点 1：实施前可行性验证

- [x] 核对候选产品的官方安装渠道、非交互入口和 MCP 配置合同。
- [x] 对 Qoder、CodeBuddy、Qwen 完成 ACP initialize 与严格 MCP 参数核验。
- [x] Kiro 使用已登录账号完成真实模型 turn。
- [x] Kiro 完成私有 Agent / 真实工作区双目录验证：注入 MCP 启动，ambient MCP 未启动。
- [x] Kiro 完成跨进程 `session/load` 与 `session/cancel` 实测。
- [x] Kiro 健康 Session 验证 `session/set_model`，不误用其未实现的通用
  `session/set_config_option`。
- [x] 验证 disposable `KIRO_HOME` 不丢失本机登录。
- [x] 把未接入候选移出产品目录，仅保留项目兼容性清单。
- [ ] 使用真实账号完成 Qoder、CodeBuddy、Qwen 的模型 turn、恢复、取消与 MCP tool call。

## 检查点 2：目录、Migration 与 Contracts

- [x] Rust/TypeScript `AdapterKind` 只增加 Kiro、Qoder、CodeBuddy、Qwen 四种 identity。
- [x] Migration v30 只扩展这四种 Installation kind 并保留旧记录。
- [x] 编译时 Registry 增加解析、能力、模型、权限、Skill 与 MCP 合同。
- [x] 未接入候选不出现在 AdapterKind、Migration、Contracts 或 Renderer。
- [x] fresh DB 与 v29→v30 migration 测试。

## 检查点 3：ACP 执行与隔离

- [x] 四种 Runtime 接入独立 Adapter identity。
- [x] Kiro Host 写入私有 `rovai` Agent，禁用 `mcp.json` 合并，并从 ACP Session 注入精确
  MCP。
- [x] Kiro 生产 Host 保留原生认证与 Session；健康探测 Session 使用 disposable home。
- [x] Qoder、CodeBuddy、Qwen 每 Run 写入并持有一次性严格 MCP 配置，进程结束清理。
- [x] Qoder/CodeBuddy 使用 strict config；Qoder/Qwen 固定 server allowlist。
- [x] 四种 Runtime 的健康 Session 继续门控登录、必需能力和 `mcp.exact_per_run`。
- [x] 调度、Resume、interrupt、失败清理与 Context Compaction 覆盖四种新增 Runtime。

## 检查点 4：Core 与 Desktop

- [x] Core 初始化、刷新、健康检查和 Native Binding 路由覆盖新增 kind。
- [x] 成员管理只提供九种实际实现的执行引擎。
- [x] 四种新增 Runtime 使用一致产品标签、成熟度和路径提示。
- [x] Qoder、CodeBuddy、Qwen 显示原生权限配置和危险权限提醒。
- [x] Summary 设置与运行视图使用一致产品名称。
- [x] macOS App bundle 内置 release Core 的 `health.check` 返回恰好九种执行引擎：
  Kiro Ready，Qoder/CodeBuddy/Qwen 按实际登录状态返回 Authentication Required。

## 检查点 5：自动验证

- [x] `cargo fmt --all --check`。
- [x] `cargo test --workspace`：191 个 lib tests、41 个 binary tests，5 个手工
  Runtime smoke 按设计忽略；Kiro 真实健康 smoke 另行显式通过。
- [x] `pnpm typecheck`。
- [x] `pnpm test`：20 files / 102 tests。
- [x] `pnpm build:desktop`。
- [x] `pnpm package:mac`，并通过 `codesign --verify --deep --strict` 与包内 arm64 Core 检查。

最终验证完成后更新本节，不提前固化测试数量。

## 当前证据边界

Kiro 已完成真实账号验收。Qoder、CodeBuddy、Qwen 的“实验性可执行”表示 Adapter、
精确 MCP 参数合同与 ACP initialize 已实现；当前安装仍必须通过 disposable Session
认证探测才能成为 Ready。
