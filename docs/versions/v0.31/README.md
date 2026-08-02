---
document_type: version-overview
version: v0.31
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: in_progress
last_updated: 2026-08-02
---

# Rovai-ai v0.31 Default Team Delivery Qualification

> 中文名：默认团队交付资格评测
>
> 状态：工具对等、评测设施与修复后 CAL-001 校准已通过；十二次自主 Trial 尚未启动，版本保持进行中
>
> 前置版本：[v0.30 Antigravity 受证明 Team Bridge](../v0.30/README.md)
>
> 跨版本决策：[ADR-0089](../../adr/0089-attested-built-in-mcp-tool-parity.md)、
> [ADR-0090](../../adr/0090-team-delivery-qualification-evidence-boundary.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

先消除 Antigravity 在 Rovai 内置 MCP 工具上的已知运输层缺口，再首次回答一个此前没有
实证的问题：把一个有明确验收合同的软件交付任务只发送给默认 Lead，此后不再人工干预，
当前默认四角色团队能否在固定预算内产出由外部 verifier 验证的工作区结果，并使完整
AgentRun 树收敛。

本版本是 **Qualification**，不是 Benchmark v1。它只对一个冻结的生产团队配置、四类
Rovai 技术栈案例和一个记录完整的本机环境产生探索性证据；不证明团队优于 Solo Agent，
不归因单个角色的因果贡献，也不声称统计显著性或通用编程能力。

## 两个顺序门禁

### Gate 1：Antigravity 完整内置 MCP 工具对等

v0.30 的 attested Bridge 只开放 `post_message`。v0.31 必须先让 Antigravity 通过同一受证明
attachment 使用当前固定 Gateway 的全部十三个 Team、Context Retrieval 和 Memory 操作：

- Team：`post_message`、`create_task`、`update_task`、`list_tasks`；
- Context：`context_search`、`context_get_message`、`context_get_message_window`、
  `context_get_message_thread`、`context_get_summary`；
- Memory：`memory_search`、`memory_read`、`memory_write`、`memory_propose_hearth`。

这些无点号名称只属于 Antigravity 原生 MCP dialect；Core 继续使用规范的
`team.* / context.* / memory.*` identity。Schema、回执、幂等、Capability、Task 版本、
Context 边界、Memory Policy、配额和 fencing 必须与其他 Runtime 共用同一实现。

完整十三工具的真实模型正向 Smoke、权限/Capability 负例和普通非 Rovai `agy` 空目录负例
全部通过前，不得进入团队资格评测。

### Gate 2：默认团队端到端交付资格

Gate 1 通过后，先运行一个不计分的协作链校准案例。校准只证明 Team Tool、上下文交接、
回传和 Lead 集成链可工作，不产生自主协作成绩。校准通过后才运行四个自主案例，每个三次
完全独立 Repeat。

一次 Formal Qualification Trial 只有同时满足以下两项才通过：

- **Verified Delivery**：外部 verifier 的构建、公开、隐藏、需求、回归和禁止修改检查全部通过；
- **Orchestration Convergence**：完整 AgentRun 树在时间、Run 和 A2A 预算内进入终态，且任务
  成功投递后没有人工消息、审批、修改、命令、重启或继续提示。

Agent 自称完成、Reviewer 同意或 Task 标为 `completed` 都不是验证证据。

## Qualification Team Configuration

四位成员都加入 `peer` Camp，小狐狸是 Default Lead。自主案例只发送普通目标与约束，不写
角色名或协作步骤；是否委派、委派给谁以及何时停止委派属于被测能力。未运行的 CampMember
仍属于团队配置，但不算该案例的实际参与者。

| 成员 | 固定 Runtime 与模型 | 固定原生权限 | 长期职责 |
|---|---|---|---|
| 小狐狸｜游学者 | Codex `gpt-5.6-sol`，`reasoning_effort=medium` | `danger-full-access`、`never` | 调查、规划、主实现与最终集成 |
| 小河狸｜鉴定士 | Codex `gpt-5.6-sol`，`reasoning_effort=medium` | `danger-full-access`、`never` | 方案/代码审查、边界与风险 |
| 咕咕｜巡夜人 | OpenCode `opencode/north-mini-code-free` | `permission=allow` | 复现、测试、失败路径与回归 |
| 小兔｜绘图师 | Antigravity `gemini-3.6-flash-high` | `accept-edits`、sandbox on、skip-permissions on，加完整十三工具精确权限 bundle | UI/UX、前端实现与交互一致性 |

首轮不修改四位成员的预设身份职责、Working Principles 或 Growth Topic，不安装评测专用
Skill，也不在 Session Charter 中增加 benchmark 编排提示。看过正式结果后的任何角色、模型、
权限或 Prompt 调整都形成新的 Team Configuration 版本，不能覆盖本轮结果。

原始 Team Configuration 的 `skip-permissions=off` 校准失败被永久保留。真实非交互 AGY 运行
证明普通终端命令仍会等待无法显示的审批后，修复配置显式改为 per-run
`--dangerously-skip-permissions`，同时保留 `sandbox=on` 和 credentialless attested Bridge。
这是新的 Team Configuration，不覆盖原结果，也不把 sandbox 声明为严格安全边界。

## 首轮案例组合

计分案例来自外置、非公开的 Sealed Qualification Pack，不使用 Rovai 历史提交。它们使用
Rovai 的真实技术栈但采用中性微型产品领域，避免把既有仓库知识误当成通用交付能力。

| 案例 | 技术范围 | 协作诊断预期 | 总时限 | 最大 AgentRun | 最大 A2A |
|---|---|---|---:|---:|---:|
| CAL-001 协作链校准（不计分） | 小型全栈交接 | 显式覆盖 Lead、Reviewer、Tester、Frontend 及回传 | 30 分钟 | 10 | 9 |
| TQ001 局部简单修改 | TypeScript | Lead 通常可独立完成；诊断过度委派 | 12 分钟 | 3 | 2 |
| TQ002 后端可靠性缺陷 | Rust；恢复、幂等或竞态 | Lead、Reviewer、Tester 相关；Frontend 通常无关 | 25 分钟 | 8 | 7 |
| TQ003 前端交互缺陷 | React + TypeScript；键盘、可访问性、响应式 | Lead、Frontend、Tester 相关；Reviewer 可选 | 25 分钟 | 8 | 7 |
| TQ004 跨层功能 | Rust Core + JSON Contract + React/TypeScript | 四角色均有合理参与机会 | 40 分钟 | 12 | 11 |

“相关/无关角色”只进入协作诊断，不是交付硬门槛。优秀协作既包括正确委派，也包括知道何时
无需委派。

## 重复与结论语言

四个自主案例各执行三次，共十二个计分 Trial。每次使用全新 workspace、Core data
directory、Camp、Conversation 和 Native Session，不继承 Task、Memory 或执行连续性。

- 只报告每案例 `0/3`、`1/3`、`2/3`、`3/3`、总 Pass Rate 和原始结果；
- 不使用会掩盖间歇失败的 `Pass@3`；
- 至少 `1/3` 只能表述为在该案例上“已展示能够完成”；
- `3/3` 只能表述为“在本次小样本中重复通过”；
- 四类均至少一次通过，才可表述为展示了完整首轮任务覆盖；
- `12/12` 才可表述为本次资格套件全量重复通过；
- 所有结论继续标注为探索性证据，不外推统计显著性或其他技术领域。

校准通过后按三个 Round 串行执行；每轮含四个案例，顺序由记录的固定 seed 打乱。单个有效
失败不提前终止剩余案例，只有环境漂移、Case Seal 不一致或投递前无效条件才暂停套件。

## 三层报告，不合成总分

本版本输出：

1. **硬结果**：Verified Delivery、Orchestration Convergence、Overall Pass、预算使用；
2. **Collaboration Evidence Matrix**：实际参与者、委派图、交接闭合、A2A 深度、重复路由、
   文件重叠、反馈吸收证据、循环和预算占比；
3. **可选人工盲审材料**：对无法由权威事实判断的工程与协作语义进行事后审阅。

不发布综合协作分、排行榜或 LLM Judge 结果。无法可靠自动归因的项目明确记录为
`indeterminate`，不能用猜测填满矩阵，也不能改变硬结果。

## 执行、密封与证据边界

- Formal Trial 由独立 CLI Runner 通过公开 stdin JSON-RPC 驱动一个记录 digest 的打包
  Release Core；Renderer、Debug Core、直接 SQLite 修改和复用日常 Camp 都不能产生正式证据。
- 正式运行要求桌面 App 和其他 Rovai Core 已退出；Runner 只检测并拒绝竞争，不自动杀进程。
- 每个案例在计分前证明健康基线、稳定初始失败、参考实现全通过和 verifier 确定性，并冻结
  Prompt、fixture、verifier、预算与修改边界的共同 Seal。
- Trial workspace 是一次性、只有一个 Runner 基线提交且无 Remote 的 Git 仓库；正确性不按
  参考 patch 相似度判定。
- Withheld Verifier、参考实现和完整评分点不进入 Run Workspace 或开源仓库，并在所有 Runtime
  进程终止后运行。这是非对抗性信息隔离，不是抵抗同用户恶意进程的 OS 沙箱声明。
- 使用宿主真实 Runtime 账户、模型服务、冻结权限、网络和可见工具，不增加 benchmark 专属
  网络限制。Antigravity 的 `PreservedUncontrolled` ambient MCP 必须写入环境披露。
- 原始 Qualification Evidence Bundle 私有保存且成功/失败同等保留；只在用户显式操作后导出
  不含 Runtime 私有日志、凭据、环境变量值、隐藏推理、verifier 或参考答案的脱敏摘要。

## 明确不在范围

- Solo Codex、lead-review、generic-four 或其他对照配置；
- Reviewer/Tester/Frontend/Lead 的角色消融或 mutation 专项评测；
- Rovai 历史提交反向案例和其他技术栈；
- LLM Judge、综合分、排行榜或统计显著性结论；
- Renderer “协作实验室”页面；
- 使用真实账户的 CI 自动 Trial；
- 把 Antigravity 内置工具对等误报为外部 MCP 投影或严格 ambient MCP 隔离；
- 把非对抗性 withheld verifier 宣传为安全沙箱。

## 当前实现事实

截至 2026-08-02：

- credentialed 与 attested 两条运输已共用一个十三工具 canonical catalog、Schema、统一 Core
  handler、结构化回执和按 AgentRun 隔离的幂等 identity；
- Antigravity 受管 Plugin 使用十三条精确权限 bundle，完整性、ownership、CAS、journal、
  Session compatibility 与 fail-closed 状态均已落地；
- 打包 Release Core 已分别通过 Antigravity、Codex、OpenCode 的十三工具真实调用。Antigravity
  正例还验证了 A2A、Task、Context、Memory、重启不重复；普通非 Rovai `agy` 的工具目录为空，
  十三次 direct call 均为 `run_not_bound`，领域写入为零；
- out-of-process Qualification Runner、公开 demo、私有 Sealed Pack admission、离线 verifier、
  私有 Evidence Bundle、零人工边界、预算取消和 Collaboration Evidence 已实现；公开 demo 在
  同一打包 Core 上得到 `Verified Delivery=true` 与 `Orchestration Convergence=true`；
- 原始 CAL-001 仍记为有效失败：四名成员均被派发，Antigravity Run 在 84.5 秒进入
  `delivery_unknown`，Runner 自动取消完整 Run 树；
- 修复消除了 Prepared Binding 下 Task/Context/Memory 的错误 fencing、AGY workspace 路径缺失、
  非交互命令审批、空 final output 的模糊交付分类，以及 A2A Task 引用丢失；Default Lead 现在
  可以更新本 Camp 的非终态 Task，普通成员仍不能越权更新他人 Task；
- 修复后 CAL-001 使用同一密封 Case 与原 30 分钟 / 10 Run / 9 A2A 预算正式通过：
  `valid`、`Verified Delivery=true`、`Orchestration Convergence=true`、零投递后人工干预，
  四名成员全部参与，实际 7 AgentRun / 6 accepted A2A；AGY 真实调用了 Context Search、
  Memory Search、Companion Memory Write、Task List/Update 与 Team reply；
- 十二次 Autonomous Qualification Trial 尚未运行，Pass Rate 仍不存在。校准只证明协作链路
  已可用，不构成默认团队的自主交付成绩。

详细 Release digest、测试数量、校准结果和仍未满足的完成定义见
[implementation-plan.md](implementation-plan.md)。

## 设计状态

用户于 2026-08-02 逐项确认资格命题、默认团队、完整 Antigravity 内置 MCP 工具对等、
校准/自主分层、严格双门槛、零人工边界、案例组合、密封模型、Repeat、预算、报告、环境冻结、
真实网络、证据保留和版本排除项，并最终确认已形成共同理解。ADR-0089、ADR-0090 与本版本
实施设计共同冻结这些边界，并在同日另行明确授权开始实施；任何生产代码完成度和正式成绩
只能更新 [implementation-plan.md](implementation-plan.md)，不得从 `accepted` ADR 推断。
