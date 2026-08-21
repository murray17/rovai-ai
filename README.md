# Rovai-ai

> Your camp for the next horizon.

Rovai-ai 是一个本地优先的多 Agent 研发工作空间。桌面应用组织长期队员、Camp 协作、
任务执行、权限审批、审计与恢复，并驱动用户本机已有的 Coding Agent CLI。

**Build with agents that remember the road.**

## 核心能力

- 以 Camp、长期队员和可恢复任务组织多 Agent 协作；
- 让 Agent 在用户确认后创建长期队员，并可安全导入生成或选取的本地头像；
- 在本地持久化协作状态、执行证据、审批和审计信息；
- 动态发现十种受支持的本机 Runtime 版本、模型与能力，不固定上游产品版本；
- 保持用户工作区、Runtime 原生配置和凭据的明确所有权边界。

## 项目状态

项目仍处于预发布阶段。Runtime 兼容性和成熟度标签只描述 Rovai-ai 已完成的验证范围，
不代表对应上游产品的稳定性或支持承诺；最新实测证据见
[Agent Runtime 兼容性清单](docs/runtime-compatibility.md)。
设置页中明确标为“待支持”的预告不属于可执行 Runtime 目录，也不能被队员选择或启动。

## 终端自动化（macOS）

安装包内的 `rovai app` 是普通用户可在终端使用的正式本机自动化入口，不是调试接口。它控制当前已经运行的
Rovai Desktop；App 未运行时返回 `app_not_running`，不会在后台自动启动。

```bash
/Applications/Rovai\ AI.app/Contents/Resources/bin/rovai app --help
```

希望直接输入 `rovai` 时，可将这个包内 binary 链接到 `PATH` 中的目录（例如 `~/.local/bin/rovai`）。
`rovai app ...` 与供 Agent Runtime
调用的既有 `rovai ...` 使用彼此隔离的本机 transport 和 credential。完整命令、安全和 Trial 导出边界见
[User Automation v1](docs/contracts/user-automation-v1.md)。

## 文档

- [文档导航、权威边界与 AI 读取规则](docs/README.md)
- [版本索引与当前版本](docs/versions/README.md)
- [跨版本架构决策（ADR）](docs/adr/README.md)
- [Agent Runtime 兼容性与实测证据](docs/runtime-compatibility.md)
- [本地开发、运行、测试与构建](docs/development/README.md)
