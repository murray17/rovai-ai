---
document_type: contract
contract: builtin-tool-transport-v12
status: accepted
target_version: v0.85
last_updated: 2026-08-15
---

# Built-in Tool Transport v12

v12 完整替代 [Built-in Tool Transport v11](builtin-tool-transport-v11.md)。v11 的 Unix IPC、Core
Envelope、receipt、Replay、Agent Output v2、process lease、single-JSON stdout、Task、Camp/History、Send
和 Memory 语义保持；v12 增加第十四项 `member.create`，供已获得用户确认的 Agent 创建队员。

## Fixed commands and versions

```text
rovai send
rovai member create
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory view|search|read|write
```

固定集合为十四项；没有 generic discovery 或 family help alias。

```text
BUILTIN_TOOL_CONTRACT_VERSION = 12
BUILTIN_TOOL_CLI_COMMAND_VERSION = 12
Runtime capability = builtin_cli.transport.v12
IPC protocol = 1
Envelope = 1
receipt = 1
Agent Output = 2
```

v11 或更早 capability 不能满足 v12 Binding compatibility。Catalog digest 继续覆盖全部 description、closed
input/output schema、CLI mapping、error contract 与 Agent projection。

## `member.create`

CLI mapping：

```text
member.create -> rovai member create
```

输入为 closed camelCase object；直接参数、stdin/heredoc 与 `--input-file` 继续互斥：

```json
{
  "creationKey": "2b945f3f-4b45-4ae5-92b2-739fce600338",
  "displayName": "Nova",
  "teamRole": "研究与证据整理员",
  "professionalResponsibilities": "整理证据并交付有界结论。",
  "personalityTraits": ["审慎", "好奇"],
  "workingPrinciples": "区分事实、推断与不确定性。",
  "growthTopic": "缩短高标准分析与试验之间的反馈回路。",
  "avatarFile": "/run-readable/path/avatar.png"
}
```

`creationKey` 和 `displayName` 必需。`creationKey` 必须是 canonical lowercase UUID；其余身份字段默认空值，
并继续受 AgentProfile 六字段上限约束。`avatarFile` 可省略；它只接受当前 AgentRun 中 Core 可读的本地
PNG/JPEG 普通文件路径，最长 4096 字符。路径不是领域数据，不进入 AgentProfile、Command payload、
Canonical Result 或 Execution Evidence。

成功 Canonical Result 和 Agent Output 使用 `canonical-result-v1`：

```json
{
  "agentId": "agent_27",
  "version": 1,
  "avatarRef": "rovai://member-avatar/managed/2b945f3f-4b45-4ae5-92b2-739fce600338",
  "avatarStatus": "saved"
}
```

无头像时 `avatarRef = null`、`avatarStatus = not_requested`。成功只证明队员身份已写入名册；不配置
Runtime、模型、权限、Presence、Camp membership、Default Lead 或 Memory。

## User authority and idempotency

Core 只接受 attested active AgentRun，并额外要求该 Run 为 `direct` 且 trigger CampMessage 的作者为当前
User。A2A、系统触发或无法证明 direct user trigger 的 Run 返回
`member.user_confirmation_required/stop`。`member-studio` 还要求 Agent 在调用前展示完整队员名牌并取得
明确确认；Core 的 attestation 是最低授权门，不把自然语言确认卡变成第二套持久协议。

领域命令身份为 `member-create:<creationKey>`，actor 固定投影为当前 User，不包含 AgentRun、临时路径或
transport request ID。因此同一个 `creationKey` 与同一最终身份/头像引用可跨 CLI request 重放；同 key
绑定不同身份或不同头像返回 `member.creation_key_conflict/stop`。名称冲突返回
`agent_profile.display_name_conflict/fix_input`；用户修改名牌并重新确认后应使用新 key。

## Avatar import

头像输入边界固定如下：

- 只按字节识别静态 PNG/JPEG；选中文件最大 10 MiB，最小边 256，最大边 8192，最大 3200 万像素；
- 打开普通文件时拒绝符号链接，并对 decode allocation 设置有界限制；
- 应用方向、剥离元数据，以 PNG 保存最长边不超过 2048 的 source；
- 默认方形裁切以短边为边长、横向居中；竖图从顶部约 5% 开始并受可用范围限制；
- 生成 192×192 PNG icon；source、icon、manifest 分别受现有 Managed Avatar 上限约束；
- asset ID 直接使用 `creationKey`，输出 canonical
  `rovai://member-avatar/managed/<uuid>`；同 ID 的既有完整资产必须逐 digest 匹配，否则冲突；
- 使用 `userData/member-avatars/.tmp-<uuid>` 私有目录和原子 rename，写出的 manifest v1 与 Electron Main
  当前读取合同一致。资产先于 AgentProfile command 发布；后续名称冲突允许留下受管 orphan，由既有清理
  策略处理，不回滚到外部源文件。

Electron Main 继续拥有 Renderer 上传路径；Core 新增的唯一写路径是 attested `member.create` 的受限本地
导入。两者必须产生同一 managed reference 与 manifest，而不是开放通用文件写入或私有 Main↔Core bridge。

## Errors and recovery

`member.create` 除 transport 通用错误外固定声明：

| code | recovery |
| --- | --- |
| `member.invalid_creation_key` | `fix_input` |
| `member.invalid_identity` | `fix_input` |
| `member.avatar_invalid` | `fix_input` |
| `agent_profile.display_name_conflict` | `fix_input` |
| `member.user_confirmation_required` | `stop` |
| `member.creation_key_conflict` | `stop` |

头像导入失败发生在领域命令前；Agent 可修复文件，或在已确认方案允许时省略 `avatarFile` 重试同一 key。
`confirm_outcome` 规则保持 v11：先确认名册状态；不得以新 key 盲目重复创建。

## Evidence and qualification

Evidence projection 保留 `creationKey`、有界身份语义、`avatarFilePresent` Boolean，以及结果中的
`agentId/version/avatarRef/avatarStatus`；不得保存本地路径或原始图片字节。

确定性 gates 至少覆盖：

- v12 constants/capability/catalog digest 与十四项唯一 CLI mapping/help/golden projection；
- direct user-triggered Run 成功、A2A 拒绝、同 key replay 与 changed-input conflict；
- PNG/JPEG sniff、边界限制、4:5 默认粗裁、manifest v1、私有权限、原子发布与 digest conflict；
- 头像路径不进入 Command、Canonical Result、Agent Output 或 Evidence；
- 十三项 official Skill inventory、`member-studio` 内容与旧 imported 同名项的原地 official 晋升；
- v11 context/capability compatibility fence。

真实 Runtime smoke 必须在既有十三项之外成功执行一次无头像 `member.create`，并证明十四项 terminal
Evidence 集合。带头像路径的确定性 Core 测试独立覆盖，不要求每个 Runtime 都生成图片。

## Unchanged v11 rules

Memory View/Read/Write、Camp/History/Task/Send、Current User Attention、input-source mutual exclusion、CLI local
errors、Core Envelope、receipt、Replay、host evidence、process lease、current Camp derivation、line-leading
display-name alias 和 external MCP boundary 原样继承。

## References

- [ADR-0191: Agent-Mediated Member Creation and Thirteen-Skill Inventory](../adr/0191-agent-mediated-member-creation-and-thirteen-skill-inventory.md)
- [Built-in Tool Transport v11 (historical)](builtin-tool-transport-v11.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
- [ADR-0056: Controlled Member Avatar Assets](../adr/0056-controlled-member-avatar-assets.md)
