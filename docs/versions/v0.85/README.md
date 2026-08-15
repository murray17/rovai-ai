---
document_type: version-overview
version: v0.85
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-15
---

# Rovai-ai v0.85：Agent 主导的伙伴入队

> 当前状态：`member-studio`、`member.create`、受控头像导入和 Transport v12 已实现，并通过 Rust、
> TypeScript、Skill、文档与隔离 Core smoke 门禁；真实十 Runtime 十四项联合 matrix 本版本未重跑。
>
> 前置版本：[v0.84 可切换执行台与 Inspector Sidecar](../v0.84/README.md)

## 版本目标

让用户可以在 Agent 会话中从一个名字开始创建新队员。Agent 负责整理六字段长期身份、提出头像方案、
展示完整“队员名牌”并取得明确确认；确认后通过新增的 `rovai member create` 把队员写入 Core 名册。

头像采用轻量能力适配：有生图能力时准备 4:5 原创竖图；没有生图能力时，在当前权限允许下网上寻找
来源清楚的图片；两者都不可用时创建无头像队员。文件暂存位置由 Agent 根据当前 Run 决定，产品只接收
可选本地 PNG/JPEG 路径，做有界解码、标准化和方形粗裁，并写入既有 managed avatar store。

## 交付范围

- 新增 Rovai original、`user_managed` 的 official `member-studio` Skill，保留附件中的身份生成、名牌确认和
  完成报告流程，只把头像接口对齐到 4:5 输入、轻量方形粗裁与 `--avatar-file`；
- official Skill inventory 从十二项扩展为十三项；两项 `system_required` 不变，Settings 自动呈现十一项
  可配置 Skill；
- Built-in Tool Transport/CLI/capability 升至 v12，固定十四项 operation，新增
  `member.create -> rovai member create` 的 closed schema、help、Agent Output、Evidence 和 recovery；
- 创建只允许 attested active、direct user-triggered AgentRun；`creationKey` 提供跨 CLI request 领域幂等，
  A2A 不能创建队员；
- `CreateAgentProfileCommand` 支持可选受控 `avatarRef`，使身份与头像引用在同一领域事务中提交；
- Core 读取不跟随符号链接的普通 PNG/JPEG，限制文件、尺寸、像素和 decode allocation，应用方向并剥离
  元数据，标准化至最长边 2048，按竖图顶部约 5% 粗裁并生成 192×192 PNG；
- Core 写出与 Electron Main 相同的 manifest v1、私有权限和 atomic rename；本地路径与图片字节不进入
  SQLite、Command payload、Canonical Result 或 Execution Evidence；
- cold-start bundle 若遇到旧 imported 同名 Skill，保留 ID/配置并原地晋升为 official 后发布 bundled
  Revision，避免早期本地试用阻断新版本启动。

## 非目标

- 不新增人脸检测、智能抠图、精细头像编辑器或产品分配的跨 Run 临时 token；
- 不把 Skill 变成生图、联网或文件权限来源，也不保证每个 Runtime 都有相同图片能力；
- 不新增 Electron Main↔Core 私有头像 bridge，不允许 Agent 直接写 `userData/member-avatars`；
- 不在创建时自动配置 Runtime、模型、权限、Presence、Camp membership、Default Lead 或 Memory；
- 不修改既有队员编辑 UI；用户仍可通过现有队员设置后续调整身份或头像。

## 验收口径

1. Core catalog、CLI mapping/help、golden projection、Charter 和 capability 精确为 v12/十四项；
2. direct user-triggered Run 可创建并重放同一 `creationKey`，A2A 拒绝，changed input 停止；
3. 无头像创建成功；4:5 PNG/JPEG 导入生成 source/icon/manifest，默认粗裁、digest、权限和 replay 正确；
4. `avatarFile` 路径不出现在领域命令、Agent 输出或 Evidence；
5. fresh bootstrap 精确安装十三项 official Skills，`member-studio` 为 `user_managed`，旧 imported 同名项可
   原地晋升；
6. Skill validation、Rust/TypeScript、文档治理和相关 smoke 脚本门禁通过；真实十四项 Runtime matrix 未执行
   时必须明确记录，不能用确定性测试冒充实机证据。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.84 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.85。 |
| ADR | 已更新 | [ADR-0191](../../adr/0191-agent-mediated-member-creation-and-thirteen-skill-inventory.md)替代 ADR-0181，冻结十三项 inventory、Agent 确认、direct-user authority、头像导入和 imported→official 晋升边界。 |
| Contracts | 已更新 | [Built-in Tool Transport v12](../../contracts/builtin-tool-transport-v12.md)替代 v11，增加第十四项 `member.create` 及其 input/result/error/idempotency/evidence 合同。 |
| Architecture | 已更新 | [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)记录 member.create 路由与 Core 头像 importer；[Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)记录十三项 inventory 和同名 imported 晋升。 |
| UI | 确认无需更新 | Settings 已按 Core `user_managed` 列表自动渲染，队员管理已有后续身份/头像编辑入口；本版本不改变 Renderer wire 或交互合同。 |
| Runtime Activity | 确认无需更新 | `member.create` 继续使用通用 Built-in Tool Evidence/Activity 投影，没有新增 Canonical Activity kind 或 Runtime-specific mapping。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)把当前 capability 基线推进到 v12/十四项，并明确本版本未重跑十 Runtime 真实 matrix。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、ADR/Contract/Architecture 索引与 CURRENT 路由到 v0.85、ADR-0191 和 Transport v12。 |
| Root README | 已更新 | [项目 README](../../../README.md)在常青能力中加入 Agent 确认后创建队员及可选受控头像导入。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0191](../../adr/0191-agent-mediated-member-creation-and-thirteen-skill-inventory.md)
- [Built-in Tool Transport v12](../../contracts/builtin-tool-transport-v12.md)
- [`member-studio` bundled source](../../../skills/member-studio/SKILL.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
