---
document_type: model-context-change
version: v1.44
change_id: pi-native-prompt-boundary
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-09-04
authority: confirmed-model-input-change-statement
implementation_baseline: 81d209eab733ecd520ab016440609c1886788a24
implementation_status: implemented
acceptance_status: verified
last_updated: 2026-09-04
---

# v1.44 核心模型上下文变更：Pi 原生普通 Prompt 边界

本说明冻结开发者提供并确认的 revision 1：Rovai 不再模拟 Pi TUI Slash Command，Formatter 22 Dynamic Context
不经二次解释或改写，直接成为 Pi `prompt.message`；图片仍走独立结构化通道。

## 变更前

### 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
Session Charter revision:         5
AgentRun Context Formatter:       22
ContextManifest Evidence:         22
Context Delivery Profile:         4
Pi Runtime Prompt Transform:      1
Pi Prompt Image Evidence:         1
Pi Binding / Receipt schema:      2
Pi managed extension:             rovai-pi-host-v5
```

Formatter 22 先生成完整 `prepared_context.rendered_payload`。Pi 专属路径随后从该字符串末尾反向解析完整
`[CURRENT_INPUT]` JSON，复核其中 `attachments`，并在 direct human input 时读取 activation 的 `get_commands`
catalog。若 `CURRENT_INPUT.message` 的第一个 token 是已识别 `/name`：

```text
source=prompt     -> 读取文件、剥离 front matter、展开 $1/$@/$ARGUMENTS
source=skill      -> 读取完整 SKILL.md，参数追加为 "\n\nUser: ..."
source=extension  -> 拒绝 managed AgentRun
unknown           -> 保持原文
```

Core 将 cloned `CURRENT_INPUT.message` 替换为展开内容，得到第二份 `runtime_payload`，实际发送：

```text
prompt.message = runtime_payload
prompt.images  = images reconstructed after parsing CURRENT_INPUT.attachments
```

私有 `pi_runtime_prompt_transform` 保存 original/runtime 双 digest、Runtime payload Blob、command source path、source/
expanded content Blob、transform JSON、图片数量与集合 digest；`pi_prompt_image_evidence` schema 1 依赖该 transform。
普通未识别消息虽字节相同，也保存 `mode=verbatim` transform。

### Bootstrap

模型 system prompt 在 managed extension 自身 `before_agent_start` hook 位置仍为：

```text
PiCurrentSystemPrompt + "\n\n" + exactBootstrapFormatter3Bytes
```

完整 Bootstrap wrapper、Formatter 22 section 顺序、选择/预算和 omission 规则不因 transform 改变。

## 变更后

### 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
Session Charter revision:         5 (unchanged)
AgentRun Context Formatter:       22 (unchanged)
ContextManifest Evidence:         22 (unchanged)
Context Delivery Profile:         4 (unchanged)
Pi Runtime Prompt Transform:      removed
Pi Prompt Image Evidence:         2
Pi Binding / Receipt schema:      3
Pi managed extension:             rovai-pi-host-v6
```

对每个 Pi Runtime Input Delivery，消息通道只有：

```text
prepared_context.rendered_payload exact UTF-8 bytes
    -> no CURRENT_INPUT parsing
    -> no slash parsing or resource-file read
    -> no cloned message replacement
    -> prompt.message exact UTF-8 bytes
```

因此 `/new`、`/compact`、`/template`、`/skill:name`、Extension command 及任何其他 `/...` 都保持 Formatter 22
当前输入中的普通用户文本。Rovai 不剥离 front matter，不替换参数，不创建 command source/expanded bytes，也不
产生 original/runtime 双 payload。

图片通道独立为：

```text
ContextManifest.attachmentRefs (ordered)
    -> existing attachment authorization
    -> exact bytes + sniffed MIME + SHA-256 + byte length verification
    -> prompt.images (ordered base64)
```

图片证据 schema 2 每项只包含 Delivery identity、index、MIME、content digest 与 byte length，直接绑定
`runtime_input_delivery`。模型最终收到的完整用户输入仍是相同 Formatter 22 payload，加上结构化图片数组；图片不
通过文本 round-trip 获得。

Bootstrap system prompt 的 exact wrapper 和追加位置完全不变。binding/receipt schema 3 只删除 Skill/catalog 证明，
不改变 Bootstrap bytes、digest 或 receipt 与 Input accepted 的原子顺序。

## 明确不变

- Formatter 22 的 section 名称、顺序、JSON shape、消息/历史/Task/Run facts 选择、预算、截断和 omission evidence；
- Bootstrap Formatter 3 的 `SESSION_CHARTER → MEMBER_IDENTITY → MEMORY_ENTRYPOINT` exact bytes 与
  `managed_system_prompt` delivery mode；
- ContextManifest 22、Context Delivery Profile 4、Run Facts 2、SkillMention 和 attachment refs 的生成权威；
- Pi 原生 Extensions、Skills、Context files、Prompt templates 与 Built-in tools；仅 Rovai 不模拟其 TUI command；
- 图片类型、大小门槛、顺序、模型 image capability gate、receipt/accepted 原子事务和 Session continuity 水位；
- 其他 Runtime 的 Adapter transport 与模型输入字节。

## 数据迁移、失效与恢复

Migration 138 把 Data Contract v1.47/schema 88 升为 v1.48/schema 89：旧 image evidence 行原样保留事实并改写
`evidence_version=2`，删除 `pi_runtime_prompt_transform`，不保留其 payload/source Blobs 的引用；普通 Managed Blob GC
随后按既有规则回收无引用 Blob。迁移不改写历史 ContextManifest、Runtime Input Delivery、receipt 或已发送模型输入。

新 writer 只写 binding/receipt schema 3 和 image evidence 2。旧 v1/v2 receipt 仍是历史事实，不被重新解释为新输入
证明。现有 Native Session locator 与 exact resume 不因 Formatter/Profile 版本轮换；只有本次 closed binding schema/
compatibility digest 变化使旧 warm Host 不可复用，新 Run 仍通过正常 exact Session 恢复。

## 二次确认

开发者在 2026-09-04 提供完整 revision 1 前后规则，并明确要求确认后实施、提交 PR 并合并 main。该确认覆盖
普通 `/...` 文本、payload 原样投递、结构化图片、Prompt Transform 删除以及相应数据迁移；实现不得恢复任何
Rovai Slash Command 解释分支。

## 验证

- Rust source/fixture 断言 managed extension 不含 `resources_discover`/`skillPaths`，正式 argv 不含资源禁用参数；
- Pi Host/Context tests 验证 payload 直接发送、图片从结构化 manifest 生成并在 dispatch 前直接留证；
- Migration regression 验证旧图片迁移、transform 表删除、Delivery cascade 与 `PRAGMA foreign_key_check`；
- Pi Machine Ready fixture 断言没有 `prompt` 或 agent lifecycle 前置条件；
- `cargo fmt/clippy/test`、文档治理、TypeScript 与 Desktop build 作为版本合并门禁，结果写回实施计划。
