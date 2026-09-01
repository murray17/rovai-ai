---
document_type: model-context-change
version: v1.37
revision: 3
confirmation_status: confirmed
confirmed_revision: 3
confirmed_by: murray.xue
confirmed_at: 2026-09-01
last_updated: 2026-09-01
---

# 行首连续队员 Mention Cluster

revision 3 保留 revision 2 的最小 Agent-visible 教学，并撤回其新增的 invalid-tail 原子拒绝：Parser 只扩展
连续有效 mention，不把未知、歧义或 `@Principal` 从既有普通文本升级为错误。Agent 使用独立 `--to` 字段
投递；inline addressing 只保留为 Core 兼容与运维兜底。

## 变更前

`camp.message.send` 的 Agent-visible `body` schema description 完整文本为：

```text
Optional exact public message body; omit it when at least one file supplies the complete payload. Canonical inline @agent_N tokens retain their existing positions. An exact active Camp member @display-name alias participates only as the first non-whitespace token on a line and must be followed by whitespace or end-of-body; put trailing routing on a dedicated final line. Code, URLs, and escaped literal regions are excluded.
```

当前解析语义为：

- canonical `@agent_<positive integer>` 在既有 parseable body region 的任意位置均可寻址，同一行可出现多个；
- exact current-Camp display-name alias 只有在 logical line 的第一个非空白 token 处才可寻址；
- 因此 `@惠 @响子 请一起处理` 只把 `@惠` 结构化并路由，`@响子` 保持 Text；
- `@惠\n@响子 请一起处理` 可以路由两人；mid-line `讨论 @惠 的方案` 不路由；
- display-name lookalike 在不允许的位置是普通 Text；malformed reserved canonical token 仍原子拒绝。

## 变更后

`body` schema description 完整替换为：

```text
Optional exact public message body; omit it when at least one file supplies the complete payload.
```

Agent-visible `body` help 不再公开任何 inline addressing 写法、位置或失败规则。`--to` 的既有独立 help
继续要求 canonical Agent ID，并保持 Agent recipient authoring 的唯一推荐入口。PublicOnly 与 operation summary
中的 inline addressing 只保留安全边界警告，不提供可照抄的 alias grammar。

新的解析语义精确定义如下：

1. 一个 logical line 从 body byte zero 或 `\n` 后开始；可在 cluster 前保留任意 Unicode whitespace。
2. 当该行第一个非空白 token 成功解析为 canonical `@agent_N` 或 exact active-Camp display-name alias 时，
   该行进入 Mention Cluster。
3. 每个成功 token 后，只要仍在同一 logical line、存在至少一个 Unicode whitespace 且下一个非空白字符为
   `@`，就尝试解析下一个 cluster token；cluster 不跨越 `\n`。
4. 下一个非空白字符不是 `@` 时，cluster 正常结束；后续 display-name lookalike 继续作为普通 Text，
   canonical `@agent_N` 仍保留原有 mid-line 解析能力。
5. Cluster 启动后，紧随的 `@token` 若不能解析为唯一、有效的 current-Camp exact display name，则 cluster
   在上一个有效 occurrence 后结束；该 display-name lookalike 保持普通 Text，发送不因此拒绝，后续 canonical
   token 仍按既有 mid-line 语义解析。首 token 从未成功启动 cluster 时，未知或歧义 display-name lookalike
   同样保持 Text。既有 malformed canonical `@agent_*` 拒绝语义不变。
6. Canonical precedence、最长完整 display-name match、完整名字后的 whitespace/EOF boundary、case-sensitive、
   code/URL/escape exclusions、self/ancestor/membership/depth/budget/fanout 检查全部不变。
7. 每个有效 source occurrence 都成为独立 `MemberMention`，顺序和中间原始 whitespace 由 Structured
   Content 保留；Effective Recipients 继续按 canonical Agent ID 去重排序，每位成员只创建一个 Delivery。
8. `--public-only` 继续在 roster/alias lookup 和正文解析之前旁路，完整 body 保持 Text；`taskId` 在去重后
   仍要求恰好一个 Effective Recipient。

关键结果：

| 输入 | 结果 |
| --- | --- |
| `@惠 @响子 请一起处理` | 两个 MemberMention、两个 Effective Recipients、两个 Delivery |
| `@惠 @惠 请处理` | 两个 occurrence、一个 Effective Recipient、一个 Delivery |
| `@agent_2 @响子 请处理` | canonical + display-name 两个 occurrence，按既有规则去重 fanout |
| `讨论 @惠 @响子 的方案` | display-name 均保持 Text，不路由 |
| `@惠 @不存在 请处理` | 只路由惠；`@不存在 请处理` 保持 Text，发送不拒绝 |
| `@惠 @Principal 请处理` | 只路由惠；`@Principal 请处理` 保持 Text，Principal attention 仍只用 `--to-principal` |
| `--public-only --body '@惠 @响子 请处理'` | 完整正文 Text，零 Effective Recipient、零 Delivery |

## 明确不变

- Session Charter 使用已确认的 revision 4 文本，只教学 `--to-principal`；本变更不再修改 Charter bytes。
- `rovai send` summary、`--to`、`--to-principal`、`--public-only`、`--file` 独立 help 和三条示例逐字不变。
- `--to` 继续是 Agent recipient authoring 的唯一公开推荐入口；inline canonical/display-name parsing 不是
  Agent 教学能力，不在 `body` schema description 中暴露。
- canonical `@agent_N` 的 mid-line 解析、malformed reserved token 拒绝、最多 16 个 recipient、A2A depth/budget、
  caller return、Gather capture、Task admission 与 Message Reply Reference 不变。
- PublicOnly、Principal Attention、Current User Mention、Agent/Human audience projection、Renderer 和剪贴板不变。
- CampMessage、Structured Content segment shape、Message Delivery、event、receipt、Agent output、Wire、Schema shape、
  数据库表与 Migration 不变；不迁移或重写历史消息。
- MEMBER_IDENTITY、Memory Entrypoint、Dynamic Context sections、History/Task/Gather 选择与预算、ContextManifest
  shape、Delivery Profile 和 Runtime Input shape 不变。

## 版本、迁移与恢复

Agent-visible body description 改变 `builtin_tool_catalog_digest`，因此下一次正常执行通过既有 Adapter Binding
compatibility 路径替换携带旧 catalog digest 的 Native Binding；不新增 Session restart 机制。Camp Message
Send 合同从 v17 前进到 v18，但 input/output JSON shape、Built-in Tool Transport v21、CLI/capability version、
IPC、Envelope、receipt 与 Agent Output version 均不变。

Session Charter revision 保持 4；Native Session Bootstrap contract v3、Bootstrap Formatter 3、AgentRun
Formatter 22、ContextManifest 22 和 Context Delivery Profile 4 均不变。历史 Binding、Bootstrap Evidence、
Manifest、message、receipt 与 Delivery 保留原始 bytes/digest/recipient set，不原地重算。升级前已接受的同一
request identity 继续按既有 idempotent receipt replay；新 request identity 才按 cluster grammar 解析。

没有数据库迁移、历史回填、双写或 wire clean break。

## 二次确认

开发者在阅读 revision 2 的完整 schema 文本后于 2026-09-01 明确回复“确认”，因此 revision 1 的冗长
cluster 教学已经撤回。实施中开发者进一步核对 invalid-tail 行为，明确要求若旧行为不拒绝就不要新增拒绝、
“别太严格”。revision 3 据此只撤回新增严格失败语义，保留已确认的最小 schema 文本和多 mention 目标。
`--to` 仍是唯一推荐 Agent recipient authoring 入口，inline cluster 只保留为 Core 兼容与运维兜底。

## 验证

- 扩展并重命名既有 parser owner `display_name_alias_requires_the_first_non_whitespace_position_on_a_line`，保留
  所有旧正负例，增加 display/display、canonical/display、duplicate、literal invalid-tail、newline 和
  cluster-end 矩阵；不新增平行纯 parser 测试函数。
- 扩展既有 slow SQLite owner `public_send_resolves_active_member_display_name_alias_before_delivery` 为两名成员，
  验证原正文、两个 Structured occurrence、canonical Effective Recipients、每成员一个 Delivery；修复前该
  owner 只会得到第一个 recipient。既有 mid-line public-text owner 保持。
- 更新既有 schema teaching owner，逐字断言 `body` description 只保留正文载荷说明，并负向断言不公开
  `@agent_N`、`@display-name`、cluster 或 dedicated final line；扩展现有 PublicOnly owner 证明不解析
  cluster，不建立新的完整数据库 fixture。
- 定向命令后运行 `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `pnpm test:rust:pr`、`pnpm test`、`pnpm typecheck`、`pnpm build:desktop`、文档普通/固定 base CI 门禁和
  `git diff --check`。不调用真实 Runtime 或模型；打包 App 只使用独立临时 userData/Skill Library 验收，
  日常安装使用 non-terminating daily install gate。
