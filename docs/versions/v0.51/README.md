---
document_type: version-overview
version: v0.51
lifecycle: current
authority: version-scope-and-status
design_status: complete
implementation_status: complete
last_updated: 2026-08-09
---

# Rovai-ai v0.51：可操作诊断中心与 v5 导出

> 当前状态：设计与实施完成。Core 只读诊断、单项修复复检、v5 导出、工作区级自动测试与
> `1440×920` / `1040×700` 隔离打包 App 验收均已通过。
>
> 前置版本：[v0.50 Self Identity 与 Collaboration Projection](../v0.50/README.md)

## 版本目标

v0.51 将原诊断页的四项健康摘要升级为“设置 → 诊断与修复”可操作诊断中心：用一个严格只读
Core Read Model 同时驱动摘要、需要处理的问题和全量检查结果；修复仅在用户点击单项操作后进入
已有安全能力，并在复检确认正常后才呈现成功。

同版本将诊断导出单线切换为 `rovai-diagnostics-v5`：只序列化 typed diagnostics 与许可聚合计数，
在 Core 通过一个集中 redaction 边界后才交给 Electron 原子写盘。不保留 v4 双格式，不输出绝对
Home、应用数据、SQLite、Runtime 或项目路径。

## 冻结边界

- “运行完整自检”只读取 Core、数据目录、Git、SQLite quick_check、Skill、MCP 与 Runtime
  缓存事实；不触发 reconcile、初始化、权限修复、rescan、probe、登录或替换；
- v1 只覆盖 Core 已成功启动的场景；Core 无法打开/迁移 SQLite 时继续使用 Startup Recovery；
- 全量结果始终显示 Product Runtime Catalog 的九个 Runtime；只有被未移除队员持久选择且不可用的
  Runtime 进入“需要处理”，未使用且未安装不制造问题；
- 超时、瞬时失败、检测中或读取失败归为“暂时无法确认”，不进问题列表；Recovery 保留最近
  成功证据并标注本次失败；
- 安全修复只有 Skill 重新同步和 MCP 权限收紧；Runtime 只允许单项重检或前往设置；SQLite/数据
  问题只说明并导出诊断；
- 没有“修复全部”，不自动修改 SQLite，不覆盖 malformed MCP，不登录或替换 Runtime。

## UI 与导出

生产界面保留统一设置侧栏、Arctic Dawn Token 和共享设置页头。顶部只有“运行完整自检 /
导出诊断 JSON”；下方依次是隐私边界、三态摘要、attention-only 问题列表和按“全部 /
需要处理 / 正常 / 暂时无法确认”筛选的全量结果。原 HTML 中的交互稿状态切换器不进生产代码。

页面覆盖 Loading、Running、Partial、Error、Success、Disabled 和 Recovery；主验收尺寸为
`1440×920` 与 `1040×700`。精确交互见[生产设计](production-design.md)，自动验收见
[实施计划](implementation-plan.md)。

## 本版本不做

- 不覆盖 Core 启动失败后的诊断中心；
- 不增加 SQLite integrity repair、schema repair 或索引重建 Core Method；
- 不扩大 MCP 权限检查到未经证明的外部路径或覆盖任何配置内容；
- 不在完整自检中等待或启动九个 Runtime 的新 probe；
- 不保留 v4 导出双写、读取兼容或消费者升级桥。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | `docs/versions/README.md` 冻结 v0.50 为 historical，v0.51 成为唯一 current；建立本概览、生产设计与实施计划 |
| ADR | 已更新 | ADR-0148 冻结只读自检、显式单项修复与 v5 集中脱敏，局部替代 ADR-0048 的 v4 格式标识 |
| Contracts | 已更新 | `docs/contracts/diagnostics-center-v1.md` 冻结 Report/Check 字段、三态分类、修复映射和 v5 shape |
| Architecture | 已更新 | `docs/architecture/diagnostics-center.md` 记录 Core/Skill/MCP/Runtime/Renderer/Electron/Startup Recovery 权威边界 |
| UI | 已更新 | `docs/ui/README.md` 与 `docs/ui/arctic-dawn.md` 用诊断中心交互取代旧四列健康页 |
| Runtime Activity | 确认无需更新 | 只读取既有 Runtime availability/discovery/probe 证据，不新增或重分类 Canonical Runtime Activity |
| Runtime compatibility | 确认无需更新 | 不改变九 Runtime 的上游版本、Adapter 能力、协议、发现或兼容性结论 |
| Documentation routing | 已更新 | `docs/README.md`、合同/架构/UI/开发索引增加诊断中心当前入口与验收命令 |
| Root README | 确认无需更新 | 项目定位、常青核心能力和支持的 Agent Runtime 范围没有变化 |

## References

- [v0.51 生产设计](production-design.md)
- [v0.51 实施与验收计划](implementation-plan.md)
- [ADR-0148](../../adr/0148-read-only-diagnostics-and-data-minimized-export.md)
- [Diagnostics Center v1](../../contracts/diagnostics-center-v1.md)
- [Diagnostics Center Architecture](../../architecture/diagnostics-center.md)
