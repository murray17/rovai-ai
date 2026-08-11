---
document_type: version-overview
version: v0.58
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-11
---

# Rovai-ai v0.58：可恢复 Runtime 漂移与受控重绑定

> 当前状态：Core 实现、自动化测试与通用仓库门禁已完成，真实 Copilot CLI 漂移验收待完成。
>
> 前置版本：[v0.57 可恢复的项目侧栏移除](../v0.57/README.md)

## 版本目标

把 AgentRun dispatch 的 Runtime fingerprint mismatch 从无条件 terminal failure 收敛为一次有界的
installation refresh、logical identity revalidation 与 effective Runtime rebind。正常 CLI 原地升级可以
继续同一 Run；身份、信任、权限、模型或协议无法重新确认时仍 fail closed。

## 交付范围

- dispatch 在 snapshot changed/stale、path invalid、probe required 或 executable fingerprint drift 时
  同步刷新 managed/custom Installation，并绕过后台刷新延迟；
- Run 冻结 Adapter、Installation、auth scope、模型选择语义和权限配置，refresh 后只允许相同 logical
  identity 解析出的 trusted + ready + compatible Runtime；
- `agent_run` 分离 initial reported version/fingerprint 与可更新的 effective Runtime 列，并以
  `runtime_rebind_count` 将自动 rebind 限制为一次；
- rebind 原子更新 `effective_config_json`、全部冗余 Runtime 列与 config digest，并写入 drift/rebound
  审计事件；
- refresh/rebind 后再次执行 snapshot blocker 与 executable integrity 检查，二次漂移或身份/兼容性
  失败才 terminal fail。

本版本同时把全部 Rovai 受管 Skill 的首次投递默认值改为九个 Runtime 生效组：新安装的六个内置
Skill 与新导入 Skill 都保持默认启用并立即获得全部 Group Assignment；Migration 74 为既有 active
Skill 一次性补齐缺失分组，同时保留当前 Revision 与显式启停状态。迁移完成后，用户对任一 Skill
的禁用或分组增删不会在后续启动或 Revision 更新时被恢复为默认值。

官方集合新增完整 `tasteful-ui` Skill：源码固定到上游
`159ccd47a320f3a7bd0289d07366d422211895a1`，保留 MIT 许可、来源 Notice、全部渐进披露参考与 Rovai
展示元数据；Core 构建时确定性枚举并嵌入 84 个文件，应用启动不访问网络。
Skill 设置页从该真实上游元数据派生来源，但首层只显示“GitHub / Rovai / 用户导入”短标签；仓库、
八位上游 Revision、安装来源与 Library Revision 全部进入中性详情。每个 Skill 以持久 UUID 经
FNV-1a hash 映射到 `--identity-1..8`，颜色只用于 38px 字母标记，修改与新 Revision 不改变身份色。
右侧操作收敛为带列名的投递范围、无可见状态文案的 Steel Switch 与详情，Imported 删除仍只在详情，
不再使用意义不明的三点菜单。

本版本的 Renderer 同时把用户与 Agent 普通消息统一到同一开放阅读平面，并在 2K 宽屏下使用
“叙述约 76ch、代码与表格最多 930px”的双宽度体系。身份继续由头像、名称、Runtime、时间和 A2A
metadata 表达；不新增 Agent 默认色、消息底色或领域分组，Task、Approval、AgentRun 与 Composer
的领域边界不变。

同一 Renderer 范围把 ordinary Camp Inspector 收敛为“任务 / 队员”。ContextManifest 与 Runtime
Input Delivery Evidence 继续留在 Core/Snapshot，但不再进入普通 Inspector；Approval Dock 成为唯一
普通审批决定 surface，Header 与通知摘要只定位该 Dock。“队员”页读取真实 CampMember/AgentProfile
并复用 versioned `camps.changeDefaultLead`，不复制队员管理或 Runtime 配置 mutation。

Antigravity one-shot Adapter 同时把 Runtime Input accepted ACK 从完整 `agy --print` 退出提前到可验证
的上游接收点：只有匹配 Native Conversation 的 forward/send 之后出现 `streamGenerateContent`
`ResponseID` 才提前绑定 Session 并确认输入。AgentRun 仍持续到完整生成结束；ACK 后发生的进程失败、
取消或 final-output 错误不再把已接收输入降级为 `delivery_unknown` 或触发重复投递。无法识别的新日志
格式继续使用原有 terminal fallback，不猜测 accepted。

同一 accepted-ACK 收口覆盖 Claude Code 与六个 ACP Runtime。Claude Code 从单一 final JSON 切换到
session-bound `stream-json`：system/Hook/status 不确认，首个模型 stream/assistant event 提前确认，success
result 兜底。OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen 不再把 ACP stdin flush 当作 ACK，只接受
当前 prompt 的 agent/thought/plan/tool/permission 事件或匹配成功 response；明确 error response 在尚未
accepted 时结算为 `not_accepted`。三类 Adapter 在 accepted 后发生的 terminal failure 都不得降级水位。

真实 Copilot 请求复盘同时收敛三项直接影响 v0.58 验收可读性与恢复体验的缺陷：

- Session Charter 明确 `explicit_send_only` 的公共输出义务，但 Charter 文案变化不触发 Native
  Session 兼容性轮换；
- ADR-0157 删除从未进入 Runtime Context 或完成判定的 `expectedOutput`；触发 Message 继续作为
  每个 AgentRun 唯一的自然语言工作指令，`purpose` 只保留为审计描述；
- Canonical Runtime Activity 合并保留 started 事件中已报告的 ACP kind/title，稀疏 terminal update
  只推进 phase/outcome；
- Codex `commandExecution.title` 为空时，Core 使用 app-server 结构化 `commandActions` 生成有界
  presentation hint；file change 同样使用 `changes` 投影文件名或数量，不再全部显示固定 domain hint；
- “停止当前执行”只取消拥有非终态 AgentRun 的 Turn，不再顺带取消仅等待人工重试的历史 Turn。
- Skill 启停提交与可能较慢的投递文件对账解耦，设置页只原位更新当前行；34×20 Steel Switch
  不显示“已启用 / 已停用 / 保存中”文案，通过 `aria-checked` 与动作型可访问名称表达状态。

## 冻结边界

- 不移除 SHA-256、轻量文件身份或执行边界校验；
- 不从 Member 当前 live Runtime 配置重建旧 Run，不改变显式模型、权限或 Installation identity；
- 不无限重试，不为 refresh 启动未通过 deep probe 的 Runtime；
- 不声称实现代码签名、包管理器 receipt 或 artifact signature 验证；
- 不改变公开消息、CampTurn、ContextManifest、Runtime Input Delivery 或 Native Session ACK 权威；
  Runtime 修复只从运行时产生的、与当前 Session/Prompt 绑定的 evidence 获得 ACK，不把 child start、
  stdin/pipe write、Hook/init 或本地 send 当作 accepted。
- 不把 Skill 正文注入 Dynamic Context，不把默认分组解释为 Runtime/模型已读取或获得额外权限；
- 不持续覆盖用户对内置或 Imported Skill 分组的后续修改，导入内容仍不授予额外执行权限。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.57 冻结为 historical，v0.58 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 已更新 | ADR-0156 局部替代永久 fingerprint 条款；ADR-0157 局部替代 ADR-0137 的旧 instruction ownership 条款；ADR-0158 局部替代 Skill 默认不分组条款；ADR-0159 完整替代 ADR-0150 并把固定上游 Revision 的 `tasteful-ui` 加入官方集合；ADR-0160 局部替代 ADR-0154 的三 Tab Inspector 与重复 Approval surface |
| Contracts | 已更新 | ADR-0157 与 Durable Task v3 删除 execution request、AgentRun persistence/read model 的 `expectedOutput` clean break；Run Process Detail Surface v3 冻结任务/队员 Inspector 与唯一 Approval Dock；不增加 Charter 版本轴；Skill wire shape 不变 |
| Architecture | 已更新 | Built-in Tool Runtime 增加 bounded rebind、显式公共输出义务，以及 Antigravity、Claude Code、ACP 的 runtime-produced accepted evidence；Charter 文案变化不触发 Session 轮换；Skill projection 结构不变，默认策略由 ADR-0158 约束 |
| UI | 已更新 | Stop 命令目标与按钮可见性统一按非终态 AgentRun 所属 Turn 计算；Skill 设置明确全九组默认并使用行级反馈；会话普通正文统一为开放平面，2K 下分离叙述与工件宽度；Camp Inspector 收敛为任务/队员且 Approval 只在 Composer 上方决定 |
| Runtime Activity | 已更新 | Registry 明确稀疏 terminal lifecycle update 不得降级已报告的结构化分类和标题，并补齐 Codex `commandActions` / `changes` presentation mapping |
| Runtime compatibility | 已更新 | 增加 `agy 1.1.12` marker 与 Claude Code `2.1.220` stream focused smoke，并记录六个 ACP Runtime 的共享确认边界；不改变支持范围或十三工具 qualification 结论 |
| Documentation routing | 已更新 | CURRENT 的 Skills/MCP 主题新增 ADR-0158 与 ADR-0159，领域术语同步默认分组和 `tasteful-ui` 来源边界 |
| Root README | 确认无需更新 | 项目定位和常青能力不变，根 README 不记录版本局部恢复机制 |

## References

- [v0.58 实施与验收计划](implementation-plan.md)
- [ADR-0156](../../adr/0156-logical-runtime-identity-and-bounded-installation-rebind.md)
- [ADR-0158](../../adr/0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0159](../../adr/0159-pinned-third-party-tasteful-ui-bundled-skill.md)
- [ADR-0160](../../adr/0160-focused-camp-inspector-and-single-approval-surface.md)
- [Run Process Detail Surface v3](../../contracts/run-process-detail-surface-v3.md)
- [Built-in Tool Runtime architecture](../../architecture/builtin-tool-runtime.md)
- [Runtime compatibility register](../../runtime-compatibility.md)
