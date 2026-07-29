---
document_type: version-overview
version: v0.19
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-29
---

# Rovai-ai v0.19 已验证的 Agent Runtime 扩展

> 状态：生产实现、自动验证与本机 macOS 打包验收完成
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.18 伙伴记忆自动形成与长期记忆工作台](../v0.18/README.md)
>
> 跨版本决策：
> [ADR-0065](../../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)
>
> 调研证据：[Runtime 兼容性清单](../../runtime-compatibility.md)

## 版本目标

v0.19 将 Kiro CLI、Qoder CLI、CodeBuddy 和 Qwen Code 作为可执行 Runtime 加入产品。
这四种 Runtime 均通过现有 `AgentRuntimeAdapter`、Installation snapshot、AgentRun
冻结、Native Binding、execution epoch、Action/Approval 与 interrupt/recovery 边界，
不引入另一套运行模型。

未接入候选不进入 `AdapterKind`、数据库封闭 kind、Contracts 或 Renderer。工程调研只
维护在项目兼容性清单中。

## 2026-07-29 本机验证基线

| 执行引擎 | 本机版本 | 精确每 Run MCP | Session 证据 | v0.19 准入 |
|---|---:|---|---|---|
| Kiro CLI | 2.15.0 | 私有 Custom Agent 禁用 `mcp.json` 合并；ACP 注入项启动且 ambient 项未启动 | 已登录真实 turn、跨进程 load、cancel 均通过 | 实验性可执行 |
| Qoder CLI | 1.1.7 | strict config + server allowlist | ACP initialize 已验证；Ready 由当前安装的登录 Session 门控 | 实验性可执行 |
| CodeBuddy | 2.128.0 | strict config | ACP initialize 已验证；Ready 由当前安装的登录 Session 门控 | 实验性可执行 |
| Qwen Code | 0.21.0 | 私有 config + server allowlist；空集合 safe mode | ACP initialize 已验证；Ready 由当前安装的登录 Session 门控 | 实验性可执行 |

更完整的候选调查、排除原因与复核条件见
[Runtime 兼容性清单](../../runtime-compatibility.md)。

## 已确认范围

### Core、持久化与 Contracts

- Rust/TypeScript `AdapterKind` 增加四种稳定 kebab-case identity；
- Migration v30 扩展 `adapter_installation` 封闭 kind 集合并保留已有记录；
- 编译时 Registry 仍是唯一产品 Runtime 目录，不加载第三方 Adapter 二进制；
- Installation snapshot 持久化实际路径、版本、认证、协议、模型、权限和能力；
- 当前新增 Runtime 必须观察到 `mcp.exact_per_run` 才能 Ready 和冻结。

### 执行与安全

- 四种 Runtime 复用 typed ACP transport，但拥有独立 Adapter identity 和启动合同；
- Kiro Host 从 Rovai 私有进程目录读取专用 Agent，真实 AgentRun 工作目录只通过 ACP
  Session 传入；因此不改仓库、不替换用户配置，也保留 Kiro 原生 Session 恢复；
- Qoder、CodeBuddy、Qwen 为每次 Run 写一次性严格 MCP 配置，进程结束后清理；
- Team MCP 与外部 MCP 名称来自当前 Run 冻结投影，不从用户目录反向补充；
- disposable Session 健康探测继续门控认证和必需能力；版本输出或 initialize 不能单独
  产生 Ready；
- 运行中不会因健康状态变化静默切换 Adapter 或降低 MCP 边界。

### Desktop

- 自定义伙伴配置可以选择九种实际实现的执行引擎；
- 显示四种新增 Runtime 的产品名称、成熟度、路径提示和原生权限；
- 危险权限提示覆盖 Qoder、CodeBuddy 与 Qwen 的 bypass/yolo 语义；
- 未接入候选不出现在添加、健康、成员、Summary 或运行视图。

## 明确不在本版本内冒充完成的内容

- Qoder、CodeBuddy、Qwen 未登录账号上的真实模型 turn、恢复、取消和 MCP tool call；
- “可注入 Rovai MCP 但保留原生 MCP”Runtime 的产品准入；
- 不能注入 Rovai MCP 的 Runtime；
- 任意动态第三方 Adapter 插件加载。

## 官方核验入口

- [Kiro CLI ACP](https://kiro.dev/docs/cli/acp/)
- [Kiro CLI MCP](https://kiro.dev/docs/cli/mcp/)
- [Kiro Custom Agent configuration](https://kiro.dev/docs/cli/custom-agents/configuration-reference/)
- [Qoder 权限与 MCP allowlist](https://docs.qoder.com/en/cli/permissions)
- [CodeBuddy CLI strict MCP reference](https://www.codebuddy.ai/docs/cli/cli-reference)
- [Qwen Code 配置与 ACP](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/)
