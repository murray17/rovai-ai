---
document_type: model-context-change
version: v1.39
change_id: pi-managed-system-prompt
revision: 3
confirmation_status: confirmed
confirmed_revision: 3
confirmed_by: murray17
confirmed_at: 2026-09-04
authority: confirmed-model-input-change-statement
implementation_baseline: 72ecbce9f4892433727d01e348da9a56c5926863
last_updated: 2026-09-04
---

# v1.39 核心模型上下文变更：Pi 原生能力与薄 managed extension

本说明冻结 Pi 从“Rovai 重建完整运行环境”转为“Pi 拥有原生能力、Rovai 只做接入与部分治理”后，模型实际可见的
输入、最小 receipt、恢复和兼容边界。revision 1 确认 managed system prompt；revision 2 删除 Pi Core-managed MCP
Bridge；revision 3 提议恢复 Pi 原生 Extensions、Skills、Context files、Prompt templates 与 Built-in tools，并因此取代
revision 2 的完整环境 attestation。

revision 3 已在开发者审阅完整提案后取得二次确认，实施必须保持本说明冻结的输入、证据与安全降级边界。

## 变更前

当前 `main@72ecbce9f4892433727d01e348da9a56c5926863` 的正式 Pi Host 等价于：

```text
pi --mode rpc \
  --no-extensions \
  --no-skills \
  --no-context-files \
  --no-prompt-templates \
  --no-themes \
  --no-approve \
  --no-builtin-tools \
  --extension <private rovai-pi-host-v4>
```

`--session <exact private locator>` 和 Probe 专用 `--session-dir <temporary directory>` 只在对应路径追加。managed
extension 随后把 `read/bash/edit/write/grep/find/ls` 强制设为完整 Active Tool 集，把 Rovai 投影的 Skill root 作为唯一
Skill 来源；未知 mutation Tool 被阻止。Pi External MCP 已为 `Unsupported`，Pi 不读取或投影成员 MCP Assignment。

当前每轮模型输入为：

```text
effectiveSystemPrompt = piBaseSystemPrompt + "\n\n" + completeBootstrapBytes
promptInput           = exact Formatter-22 Dynamic Context bytes
promptImages          = []
```

完整 Bootstrap bytes 是以下 exact wrapper；三个插值分别为现有冻结 Charter、six-field Member Identity pretty JSON 和
Memory Entrypoint，均先按 Bootstrap Formatter 3 的既有规则 trim：

```text
[SESSION_CHARTER]
{sessionCharter.trim()}
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{memberIdentityPrettyJson}
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
{memoryEntrypoint.trim()}
[/MEMORY_ENTRYPOINT]
```

Dynamic Context 由 Formatter 22 按既有 exact section 顺序、选择、预算、JSON shape 与 omission 规则生成，并以
`CURRENT_INPUT` 结尾。当前完整 receipt 是：

```ts
interface PiManagedInputReceiptV1 {
  schemaVersion: 1
  extensionVersion: 'rovai-pi-host-v4'
  hostInstanceId: string
  hostBindingGeneration: integer
  agentRunId: string
  executionEpoch: integer
  nativeBindingId: string
  nativeBindingGeneration: integer
  runtimeInputDeliveryId: string
  nativePromptId: string
  nativeSessionId: string
  nativeSessionFileDigest: lowercaseSha256
  cwd: canonicalAbsolutePath
  bootstrapEvidenceId: string
  bootstrapPayloadDigest: lowercaseSha256
  skillExposureDigest: lowercaseSha256
  piBaseSystemPromptDigest: lowercaseSha256
  effectiveSystemPromptDigest: lowercaseSha256
  skillCatalog: Array<{
    name: string
    descriptionDigest: lowercaseSha256
    entryPath: canonicalAbsolutePath
    modelVisible: boolean
  }>
  skillCatalogDigest: lowercaseSha256
  activeToolNames: string[]
  bindingDocumentDigest: lowercaseSha256
}
```

V1 要求完整 Skill catalog 和 Active Tool 集与 Rovai 预期精确相等。managed hook 的关键失败通过永不 resolve 的
Promise 阻止模型调用，最终通常表现为 RPC timeout；stderr 被静默丢弃，stdout 单条非 JSON 记录会关闭 reader。所有
AgentRun 的 Runtime 创建还共用一把跨文件与进程 IO 持有的全局 mutex。

## 变更后

### 1. 启动与原生资源

正式 AgentRun 第一次启动必须等价于：

```text
pi --mode rpc \
  --no-themes \
  --extension <private rovai-pi-host-v5>
```

根据恢复路径仍可追加 `--session <exact private locator>`；正式运行不指定 `--session-dir`，继续使用用户 Pi 原生 Session
目录。不得追加 `--no-skills`、`--no-context-files`、`--no-prompt-templates`、`--no-builtin-tools`、`--approve` 或
`--no-approve`。因此用户级资源正常加载；项目级 Settings、Extensions、Skills、Prompt templates 和其他受信任资源是否
加载，完全服从 Pi 已保存的 `trust.json` 和 `defaultProjectTrust`。Rovai 不替用户自动信任项目。

显式 CLI extension 按 Pi 当前顺序先于自动发现 extension 加载。Rovai Skill assignment 仍由 `resources_discover`
作为额外 `skillPaths` 投影；Core 只验证本轮被分配的 managed Skill 是实际 catalog 的子集，允许 Pi 用户、项目、包和
其他 extension 添加任意额外 Skill。Rovai 不再声明完整 Skill catalog 的所有权。

若第一次启动在发送任何 Prompt、steer、follow-up 或 compaction 请求前，因自动发现的 extension 加载失败而不能完成
RPC 初始化，可以且只能重试一次：

```text
pi --mode rpc \
  --no-extensions \
  --no-themes \
  --extension <private rovai-pi-host-v5>
```

Pi 的 `--no-extensions` 只关闭自动发现，显式 Rovai extension 仍加载；Built-in tools、Skills、Context files、Prompt
templates、Bootstrap、Session binding 与已知 Tool approval 仍保留。重试条件必须同时证明第一次 Host 尚未接受任何
模型输入；否则禁止透明重试。

Pi Machine Ready 继续使用临时 config/session root、managed-only extension 与无 Prompt RPC Probe。它不加载或证明用户
资源，不调用模型，也不因一次 Ready 成功宣称原生 extension/Skill/template 的行为资格。

### 2. 精确模型输入

定义：

```text
B   = exact Bootstrap Formatter-3 bytes shown above
P22 = exact Formatter-22 Dynamic Context bytes
S0  = Pi 在 Rovai before_agent_start handler 运行前已组装的当前 system prompt
S1  = S0 + "\n\n" + B
```

Rovai extension 每个实际模型 Prompt 都在自己的 `before_agent_start` handler 返回 `S1`。`S0` 可以包含 Pi 当前版本的
Built-in tool teaching、用户配置、Pi 已加载的 Context files、Skill descriptions 和先于该 hook 生效的 Pi 原生内容；
这些内容由 Pi 选择，不由 Rovai 重建或做完整 digest。

普通输入的 user message 仍是 `P22`。当前输入含已获准直接传给 Runtime 的图片时，RPC command 额外携带：

```ts
images: Array<{
  type: 'image'
  data: base64OfExactAuthorizedBytes
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}>
```

只选择当前触发消息中已通过现有附件授权、MIME 与大小检查的图片，保持消息内顺序；历史图片和普通文件不转换为
`images`。`CURRENT_INPUT.attachments` 的既有路径投影不删除，因此图片 bytes 是附加的原生多模态输入，不改变附件读取
授权。图片数组的顺序、每项 MIME、byte digest 与总 digest 进入 Runtime Input Delivery 私有 evidence；任何缺失、漂移
或超限在 `prompt` 前失败。

Pi 的 RPC `prompt` 只能在整个 `message` 以 slash command 开头时自动扩展；Rovai 的 `P22` 以结构化 section 开头，不能
依赖该行为。revision 3 新增 `Pi Runtime Prompt Transform 1`：

1. 只有 `invocationKind=direct` 的人类 `CURRENT_INPUT.message` 被识别为命令；A2A、Gather、历史文本和代码块中的 `/`
   永远不是命令。
2. 将原始 message trim 后按 Pi command token 规则拆成 `/<name>` 与其余 arguments，并用当前 Host 的
   `get_commands` catalog 做 exact-name 查询。
3. catalog `source=prompt` 时，读取 catalog 指向的同一普通文件，验证 canonical path、读取时 digest 和 catalog 身份，
   去除 YAML front matter，并按当前 Pi 的 `$1`、`$2`、`$@`、`$ARGUMENTS`、default 与 slice 规则显式展开。
4. catalog `source=skill` 时，读取同一 `SKILL.md`，保持完整文件 bytes；有 arguments 时追加 exact
   `"\n\nUser: " + arguments`，无 arguments 时不追加。
5. 用展开后的文本替换 cloned `CURRENT_INPUT.message`，再调用 Formatter 22 的同一 renderer；其他 section、字段、顺序、
   预算和 omission 不变。所得 bytes 是实际 `prompt.message`。
6. catalog `source=extension` 的 command 不在 AgentRun 内直接执行，因为 Pi 会在 `input`、receipt 和 Bootstrap hook 前
   dispatch 它；Core 返回明确的 `pi_extension_command_unavailable_in_managed_agent_run`，不调用模型。extension 注册的
   LLM tools 不受此限制。
7. 未找到 catalog entry 的 slash 文本按普通 `CURRENT_INPUT.message` 发送；已找到但文件消失、变为 symlink、digest 漂移
   或展开失败时返回明确错误，不回退到另一份同名资源。

原始 `P22`、实际 Runtime prompt bytes 和以下 closed evidence 必须在 dispatch 前持久化；恢复只复用持久化后的 exact
bytes，不随模板或 Skill 后续变化重新展开：

```ts
type PiRuntimePromptTransformV1 =
  | {
      schemaVersion: 1
      mode: 'verbatim'
      originalDynamicPayloadDigest: lowercaseSha256
      runtimePayloadDigest: lowercaseSha256
      command: null
    }
  | {
      schemaVersion: 1
      mode: 'file_command'
      originalDynamicPayloadDigest: lowercaseSha256
      runtimePayloadDigest: lowercaseSha256
      command: {
        name: string
        source: 'prompt' | 'skill'
        location: 'user' | 'project' | 'path'
        sourcePathDigest: lowercaseSha256
        sourceContentDigest: lowercaseSha256
        argumentsDigest: lowercaseSha256
        expandedContentDigest: lowercaseSha256
      }
    }
```

完整 source path 和展开后的 bytes 是 Core 私有 blob/evidence，不进入公开事件、Activity、diagnostics 或 read model。

重要限制：Rovai extension 之后加载的用户或项目 extension 仍可再次修改 `S1`、context messages、Tool input 或最终
provider payload。因此实际 provider system input 定义为：

```text
Sprovider = Pi 对 S1 继续执行后续 native extension hooks 后的结果
```

Rovai 只证明自己的 hook 在其执行位置追加过 `B`，不证明 `Sprovider == S1`，也不证明后续 extension 没有删除或改写
Bootstrap。这是选择恢复任意 Pi 原生 Extensions 的直接安全后果，必须作为本 revision 的显式接受边界。

### 3. 最小 managed-input receipt

binding document 升为 closed V2：

```ts
interface PiHostBindingV2 {
  schemaVersion: 2
  extensionVersion: 'rovai-pi-host-v5'
  hostInstanceId: string
  hostBindingGeneration: integer
  agentRunId: string
  executionEpoch: integer
  nativeBindingId: string
  nativeBindingGeneration: integer
  runtimeInputDeliveryId: string
  nativePromptId: string
  expectedNativeSessionId: string | null
  bootstrapEvidenceId: string
  bootstrap: string
  bootstrapPayloadDigest: lowercaseSha256
  skillRoot: canonicalAbsolutePath
  expectedManagedSkillExposureDigest: lowercaseSha256
}
```

V2 receipt 精确为：

```ts
interface PiManagedInputReceiptV2 {
  schemaVersion: 2
  extensionVersion: 'rovai-pi-host-v5'
  hostInstanceId: string
  hostBindingGeneration: integer
  agentRunId: string
  executionEpoch: integer
  nativeBindingId: string
  nativeBindingGeneration: integer
  runtimeInputDeliveryId: string
  nativePromptId: string
  nativeSessionId: string
  cwd: canonicalAbsolutePath
  bootstrapEvidenceId: string
  bootstrapPayloadDigest: lowercaseSha256
  governedNativeTools: [
    { name: 'bash', observable: true },
    { name: 'edit', observable: true },
    { name: 'write', observable: true }
  ]
  bindingDocumentDigest: lowercaseSha256
}
```

字段全部必需，object 和 tool item 拒绝未知字段；`governedNativeTools` 固定按 UTF-8 byte order 排序。`observable`
表示对应名字在 Pi 当前 Tool registry 可见，不表示 Rovai 把它设为 Active，也不禁止用户设置使其 inactive。额外
Built-in tool、extension tool、Skill、extension、template 或其他 native resource 一律允许且不进入 receipt。

V2 明确删除 `nativeSessionFileDigest`、`skillExposureDigest`、两种 system-prompt digest、完整 `skillCatalog`、
`skillCatalogDigest` 和完整 `activeToolNames`。完整 Session file 继续只存在 Core 私有 locator state；公开 surface 仍不得
出现 path，私有 receipt 也不再复制 locator digest。

确认 nonce 为：

```text
sha256("rovai-pi-managed-input-receipt-v2\n" + canonicalJson(receipt))
```

只有 Host/run/epoch/binding/session/delivery/prompt/cwd、Bootstrap digest、binding digest 和三个 governed Tool 的最小
观察全部匹配时 Core 才返回 nonce。receipt commit 与 `runtime_input_delivery.status=accepted` 继续在同一事务，禁止关闭
foreign keys 或拆分原子提交。managed extension 必须在任何 provider request 前得到 nonce；关键失败走下一节的显式失败
协议，不再等待超时。

### 4. Tool 与审批边界

删除 `pi.setActiveTools([read,bash,edit,write,grep,find,ls])`。Pi 的设置、版本和 extension 决定 Active Tool 集；Core
不比较完整集合。

managed approval 只拦截当前明确支持的 `bash`、`write`、`edit` 调用，并继续把 Pi 实际解析的 shell path、args 与
command transport 交给 Core 验证；`read/grep/find/ls` 直接继续。其他名字的 Tool 不因 Rovai 不认识而阻止，按 Pi 自身
语义执行。若用户 extension 覆盖同名 Tool、改变输入，或在 Rovai handler 之后修改已经批准的调用，Rovai 不能证明
最终副作用与 Canonical Action 完全相同。

因此 Pi permission descriptor 和所有用户文案必须改成 `partial_managed`：Rovai 对已识别调用提供 best-effort durable
approval；这不是 sandbox，不覆盖全部 extension tool，也不是“每个 mutation 都经过 Rovai”。旧 `approval_mode=managed`
读取时迁移为 `partial_managed`；新写入只允许后者。Pi 继续保持 Preview/NotQualified，不用该能力满足 First-Class 的
未知 mutation fail-closed 门槛。

### 5. 显式失败、诊断与 Host poison

不得再返回永不 resolve 的 Promise。managed extension 定义 closed `PiManagedFailureV1`，至少携带
Host/run/epoch/binding/session、阶段、错误码和截断消息；它通过现有 RPC extension UI channel 立即交给 Core。Core 确认
收到后使当前 activation/operation 失败，并按是否可信决定重建 Session 或停止 Host。Binding 不可读、identity 不匹配、
Bootstrap digest 不匹配、必要 approval channel 不可用和 receipt nonce 不匹配都不得进入 provider request。

自动发现 extension、额外 Skill/template 和非关键状态上报错误进入 Runtime diagnostic 后降级；不得伪装成 Rovai 必需
组件成功。stderr 按行进入 diagnostic，关联 `hostInstanceId`、当前可用的 `agentRunId/executionEpoch` 和
`startup|activation|running|shutdown` 阶段，做既有 secret redaction，并把单条限制为 64 KiB。

stdout 在第一条有效 RPC object 前最多接受 32 条且总计不超过 64 KiB 的非 JSON startup prelude；每条只记 diagnostic。
建立 RPC 后，单条无法解析或非 object 的记录记 diagnostic 并跳过，有效 frame 重置连续错误计数；连续三条损坏记录、
超长 frame、底层 framing/read 错误或进程退出终止 reader。response 缺失/冲突 ID、command identity 冲突和响应路由到错误
pending request 立即视为不可恢复协议错误。

只有 Host/Run/Session binding identity 冲突、持续 framing 损坏、response identity 冲突、Session 被其他 Run 接管或
进程状态无法重新同步才设 `poisoned=true`。单次 Prompt/model/state/Tool/可选资源/非关键 receipt 错误只失败当前操作；
一次 `get_state` + managed Session state 重同步成功后 Host 可继续，否则停止并重建。

### 6. 恢复、并发与 Pi RPC 能力

恢复顺序固定为 exact-first：同一 healthy Host/session 直接复用，否则用 Core 私有 canonical Session file 调用
`switch_session` 并以 `get_state` 核对完整 Session ID、file 和 cwd。locator 缺失、文件删除、header/单条记录损坏、cwd
迁移、版本不兼容或重新绑定失败时，记录 continuity lost，创建新 Pi Session，重新注入同一 Bootstrap，并用 Formatter
22 的 `SHARED_CONVERSATION`、`RUN_FACTS`、`CURRENT_INPUT` 和其他可恢复 Rovai context 继续。不得把 exact resume 作为
AgentRun 可用性的硬前提，也不得把未经选择的 Pi 私有历史偷偷拼入 Prompt。

读取旧 Session JSONL 时，Core 只要求首个可解析 Session header 的 ID/cwd 合法；未知 entry 和单条 malformed line 跳过并
记私有 diagnostic，剩余历史交给 Pi 自身容错 parser。header 缺失、identity 冲突或超过现有 size/scan limit 才放弃该
locator 并走新 Session fallback。

Runtime 创建 singleflight key 精确为 `(agent_run_id, execution_epoch)`。同 key 的并发 ensure 共享一个结果；不同 key
并行。全局 registry mutex 只保护 keyed gate 的查找、插入和删除，不得跨 Pi spawn、RPC、Session、extension、文件或网络
IO 持有。失败或完成后删除 gate；active Runtime registry 仍按 Run/epoch 核对，禁止 late epoch 覆盖。

在现有 RPC 命令之外补齐并按 Pi 原生 wire 验证：

```text
prompt.images
steer / follow_up / clear_queue
set_steering_mode / set_follow_up_mode
get_messages / get_entries
get_session_stats / set_session_name
compact / set_auto_compaction
export_html
```

`steer` 和 `follow_up` 的每个用户输入仍需独立 Delivery ID、Native Prompt ID 与 V2 receipt；排队只改变消费时点，不复用
旧 receipt。`compact` 可能产生 Pi 自己的 summarization provider call，但不代表新的用户输入，receipt 不为 compaction
伪造；下一次 Prompt 仍重新注入 Bootstrap 并取得 V2 receipt。`export_html` 只能由显式用户操作调用，输出落在已授权路径，
不是模型 Tool。读取类 RPC 不改变 Session；所有新增 mutation/queue 命令都要有状态、取消、超时和 late-event 测试。

## 明确不变

- Bootstrap wrapper、Charter、Member Identity、Memory Entrypoint 和 Bootstrap Formatter 3 的 bytes 不变。
- Formatter 22、ContextManifest 22、Context Delivery Profile 4、Run Facts 2 的原始 Dynamic Context section、顺序、预算、
  附件授权、public-history 与 omission 规则不变；Pi-specific transform 用独立版本和 evidence，不冒充 Formatter 22 原文。
- 既有 Runtime 的 `native_append`、`first_payload`、MCP、Skill、permission、resume、LRU 和 compaction 行为不变。
- Pi External MCP 保持 `Unsupported`：Assignment 数据保留，Pi 静默忽略，不启动 Server、不读取 catalog、不注册 proxy、
  不转发 `tools/call`。Pi 用户 extension 自己实现的能力属于 Pi 原生 extension，不成为 Rovai MCP projection 或其证据。
- Pi 仍直接运行 `pi --mode rpc`；不新增中间 Runtime、包管理启动器或协议 bridge process。
- Probe Session/config 仍在临时目录并清理，Machine Ready 不发送 Prompt、不调用 Tool/MCP/模型。
- 完整 Native Session file 只在 Core 私有状态；公开事件、Activity、diagnostics、read model 和 receipt 均不含 locator。
- SQLite receipt 与 Input accepted 的原子性、Receipt BEFORE UPDATE 保护和父 Delivery 合法 cascade 保持不变。
- 三个平台继续是 `preview / runtime_platform.qualification_evidence_missing`；本 revision 不创建 qualification artifact。

## 版本、迁移与兼容

revision 3 推进以下 Pi-specific 轴：

```text
Managed extension:             rovai-pi-host-v4 -> rovai-pi-host-v5
Host binding document:         1 -> 2
Managed input receipt:         1 -> 2
Pi Runtime Prompt Transform:   absent -> 1
Pi Prompt Image Evidence:      absent -> 1
Pi permission mode:            managed -> partial_managed
Pi binding compatibility:      managed-system-prompt-v1 -> native-capabilities-v1
Data Contract:                 v1.45 -> v1.46
Projection Schema:             86 -> 87
Migration:                     135 -> 136
```

Bootstrap Formatter 3、AgentRun Context Formatter 22、ContextManifest 22、Context Delivery Profile 4、Run Facts 2 与
Bootstrap Redelivery 2 不推进。Migration 136 原子重建 receipt CHECK 以允许历史 V1 和新 V2，Writer 只写 V2；历史 V1
保持只读，acceptance/recovery reader 可识别，但新 managed extension 不生成 V1。迁移同时保存 Pi Runtime Prompt Transform
与 image evidence 的私有 payload/digest，并把已存 Pi `approval_mode=managed` 规范化为 `partial_managed`；失败整体回滚，
完成后必须 `foreign_key_check=0`。

正在运行的 v4 Host 与 v5 binding 不兼容，升级时正常停止并重建，不热升级 extension。已有 Pi Session locator 优先 exact
resume；若 Pi 原生资源、cwd 或版本使其不可恢复，则按上述 availability fallback 创建新 Session。其他 Runtime、MCP
Assignment、历史 Activity 和旧 receipt 不改写。

## 必须接受的安全降级

恢复任意用户/项目 Pi Extensions 与“未知 Tool 不默认阻止”后，Rovai 无法同时声称以下保证：

- 最终 provider system prompt 必然仍含未修改 Bootstrap；
- 每个有副作用 Tool 都经过 Rovai Approval；
- Rovai 批准的 `bash/write/edit` input 就是后续 extension 最终执行的 input；
- 实际 Tool、Skill、extension、template 集合等于 Rovai catalog；
- Pi 在 Rovai Workspace/permission policy 意义下构成 sandbox。

本 revision 选择 Pi 原生能力与兼容性，并把上述保证明确降为“不声明”。若开发者不能接受，应维持 revision 2 的受管空壳
模型，或另行设计一个位于所有 Pi extension 之后且不能被绕过的上游强制边界；当前 Pi extension API 不提供该边界。

## 二次确认

```yaml
confirmation_status: confirmed
confirmed_by: murray17
confirmed_at: 2026-09-04
revision: 3
confirmed_revision: 3
confirmation_text: >-
  确认，改完pr到main；merge。确认 revision 3，并接受 Pi 原生 Extensions 可在 Rovai hook 之后改写 Bootstrap、
  provider payload 和已批准 Tool input；Rovai 对 Pi 只提供 partial approval 与最小 receipt，不提供完整 sandbox
  或全能力 attestation。
```

## 验证

- exact launch fixture 证明默认只保留 `--no-themes` 和显式 v5 extension，原生资源开启；首次 pre-Prompt extension load
  failure 只重试一次 managed-only，任何已发送输入禁止重试。
- fixture 覆盖 V2 binding、closed V2 receipt、canonical nonce、最小 Tool 子集、额外 Tool/Skill/extension/template 接受、
  removed V1 字段拒绝以及 receipt/acceptance 原子提交。
- system-prompt chain 测试证明 Rovai hook 产生 exact `S1`；另用后加载 extension 改写 `S1` 和 Tool input，证明产品只声明
  partial governance，相关 permission/capability 文案不得回归全覆盖。
- prompt-transform fixture 覆盖 prompt/skill arguments、front matter、default/slice、同名 catalog、未知 command、extension
  command unavailable、symlink/path/digest drift、恢复复用 exact bytes 与非 direct 输入不展开。
- 图片测试覆盖顺序、MIME、bytes/digest、授权、大小、无图片、resume/steer/follow-up；模型 catalog 不支持 image 时明确
  拒绝，不把路径伪装成 image capability。
- known `bash/write/edit` 继续产生真实 durable Approval；只读与未知 extension Tool 继续，固定 Active Tool 调用不存在；
  denial、approval transport、later-handler mutation 限制均有负向测试。
- 关键 managed failure 在受控 Host 中立即结束且零 provider request；可选 extension/Skill/template failure 产生 diagnostic
  并降级。stderr、startup prelude、单条坏 stdout、连续三条坏 frame、response ID 冲突各有测试。
- exact resume、缺失/损坏/未知 JSONL entry、cwd/version mismatch 和新 Session fallback 证明相同 Bootstrap 与可恢复 Rovai
  context；公开 trace 不含 Session locator。
- 同 key 十路 ensure 只创建一个 Host，不同 Run 并发创建且全局锁不跨 IO；late epoch 不能覆盖 active registry。
- 受控 RPC Host 覆盖新增 command wire、queue/abort/settled、stats/name/messages/entries、manual/auto compaction 和 export；
  显式真实 Pi smoke 覆盖原生资源、Prompt、receipt、final、Usage、图片和 Approval，普通 Machine Ready 仍零模型调用。
- Migration 136 从 v1.45/schema86 升级、历史 V1 保留、新写 V2、rollback、reopen idempotence、父 Delivery cascade 和
  `PRAGMA foreign_key_check` 全部通过。
