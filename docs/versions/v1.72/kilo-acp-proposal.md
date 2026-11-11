---
document_type: implementation-proposal
version: v1.72
authority: proposed-runtime-integration
status: accepted
revision: 1
confirmation_status: confirmed
last_updated: 2026-11-08
---

# Kilo 官方 ACP 接入提案 R1

User 在本 Thread sequence 4（`0112e4da-7599-49ba-9a3b-0371e9d62d5d`）确认本 R1。
[独立输入说明](model-context-change-kilo-acp.md)保存相同的 B/P 投递合同和真实确认；产品接入已按本 R1 实施，当前状态见[实施记录](kilo-acp-implementation.md)。

研究基线、14 轴矩阵及实测范围见 [Kilo 原生证据](../../research/kilo-runtime/README.md)。

## 采用的最小结构

- 产品身份为 `kilo-cli`，入口仅为官方 `kilo acp`；使用 Kilo 原生认证、Provider、模型与数据目录。
- 参考生产 OpenCode ACP；复用共享 ACP Client/Host、RuntimeFleet、Binding、原生审批、
  Built-in CLI、MCP projection、Activity 和 Monitoring。不把 Kilo 的版本号送进 OpenCode V1/V2 判断。
- 一个 Host 服务同一成员的同一 Native Binding；沿用共享 Fleet 健康、空闲和兼容复用。
  不引入跨 Binding 的同 Host 多 Session，不增加 Kilo 私有池或锁。
- 唯一原生配置薄层负责启动参数、进程环境、原生 permission 和 instructions 文件路径；
  不扫描/复制原生 HOME、认证或全局配置，不修改项目 AGENTS.md。
- 仅在 Host 启动配置中追加受管 instructions 文件；每 Run 正文发送前写入该 Run 冻结的 B。
  原生每次模型请求读取它，因此不注册压缩插件、hook、nonce 或文件握手。
- 分配 MCP 通过既有 `session/new|load|resume.mcpServers`。实际 Assignment 变化复用既有成员
  Host invalidation；忙碌 Host 正常结束后退役，后继 Host 用保存的精确 Session ID 恢复。
- 用量复用已有逐消息 SQLite reader，通过 Runtime kind/原生数据根选择 Kilo 数据库；
  不复制第二份 reader。ACP 最后一步 usage 不能充当整 Run 用量，context gauge 与计数分开。
- 不增加 SHA256 校验、二次文件审批、额外路径沙箱、配置镜像或定时健康扫描。

## 模型输入说明 R1

### 变更前

当前闭集没有 `kilo-cli`，不会向 Kilo 投递 Rovai 模型输入。
最接近的 OpenCode ACP 使用 `first_payload`：普通首次 user 输入为
`B + "\n\n" + P`，后续 user 输入沿现行去重/补发规则交付 P；这不是 Kilo 已有合同。

定义：

- B：共享 `ContextService.prepare_session_bootstrap` 为当前 Run/Native Binding 准备的完整冻结
  `bootstrap.payload` 原始 UTF-8 字节。
- P：共享 ContextManifest/Delivery 已冻结的 Dynamic Context 原始 UTF-8 字节。
- N：Kilo 自己产生的原生 System、用户原生规则和其他原生内容。
- F：当前 Host 私有目录内固定的绝对 instructions 文件路径；Host 生命周期结束后由共享 owner 清理。

### 变更后

只新增 Kilo 的 `managed_system_prompt` 投递路由；B、P 的 formatter、section、字段、省略、
选择、排序和预算均复用现行实现，不复制格式化器。

| 时点/位置 | Kilo R1 的精确行为 |
| --- | --- |
| Host 启动 | 合并现有进程级 `KILO_CONFIG_CONTENT`，在 `instructions` 数组追加一次绝对路径 F；保留原生配置来源 |
| 每 Run 普通输入前 | 共享 owner 在 Host 已归属本 Run 且前一 Run 静止后，将完整 B 原字节写入 F；写失败即不投递 P |
| 原生普通模型请求 | Kilo 读取 F，将 `"Instructions from: " + F + "\n" + B` 放入其 System 指令集合；组合和原生其他文本由 Kilo 拥有 |
| `session/prompt.prompt` | `[{"type":"text","text":P}]`；不额外加入 B、解释语或伪造用户请求 |
| warm | 正文发送前使用本 Run 的 B 更新同一 F；不为 B 正文变化重启 Host |
| exact cold resume | 共享恢复路径携带保存的完整 nativeSessionId；新 Host 新建 F，发送 P 前写入本 Run 的 B |
| 手动/自动/overflow 压缩后的普通生成 | 采用 `native_system_prompt_preserved`；Kilo 按原生规则再次读取 F，不向 user 历史补发 B |
| 接受未知或已接受输入的恢复 | 沿用原有冻结 Delivery，不重新发送已接受或不确定的 P |

已实测原生普通请求、warm 文件更新、手动压缩后普通请求和 cold resume 的 System 读取。
自动压缩、overflow、正式 Core 证据链和真实付费模型仍待实施后验收；不把这些范围写成已经通过。
原生摘要请求的具体 System 由 Kilo 拥有；本方案承诺压缩前后普通业务生成继续获得完整 B，
不在原生摘要中额外拼入自定义指令。

B 的完整区段结构如下；尖括号表示共享 formatter 返回的原文字节，不是新文案：

```text
[SESSION_CHARTER]
<现有 Charter 原文>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<现有本人身份 JSON>
[/MEMBER_IDENTITY]

[TEAM_GUIDANCE]
<仅在现行合同规定的来源非空时出现的团队指引原文>
[/TEAM_GUIDANCE]

[ROVAI_PLATFORM_SKILLS]
<现有平台 Skill 索引>
[/ROVAI_PLATFORM_SKILLS]

[MEMORY_ENTRYPOINT]
<仅在现行合同规定的来源非空时出现的记忆入口原文>
[/MEMORY_ENTRYPOINT]
```

TEAM_GUIDANCE 或 MEMORY_ENTRYPOINT 不成立时，整个 section 连同占位文字一起省略。
身份、Charter 与 Skill/Memory 来源直接服从现行共享组装；Kilo 薄层只写 B，不解析、改写或截断它。
P 完整沿用当前 [ContextManifest v43/v44](../../contracts/context-manifest-evidence-v44.md) 与
[Profile v15/v16](../../contracts/context-delivery-profile-v15.md)，不新增 Runtime 私有 JSON 字段。

### 明确不变

- 现行 Bootstrap contract v6/formatter 6、Charter、Binding compatibility、Manifest 与 Profile 版本均不递增。
- 用户输入、历史/附件/Skill 选择、公开消息、Steer、身份冻结及现有 Runtime 的模型输入保持。
- B/P 分别沿现行 managed-system 通道预算；必须材料超预算时拒绝准备，不截断、不自动摘要。
- 沿用共享 Bootstrap Evidence 对 B、ContextManifest/Delivery 对 P 的证明；不新增 Kilo checksum、
  文件 hash、nonce、装载收据或运行期内容比对。
- 新 identity 的闭集 Migration 只增加 Kilo；不失效或改写旧 Runtime 的 Binding、冻结输入和证据。
- 不导入用户历史、不复制另一 Runtime 认证；Host 配置变化不自动将合法旧 nativeSessionId 判为丢失。
- ACP 原生 stopReason/错误/取消仍决定终态；合法空 end_turn 不制造消息，不额外调用模型。
- 原生审批是唯一权限决策源，迟到/取消通过现有 Run/Prompt/epoch fence 处理。

### 二次确认

User sequence 4 已确认 revision 1；消息与时间见[独立输入说明](model-context-change-kilo-acp.md#二次确认)。

### 验证

扩展已有测试 owner，不增加镜像实现的低价值测试：

1. 共享 Adapter/发现/准入/闭集 Migration owner：Kilo 身份、原生默认模型、显式模型原值透传、
   permission 原名原值、未准入平台不启动；不为 Kilo 扩大既有资格结论。
2. 共享 ACP/application/Context owner：首次/warm/cold 使用当前 B/P；普通 user 只有 P；
   写 B 失败零业务输入，Run/Binding 不吻合沿既有拒绝路径。
3. 共享 Fleet/MCP owner：同 Binding warm、成员隔离、并发独立 Host、分配撤销后 fresh Host、
   精确旧 Session 续接；不靠改 MCP 名称解决目录内共享状态。
4. 共享 Usage/Activity owner：多 step 本轮消息去重、cold baseline、cache buckets、summary、
   context gauge 和累计费用基线；原生命令输出 snapshot 不重复 append。
5. 真实 Kilo：allow/deny/cancel/迟到回复、后继输入、CLI 公共发送、Skill 实读及更新删除、
   stdout/stderr/empty/nonzero/large、压缩及 crash/timeout/shutdown 清理。
6. 按 [Runtime 接入 checklist](../../development/runtime-integration-checklist.md)完成 14 轴和 9 Flow。
   当前 macOS arm64 原生夹具不能替代付费模型、Core 链路或其他平台验收。

## 实施顺序与收口

确认后按“identity/发现/准入 → 共享 ACP launch/Session → B/P 交付 → MCP/Skills/监控 →
生产链路 Golden Flows → UI 既有目录投影”推进；每步以现有 owner 收口，不建立平行框架。
Core Compatible 只是内部状态。正式目录开放及 preview/qualified 沿当前平台准入合同记录真实决定，
不由本提案自动授予；跨平台结果分别验证。

文档同步真正拥有规则的 Runtime Architecture/Launch、Activity registry、Compatibility 和当前版本记录；
只新增需要的合同版本与重要决定，不创建编号 ADR，不添加功能特例门禁。

Work item: Kilo 官方 ACP 接入。
Worktree: `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-kilo-acp`。
Branch: `rovai/kilo-acp`。
Base: `origin/main @ 958784f6e17fc32d8b2753d7f14fd6122dceea9d`。
Governance: none；当前规范未要求本任务治理文件先进入 main。
Status: active，R1 已实现，macOS arm64 Preview；worktree 保留用于 review。
