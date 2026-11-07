---
document_type: model-context-change
version: v1.72
change_id: project-file-reference
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-11-07T16:15:07Z
confirmation_message_id: 90e5e2f1-6d68-43b5-a047-fad13517c3df
implementation_status: in_progress
authority: model-input-change-proposal
implementation_baseline: 55a83f89733393cfcad76b046e344c222577abe1
last_updated: 2026-11-07
---

# 公开对话项目文件引用实施说明 R1

## 二次确认

本文为 User 已确认的正式实施 revision，尚不代表实现或验收完成。
User 在 Thread `rvcamp_01m6rthem2ex9bv2n6cb990jht` sequence 1 给出最初方案，sequence 11
修订短标签、分组搜索、跨对话恢复和仅文件发送，sequence 13～15 要求沿用现有文件类型图标，
sequence 17（`694f96a1-8dbe-43ca-9675-d92421ad2def`）要求开启 worktree 开始实现。
R1 提交并公开说明后，sequence 19 进一步询问文件输入 JSON；已说明正文中的 Markdown file URI 投影、
草稿身份和 Core 发布字段。User 在 sequence 21（`90e5e2f1-6d68-43b5-a047-fad13517c3df`）回复
“那你实现吧”，确认按 R1 开始正式实现，满足[上下文治理](../../development/model-context-change-governance.md#二次确认门槛)。
`confirmed_at` 为收到该确认后登记的 UTC 时间，不冒充用户消息的原始时间戳。实质性范围变更仍需新 revision。

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-project-file-references`。
- Branch：`rovai/project-file-references`。
- Base：`55a83f89733393cfcad76b046e344c222577abe1`；2026-11-07 获取的 `origin/main` 与其一致。
- Governance：无“治理文档先合入 main”要求；本说明的确认先于本分支正式实现。
- 范围：绑定项目的公开 Active、普通 Pending，Desktop 与已认证 Web；ready Mission 工作副本优先。
- 依据：User 的上述消息和 v5.1 离线交互稿。原型不进入生产依赖，也不构成真实 Host/Core 验收。

## 变更前

### 草稿与消息

基线的 `ComposerDocument` 为 version 2，段是 Text 或 Atom。完整 Atom 集合为：

```ts
type ComposerAtomBefore =
  | { type: 'member'; agentId: string; labelFallback?: string }
  | { type: 'all_members' }
  | { type: 'skill'; skillId: string; nameAtSend: string }
  | { type: 'thread_reference'; threadId: string; labelFallback?: string }
  | { type: 'mission_reference'; missionId: string; labelFallback?: string }

type StructuredThreadMessageSegmentBefore =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'all_members_mention' }
  | { kind: 'current_user_mention'; userId: 'local_user' }
  | { kind: 'skill_mention'; skillId: string; nameAtSend: string }
  | { kind: 'thread_reference'; threadId: string; titleAtSend: string }
  | { kind: 'mission_reference'; missionId: string; titleAtSend: string }
  | { kind: 'external_quote'; senderDisplayName: string; body: string;
      attachmentSummaries: { name: string; mediaType: string | null }[];
      contentDigest: `sha256:${string}` }
```

没有项目文件 Atom 或正式段。项目目录的 `open` 已返回
`{kind:'project_file', threadId, rawReference}`。现有来源串是 Base64URL 编码的
`[rootIdentity, relativePath]`；Root identity 包含 Thread 业务绑定、工作副本代次、规范路径和根对象身份。
相同目录在不同 Thread 的 rootIdentity 不相等，不能仅比较 rawReference 或 entryId 做跨对话恢复。

当前引用首次发布在消息事务内捕获真实标题；含对话／使命引用而无本轮文字或附件的提交被拒绝。
其余路径仍依赖已投影 body 是否非空，结构化成员显示文字可能被算作正文；不能据此宣称纯成员空输入已在 Core 统一。
文件路径只有作为普通文字手动输入时才进入正文，不具有经 Host 校验的文件引用身份。

### 模型输入

公开 batch 的普通消息继续使用现有 `RUN_INPUT.messages[]`；无附件、quote 或 Skill 的具体例子：

```json
{"messageId":"msg_example","sequence":3,"senderType":"user","senderId":"local_user","body":"@爱丽丝 请检查 src/auth/login.ts。","mentions":[{"id":"agent_6","name":"爱丽丝"}]}
```

`body` 由现有共用正文 projector 生成。可选 anchor、quotes、attachments、skills 仍按各自当前合同省略；
引用、代码和文件名不进入 mentions。Steer 和历史读取复用既有正文路径。

## 变更后

### 闭合身份与发布权威

保留 ComposerDocument version 2、现有所有变体，只各增加一个封闭变体：

```ts
type ProjectFileReferenceAtom = {
  type: 'project_file_reference'
  threadId: string
  rawReference: string
  labelFallback: string
}
type PublishedProjectFileReference = {
  kind: 'project_file_reference'
  threadId: string
  rawReference: string
  pathAtSend: string
  labelAtSend: string
}
type ComposerAtomAfter = ComposerAtomBefore | ProjectFileReferenceAtom
type StructuredThreadMessageSegmentAfter =
  StructuredThreadMessageSegmentBefore | PublishedProjectFileReference
```

`labelFallback` 必填，保存完整、可读的项目相对路径；它不参与路径解析、身份匹配或权限判断。
`scopeId`、`entryId` 和可用性不写入 Atom。客户端不能提交 pathAtSend、labelAtSend 等发布字段；
正式段只由 Core 构造并保存在既有 structured_content_json。

发送时 Atom.threadId 必须等于命令目标 Thread。Core 从该目标及认证请求读取业务绑定，
不能用 Atom 自报 Thread 解析其他对话。rawReference 复用既有 Host 来源，不是独立权限凭证。
Core 从合法定位生成 labelAtSend，以规范化且根内的可读取普通文件确定 pathAtSend。
根内文件符号链接可以引用；目录、根外符号链接、越界与不支持的非普通文件拒绝。
文件内容不复制为附件或快照，普通编辑及原路径保存继续采用 live reference 语义。

### 首次发送与重放

1. 冻结客户端当前文档，固定一次 commandId；入站仍作封闭 shape 校验。
2. Core 先查同 commandId 已完成的成功／拒绝，回放原结果，不重新检查文件或改写发布字段。
3. 首次发送短锁取得命令 Thread 的业务绑定和待校验身份；锁外完成根、相对定位、普通文件与可读性检查。
4. 按身份去重预检，每次出现仍保留原 segmentIndex；将合法发布字段和原业务绑定封装为 Core 私有预检结果。
   不把这个结果作为可由客户端提交的 DTO。
5. 进入原提交事务后先复查回执，再复核业务绑定与预检一致，捕获其余引用并检查完整投影预算。
   绑定改变则整条拒绝；预检失败写拒绝回执前也先复查并发提交结果。
6. 复用既有消息与 Delivery 原子提交。普通 Pending 的邀请、激活、发布和 Delivery 保持同一事务；
   Active 的独立邀请已发生时不因后续文件失败回滚。
7. 明确成功才清稿；明确失败保留完整文档，标记对应 Atom；结果未知保留输入并查询／重放同 commandId。

新增拒绝码 `project_file_reference_unavailable`，沿现有 CommandResult 的 payload 返回
`message, segmentIndex, kind:'project_file_reference', threadId, rawReference, reason`。
reason 为 `invalid_reference, thread_mismatch, root_unavailable, root_changed, file_missing, outside_root, not_regular_file, unreadable`。
引用数量或预算超限归 `camp_message.invalid_content`，提供可定位的 segmentIndex。
不新建业务回执表；不在 SQL 事务内执行文件 I/O。事务复核不能锁住外部文件系统，后续读取仍可能失败。

### 路径投影与实际输入

正式段在原正文位置投影为 Markdown 文件链接。标签使用已保存的完整 labelAtSend；
URI 使用 pathAtSend，经 URI 库进行平台路径转换与编码，标签转义集中实现。
覆盖中文、空格、括号、井号、反斜线、盘符与 UNC，不用浏览器拼接 Host 路径。

```json
{"kind":"project_file_reference","threadId":"<目标Thread>","rawReference":"<Host来源串>","pathAtSend":"/project/src/auth/login.ts","labelAtSend":"src/auth/login.ts"}
```

上述模型例子变为：

```json
{"messageId":"msg_example","sequence":3,"senderType":"user","senderId":"local_user","body":"@爱丽丝 请检查 [src/auth/login.ts](file:///project/src/auth/login.ts)。","mentions":[{"id":"agent_6","name":"爱丽丝"}]}
```

不增加 RUN_INPUT.files、references、独立上下文块、文件内容或重复 SourceAttachment。
初始输入、运行中追加、历史读取采用正式字段，不重新解析历史来源。已有最终冻结输入直接复用原字节。

有效文件引用本身计为实际输入，允许文件单独发送及文件＋成员／附件。文件不参与寻址，默认接收者及
已有默认接收者正文前缀保持。纯空白、仅成员，以及没有文字／附件的对话和使命引用继续沿用空输入规则。
任务明确时按上文继续；任务不明确时应询问用户，不猜测修改目标。此次不暗加模型提示词；该行为列入
真实任务验收，失败不得改判为成功，若确需增加模型指引则更新 revision 后再确认。

### 显示、复制与恢复

草稿和单条消息各自计算展示集合，默认图标＋文件名；不同身份同名时逐级补最短目录，必要时补根标识。
重复同一文件不增加冲突。保留文件名、扩展名及 test/spec 差异；完整路径用于键盘／触屏详情和候选说明。
图标复用现有 ProjectFileIcon 映射，包括测试文件及未知类型 fallback。显示结果不写回身份或历史字段。

内部 Composer 剪贴板与应用内整条消息复制携带完整结构化文件引用和可读普通文本；缺必填 labelFallback
的私有 MIME 按既有无效 MIME 规则回退。普通文本输出名称和完整相对路径，不靠文字反向识别为 Atom。
输入历史、本地草稿、失败恢复、撤销重做保留文件及句内位置。撤回短期重新编辑保留完整相对路径文字，
只恢复既有明示成员，不恢复文件 Atom。已保存 quote 快照不重算；新选文的前端与 Core 使用同一短标签消歧投影，
保留原 bodyAtSelection 校验，不把隐藏 URI 包装当作用户选中的文字。

### 目标 Thread 确认

新增面向已认证 Desktop/Web 用户的只读 `projectFileReferences.resolve`，请求与返回都封闭：

```ts
type ResolveProjectFileReferences = {
  threadId: string // 目标 Thread；用于本次权限和有效工作目录
  references: { threadId: string; rawReference: string }[] // 数组最多 32 项，按身份去重解析
}
type ProjectFileReferenceResolution =
  | { status: 'available'; reference: ProjectFileReferenceAtom }
  | { status: 'needs_reselect'; reason: 'root_mismatch' | 'source_unavailable' }
  | { status: 'unavailable'; reason: 'invalid_reference' | 'root_unavailable' | 'root_changed'
      | 'file_missing' | 'outside_root' | 'not_regular_file' | 'unreadable' }
// 沿 FilePreviewApi 的 ok/value 或 ok:false/error envelope；value 按输入顺序返回 resolution[]。
```

同 Thread 恢复按目标绑定重验。跨 Thread 请求先校验目标用户权限，同时只读取得可访问来源的绑定元数据；
验证原来源有效，再以目标权限和根内边界重新解析，不继承源访问上下文。
来源 Thread 不可访问／已删除或原定位不能确认时保留原 Atom 和路径，返回 needs_reselect。

普通项目根只有规范路径、文件系统根对象身份均相同才可确认同根；Mission 根还要求相同工作副本身份和代次。
项目根与 Mission 根、不同工作副本／代次不按目录名或相对路径换绑。确认成功由目标服务签发目标 Thread
的来源与完整 labelFallback；rawReference 仍采用现有格式。网络失败保留原引用并允许重试，不宣布文件删除。
重绑完成前不得以原 Thread 身份发送；展示刷新不成为新的 undo item，成功重绑与该次粘贴合并为同一编辑操作。
可用性只在恢复、引用身份集合变化、根变更／重连或显式重试时按需读取，不在每次按键做文件系统检查。

### 搜索与打开

默认非空查询并行检索，按队员、文件、对话、使命分组显示少量结果；明确路径查询提高文件组顺序。
裸 @ 优先当前队员；手动类别在本次触发固定。各来源失败／partial 只影响自身，不因队员命中停止文件查询。
文件候选独立取得 scope；空文件筛选只列根层普通文件，非空约 150ms 防抖，保留既有最多 100 项及 partial。
关闭、切 Thread、卸载取消并释放；文件树的 scope、watch/poll 和查询 revision 独立。

候选选择通过既有 projectFiles.open 取得 Host 来源；不增加人工等待、旋转边框或自动预览。
真实请求返回时仍核对 Thread、scope、查询代次、节点与原替换范围，才立即插入并继续编辑；迟到结果丢弃。
合成期间不更新候选、不插入、不发送；加载、旧结果或正在处理选择时 Enter 不触发发送。

点击引用主动打开预览；右键、Shift+F10、长按提供完整路径、重新选择与移除，保护拖选和长按后的点击。
预览恢复需重新验证根和普通文件；历史预览如果当前解析路径与冻结 pathAtSend 不同，显示定位已变化，
不把历史链接静默改指新目标。为此 project_file 预览请求增加可选 expectedPathAtSend 比较条件；
它只收紧验证，不以客户端绝对路径作为授权或新打开目标。关闭预览／移除引用不删除源文件。

## 预算

- 文档仍最多 4,096 段；新增文件 rawReference 为 UTF-8 最多 16,384 字节，不套用普通 ID 的 256 字节限制。
- labelFallback 必填；labelAtSend 与其完整可读相对路径均以 UTF-8 计费，不套用 500 scalar 的对话标题限制。
- 草稿沿用 1,048,576 字节预算及既有非文件项计费；每次文件段额外计入 threadId、rawReference、labelFallback
  的实际 UTF-8 字节。TS 和 Rust 使用同一公式与边界 fixture，JSON key 的固定开销不冒充可用正文预算。
- 正式内容沿用原校验，每次文件段计入 threadId、rawReference、pathAtSend、labelAtSend 的 UTF-8 字节，
  总可变内容仍不超过 1,048,576 字节；捕获后完整正文投影也不得超过现有 1 MiB。
  URI percent encoding、转义和每次重复出现都计入实际投影，不能按短标签估算。
- 一条消息最多 32 个不同项目文件；相同身份只预检一次，各次出现保留。错误指向超限或失败的段。
- Context 的消息选择、截断与实际输入序列化预算保持；引用 URI 使用已有 body 配额，不增加 Context 预算或隐藏正文。

## 版本、兼容与恢复

| 轴 | R1 结论 |
| --- | --- |
| ComposerDocument | 保持 2，增加封闭文件变体；Composer Draft 合同 v20 → v21 |
| 文件来源 | rawReference 现有编码保持；新 Project File Reference v1；File Preview v26 → v27 收录目标确认与历史预览路径比较 |
| 引用／消息发送 | Thread Reference v1 → v2；Camp Message Send v29 → v30，定义分组、文件实际输入及事务外预检 |
| 对话读取／恢复 | Camp Open Projection v31 → v32；Input History v1 → v2；Message Reedit v1 → v2，收录新变体及明确的文字回填 |
| Host Web | 合同 v9 → v10，protocolVersion 5 → 6；旧 Web 在认证准入处明确拒绝，不读取未知段 |
| Desktop | 仍使用配套 Host；app.info 增加 composerProjectFileReferenceVersion:1，新客户端缺该能力时关闭入口并阻止文件文档写入；未知文档保持不可编辑与恢复材料，不规范化为空稿 |
| 数据库 | projection schema 169 → 170 作为新增封闭内容的旧 Core 读取门禁；迁移沿现有机制更新标记，不新建业务表、不批量改写消息或冻结输入；核对既有 JSON 约束后只作必要兼容扩展 |
| Context | public Formatter/Manifest 43、非 batch 44、既有 Profile/Facts 保持；只是现有 body 增加可表达内容，不增加 serializer shape 或新的兼容分支 |
| Bootstrap / Runtime / CLI | Bootstrap v6、Charter 26、原生 Binding 兼容、Runtime 参数、Built-in Transport v45 和工具参数／结果字段形状保持 |

旧 Core 不能打开升级后数据目录；不通过降级重写恢复旧客户端。Desktop 正式分发继续要求 App/Host 配套，
Web 新旧组合以协议准入失败。新客户端连接缺能力 Host 时不能发送文件 Atom；遇到不能理解的草稿或消息时
明确阻止相关读写，保留恢复材料和原始数据。需要额外兼容框架或 Context 版本变更时先更新 revision。

新发布只影响新命令；成功或拒绝回执保持首个结果，历史 frozen 输入、旧标题、原 URI 和引用位置不重算。
文件内容、权限或根在发布后变化，不改写存量内容，也不承诺保存过发送时文件正文。

## 明确不变

- 不扩展到 Single Chat、目录、行范围、跨项目主动选择或文件内容搜索；图片仍通过现有附件入口。
- 不改变成员邀请、收件人计算、通知、SourceAttachment、既有 Skill 发送规则、消息撤回清理及原生权限策略。
- 不把文件引用成功说成已经读取，不用浏览菜单准备／恢复 Mission 工作副本。
- 不在 claim、历史读取或 Context 恢复时重做文件预检；读取发生在 Runtime 现有文件工具，失败真实反馈。
- 不改 SESSION_CHARTER、MEMBER_IDENTITY、Memory、Skill/MCP section、RUN_FACTS 或其他 RUN_INPUT 字段和选择规则。
- 不回写历史正文、已保存 quote、Context Blob、成功工具结果或旧回执；同样的旧输入保持原字节。
- 不把原型演示服务、全局桥或模拟回执搬入正式环境；沿用当前生产组件及 ProjectFileIcon，显示计算独立于身份。

## 验证

实施与测试归属见[实施计划](project-file-reference-implementation.md)。以下通过条件在实现前冻结；
不同阶段的纯转换、Host、真实 UI、真实 Runtime 结果分别记录，不用离线交互稿替代生产验证。

| Case | 固定操作与通过标准 |
| --- | --- |
| F1 身份／转换 | TS 与 Rust 同一 fixture：缺必填字段、未知字段、16 KiB、总预算、32 个不同文件、重复出现及伪造发布字段；边界相同，位置不丢失 |
| F2 临时目录 | 普通文件、根内/根外链接、目录/FIFO、删除和不可读、根替换、Mission 代次；非法目标拒绝、普通修改保持 live；I/O 不持有数据库锁 |
| F3 事务／回放 | 同 ID 并发，首次成功／拒绝后删除文件再重放，预检期间业务重绑，Pending 邀请后失败；消息/Delivery 不重复，无部分激活，不改写旧回执 |
| F4 恢复／粘贴 | 历史、本地重启、失败留稿、同对话／同根跨对话／不同根／未知 Host；身份和句内位置保留，目标确认前不发送，不猜名换绑 |
| F5 UI／搜索 | 同时命中队员与文件、来源单独失败、partial、快速查询/切 Thread/迟到 open、独立文件树 scope、真实 IME、键盘/退格/undo/拖选/触屏长按及预览焦点 |
| F6 客户端 | Desktop 与认证 Web，1040/1440/2560 桌面、200% 缩放、390 窄屏、日/夜主题；类型图标和同名消歧一致，无横向溢出；新旧 Web 和旧 Core/新数据明确拒绝、不清稿 |
| R1 实际读取 | 两个现有合格 Runtime 各使用隔离 Thread/CWD；文件放不同随机校验值，只发送 URI 引用和“报告所引文件校验值”；输入未含正文，真实工具读取路径与结果匹配 |
| R2 补交文件 | 两个 Runtime 各先建立明确日志任务，再仅发送日志引用；沿上文完成，不依赖多余问题文字；保留初始/追加真实投影和读取证据 |
| R3 意图不明 | 一个全新隔离 Thread 仅发送文件引用；消息可发布，模型询问要做的工作，不自行修改；失败按失败留证，不加入未确认提示词 |
| R4 发布后变化 | 一个 Runtime 在已发布后、实际读取前改变文件内容；读取新值而历史 URI/字段不变；另用受控读取屏障制造权限失败，保留真实错误且无成功读文件声明 |

真实 Runtime 预定采用现有合格 Codex 与 Claude Code；各正例一次，失败只保留必要定向复查。
使用新的绝对 fixture 路径，独立 data/userData/Skills/MCP/cache/workspace；不写日常目录，不复制 Session 或
未脱敏凭据到证据。若本机资格或认证不可用，保留未通过状态，不降级成模拟通过。此冻结矩阵不授权扩大
通用模型评测或安装、重启日常 App；真实调用按本次任务与该矩阵执行，具体版本在运行前记录。

## 实施证据（2026-11-07）

实际版本为 schema 170／migration 220、Host Web protocol 6，ComposerDocument 2 与上述 Context／Bootstrap 轴保持。
实现、真实 UI 与确定性门禁结果见[实施记录](project-file-reference-implementation.md#实际实现与验收)，
实际模型输入哈希与文件工具证据见[脱敏记录](project-file-reference-evidence.json)。
真实 Runtime 七例中六例通过，R3 的主动追问失败保留；新增指导属于[待确认补充 R2](model-context-change-project-file-reference-clarification.md)，
未写入本次 Charter，不把本 R1 的确认移用于新规则。当前选文按既有 quote_text 保存可见文本快照，
不重算旧 quote 或 URI 偏移；本次不改变其字段或版本轴。
