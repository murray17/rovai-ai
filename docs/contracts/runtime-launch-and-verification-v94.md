---
document_type: contract
name: Runtime Launch and Verification
version: v94
status: accepted
source_version: v1.72
last_updated: 2026-11-15
---

# Runtime Launch and Verification v94

继承 [v93](runtime-launch-and-verification-v93.md)，替换 Goose 恢复后主动撤回旧 MCP 的要求。
按 User sequence 142，以任务可用性和原生扩展行为为准。

## Goose 原生 MCP 会话行为

Rovai 每轮计算、冻结并传入当前适用的 MCP 配置；保存仍只保存配置，下一 Run 沿共享兼容性判断获取 Host。
配置不兼容时继续替换旧 Host、精确 load 原 Session，不改变共享 Fleet 或 cwd launcher。
原有 `rovai_assigned_<server_id>` 名称保持，避免给既有 Session 的同一服务换名后重复注册。

正式执行不调用 Goose 的 `_goose/unstable/session/extensions/list` 或 `_goose/unstable/session/extensions/remove`，
不以扩展撤回是否成功作为业务 prompt 的前置条件，也不增加后台重试、扫描或配置副本。

原生 load 对扩展采用追加／同名更新语义。Rovai 中取消分配、禁用或删除 MCP 后，
该服务不再进入本轮新分配，但先前保存在 Goose Session 中的扩展可能继续存在、连接并供模型调用。
不承诺这些操作会同步撤销已有原生扩展；新分配的配置与原生 Session 当前全部工具集合是不同事实。
不为消除原生保留项而切换到新 Session 或删除历史。

## 验证与承接

既有 live-model owner 覆盖精确 load 后无需可选 list/remove 接口即可完成配置与 System 投递，
并保持新建、Warm、模型／effort／mode 和默认选择断言。
官方 Core smoke 验证配置更新继续生效、取消分配后的任务成功，以及原生保留项在 Core 重启后仍沿用。
旧“取消分配后旧工具必须消失”的 Goose 产品断言随该行为退出；原生 probe 对官方 remove 能力的研究保留。

本版不改变原生 load、认证、Provider 或实际调用 MCP 时自身错误的既有处理，不提升 Preview 或平台资格。
