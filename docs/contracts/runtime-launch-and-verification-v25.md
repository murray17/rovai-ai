---
document_type: contract
name: Runtime Launch and Verification
version: v25
status: accepted
source_version: v1.27
last_updated: 2026-08-23
---

# Runtime Launch and Verification v25

v25 replaces [v24](runtime-launch-and-verification-v24.md). v24 的用户原生 Runtime Home、Probe 隔离、
continuation、External MCP、逐平台准入及十二种 Runtime 原生最高权限默认全部保持不变；本版把 Cursor 的
默认隐藏边界扩展到普通成员 Runtime selector，修正 Settings 与队员配置入口之间的 Renderer 漂移。

## Cursor 普通产品入口

`cursor-agent` 继续作为 closed `AdapterKind` 保留在 Product Runtime Catalog，用于稳定 identity、Migration、
历史读取与后续实现。三个目标平台仍为 `not_qualified`，普通 discovery、检查、成员新配置和 AgentRun 均不准入。

在后续合同以真实产品证据明确开放前，Renderer 必须同时满足：

- Settings 的 Agent Runtime 目录不渲染 Cursor row；
- 未配置 Runtime 或配置为其他 Runtime 的成员，其普通 Runtime selector 不渲染 Cursor option；
- Renderer 使用同一受审查的可见 Product Runtime 集合驱动以上两个入口，不得因复制全量 `AdapterKind` 清单
  重新暴露 Cursor；
- 历史上已经保存的 Cursor 配置仍可按 closed reader 投影，Runtime 子对象保持只读；保存姓名、角色等无关字段
  时必须原样保留，不得制造 `execution_mode`、`approval_policy` 或替换配置；
- 隐藏 Cursor 不删除其 logo、label、Migration、Adapter、平台 Admission 或历史数据 reader。

## Acceptance

- 无 Runtime 的新成员配置页不包含 `Cursor Agent` option；
- 已配置其他 Runtime 的成员配置页同样不包含 `Cursor Agent` option；
- Settings Agent Runtime 目录继续不包含 Cursor row；
- 历史 Cursor 配置保持可读取、不可修改，其他成员字段更新不改变 Runtime 子对象；
- v24 的十二种 Product permission defaults 不发生变化，Kimi 新 draft 仍为 `permission_mode=yolo`。

## References

- [Runtime Launch and Verification v24](runtime-launch-and-verification-v24.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Member workspace surface brief](../../apps/desktop/.impeccable/surfaces/member-workspace.md)
