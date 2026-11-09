---
document_type: model-context-change
version: v1.72
authority: model-input-change-proposal
change_id: project-directory-reference
revision: 1
confirmation_status: confirmed
confirmed_by: User
confirmed_at: 2026-11-08T10:36:27Z
confirmed_revision: 1
confirmation_message_id: 25b26abc-793b-4f90-b4b4-eceb1dfee5b5
implementation_status: in_progress
last_updated: 2026-11-08
base_commit: e12d3eaf2d65182402e147405422acab11262306
---

# 项目目录引用实施说明 R1

本文的模型输入 R1 已由 User 在 sequence 47 确认实施，尚不代表实现或验收完成。完整 R1 在 sequence 44
（公开消息 `7f57a8aa-9137-4616-866f-d42f3a1a2012`）提供后，User 在 sequence 45 修订候选展示，
sequence 47（`25b26abc-793b-4f90-b4b4-eceb1dfee5b5`）要求去掉候选及输入标签的目录末尾 `/`，
并明确“其他没问题，改完后 pr 到 main merge 安装到本机”。这构成对已提供 R1 的后续实施确认。
confirmed_at 是登记该确认的 UTC 时间，不冒充原消息时间戳。

显示修订按 User sequence 45/47 执行：根层不显示辅助路径、四个 Tab 分开展示、桌面 480px、
目录短标签无末尾 `/`。这些修改不改变下文模型可见正文的目录 URI 或完整身份字段。

## 目标

公开对话的 `@` 文件类别同时包含当前有效根内可用文件和目录。二者共用候选、选择、编辑和发送流程。
目录只提供经过 Host 确认的路径，由智能体使用现有工具按需查看。选择不自动预览，目录不递归注入内容，
不增加产品确认框，不修改 Charter 或增加“必须追问任务”的规则。

候选采用同一行的“类型图标、名称、灰色父目录”，全部连续左排；图标与名称居中。
目录使用现有 ProjectFolderIcon；文件继续使用 ProjectFileIcon。四类候选分开显示，手动类别固定；桌面宽度 480px，窄屏收缩。
点击已发送目录引用打开现有项目文件树并定位该目录；文件仍打开文件预览。

## 变更前

草稿、正式段和目标解析请求分别为以下封闭对象；未列字段拒绝：

```ts
type Draft = {
  type: 'project_file_reference'
  threadId: string
  rawReference: string
  labelFallback: string
}
type Published = {
  kind: 'project_file_reference'
  threadId: string
  rawReference: string
  pathAtSend: string
  labelAtSend: string
}
type ResolveRequest = {
  threadId: string
  references: Array<{ threadId: string; rawReference: string }>
}
type OpenSource = {
  kind: 'project_file'
  threadId: string
  rawReference: string
}
```

目录在 Core 非空搜索和前端候选层被过滤；open、resolve 和发送预检要求普通可读文件。
文件按原位置投影，例如 `[src/auth/login.ts](file:///project/src/auth/login.ts)`。

## 变更后

沿用原 Atom 和正式段，增加封闭类型字段 `targetKind?: 'file' | 'directory'`：

```ts
type TargetKind = 'file' | 'directory'
type Draft = {
  type: 'project_file_reference'
  threadId: string
  rawReference: string
  labelFallback: string
  targetKind?: TargetKind
}
type Published = {
  kind: 'project_file_reference'
  threadId: string
  rawReference: string
  pathAtSend: string
  labelAtSend: string
  targetKind?: TargetKind
}
type ResolveRequest = {
  threadId: string
  references: Array<{
    threadId: string
    rawReference: string
    targetKind?: TargetKind
  }>
}
type OpenSource = {
  kind: 'project_file'
  threadId: string
  rawReference: string
  targetKind?: TargetKind
}
```

缺省表示 file，保证旧草稿和历史段仍明确表示普通文件。新目录必须携带 directory；文件继续省略该字段，
保持原文件消息的序列化和投影字节。非法枚举、null、未知字段拒绝；不得从 labelFallback 或尾斜线推断类型。
rawReference 仍为 Base64URL `[rootIdentity, relativePath]`，不加入 scope，不改来源串编码与 16 KiB 边界。

OpenSource 是项目条目来源；调用方先按类型分流。directory 不送入文件内容预览器。
解析返回保留既有 `{ok:true,value:[...]}` / `{ok:false,error}` 包装，available 中返回含目录类型的目标 Draft；
needs_reselect、unavailable 的身份与错误边界保持。历史预览的 expectedPathAtSend 仍用于核对冻结位置。

Core 根据当前目标 Thread 的绑定解析，不信任客户端自报类型。选择目录时确认其为合法可读目录；文件仍确认
可读普通文件。发送再次确认当前目标与所选类型一致，再由 Core 构造正式字段。文件变成目录或目录变成文件
都拒绝，不用相同路径静默换类型；新增明确原因 `target_kind_changed`。去重同时核对引用类型，不能由同路径
另一个段绕过类型校验。非法目录、根外链接、已有规则禁止的目录符号链接和特殊文件继续拒绝。

目录 labelFallback / labelAtSend 保存完整项目相对目录；pathAtSend 保存 Core 规范绝对目录。
末尾 `/` 只用于模型正文中的目录标签及 URI 投影，不参与定位；候选与输入框不显示末尾 `/`。短名称和同名消歧继续从完整字段计算；保存和恢复不丢类型。

### 正文与模型输入

目录使用 URI 库生成带末尾 `/` 的 file URI，标签同样保留末尾 `/`：

```json
{
  "kind": "project_file_reference",
  "threadId": "<目标Thread>",
  "rawReference": "<Host返回的根身份与相对路径来源串>",
  "targetKind": "directory",
  "pathAtSend": "/project/src/auth",
  "labelAtSend": "src/auth"
}
```

对应模型可见消息片段：

```json
{
  "body": "查看 [src/auth/](file:///project/src/auth/) 的职责划分。",
  "senderType": "user",
  "senderId": "user"
}
```

这个片段仅展示原 messages 项中受关注的字段；其余现有字段及省略条件完全沿用。
旧文件投影仍为 `[src/auth/login.ts](file:///project/src/auth/login.ts)`，不增加文件名包装或其他模型文字。
目录可单独构成实际输入，或与文字、队员提及、文件和附件组合；不改变寻址和默认接收者。
真实模型读取只验证路径对应关系与工具结果，不增加要求模型主动追问的验收。

## 明确不变

- 有效根仍优先 ready Mission 工作副本，否则使用项目目录；打开候选不准备工作副本。
- 绑定、根代次、规范路径、根对象、目标 Thread 权限、根内边界、ignore 与禁止链接规则继续有效。
- 菜单空查询只读根层；非空搜索仍按既有遍历与结果预算返回，partial 不伪装完整。
- 只取消两个目录过滤分支，不增加递归预载、目录推荐或目录内容搜索。
- 段数 4096、草稿和正式可变内容 1 MiB、完整正文投影 1 MiB 均保持；目录类型字符串计入实际可变字节。
- 最多 32 个不同项目条目（文件与目录合计）；重复出现保留，校验去重。
- commandId 先回放；I/O 在 SQL 事务外；事务中复查业务绑定和回执；Pending 激活、发布、投递仍原子。
- 请求失败留稿；传输异常与明确不可用仍区分；旧异步结果不能覆盖新查询、发送拒绝或新插入位置。
- 同 Thread 复制、草稿、历史和失败恢复保留目录类型；跨 Thread 由目标有效根确认后签发目标身份。
- 不新增 RUN_INPUT.files、SourceAttachment、目录快照或自动目录内容；不修改 Bootstrap、Charter、Memory、
  Skill/MCP、RUN_FACTS、消息选择、截断或 Context evidence 结构。
- 不改旧消息、既有 quote 快照、已冻结输入和旧回执；历史点击重新验证身份、类型及发布位置。
- 单聊、行范围和跨项目主动选择继续不在范围内。

## 版本、兼容和恢复

| 版本轴 | 计划 |
| --- | --- |
| ComposerDocument | 保持 2，新增可缺省类型字段，缺省 file |
| 项目引用合同 | 新 v2，更新发送、输入恢复、文件预览和 UI 合同的对应范围 |
| Host 能力 | composerProjectFileReferenceVersion 1 → 2；不支持目录的 Host 不开放目录引用 |
| Web 协议 | protocolVersion 6 → 7，阻止旧 Web 错误解释目录或丢字段 |
| 数据库准入 | schema 171 → 172，旧 Core 不读取新目录段；迁移编号按实施时主线分配，当前下一号为 222 |
| Formatter / Manifest | 43 与非 batch 44 保持；messages.body 的 serializer shape 不变 |
| Bootstrap / Charter / Runtime / CLI | 全部保持，包括 Charter 26；不引入提示规则 |

不新增业务表；先检查 SQLite JSON 约束，必要时仅扩展闭合字段与准入标记。
旧文件段按 file 解析且重新序列化不增字段。旧文件 Atom 指向后来出现的目录时拒绝，不能升级为目录。
无法理解的草稿保持原材料并阻止不兼容读写，不能清空或默默降文字。

## 验证

先修共享展示与候选，再打通目录 open/resolve/发布/投影/恢复，最后启用候选与历史目录跳转。
共享枚举、TS/Rust 封闭字段与所有转换分支同时检查，避免在默认分支把目录当文件预览。

| 验证 | 通过条件 |
| --- | --- |
| 搜索、空查询和类型图标 | 同一列表含文件与目录，仍过滤不可用项，结果预算和 partial 保留 |
| 文件/目录选择 | 同一交互插入，选中不自动预览，无人工延时或装饰性加载 |
| UI 排版 | 图标、名称中心对齐，路径紧随名称左排；长名保留文件扩展和 test/spec 差异 |
| 类型与边界 | 普通文件、目录分别通过；删除、类型互换、根替换、根外链接、目录链接、特殊文件明确拒绝留稿 |
| 发布与重放 | 仅目录可发送，目录与文件混合可发送，重复引用保留；同 commandId 不重解析或重复发布 |
| Pending | 失效目录首条消息无部分激活、消息或 Deliveries |
| URI | 中文、空格、括号、井号及 Windows/UNC 目录正确编码，目录标签与 URI 都有末尾 /；旧文件字节不变 |
| 恢复 | 复制、草稿、输入历史、发送失败保留类型与位置；跨根不猜选 |
| 激活与选区 | 文件打开预览，目录定位文件树；拖选文本不误开；关闭后编辑位置正常 |
| Desktop / 已认证 Web | 实际 UI 路径均通过；浅色、深色、1040/1440 与 Web 390 窄屏无横向溢出且文件名可读 |
| 真实 Runtime 定位 | 同名目录含不同随机值，只引用其一，明确要求列出并读取其中指定文件，结果对应所选目录 |
| 特殊路径 / 工作树 | 特殊名称目录可实际读取；项目与 Mission 工作树同名目录中不同随机值时只读取有效根目标 |
| 按需边界 | 保留实际 RUN_INPUT、投影与工具调用证据：只有目录 URI，未自动注入目录所有文件 |

HTML 验证只证明离线界面行为，不作为 Core 权限、正式发送或真实 Runtime 读取通过的证据。

## 二次确认

revision: 1；confirmation_status: confirmed；confirmed_revision: 1。
confirmed_by: User；confirmation_message_id: `25b26abc-793b-4f90-b4b4-eceb1dfee5b5`。
确认涵盖 R1 模型输入合同与上述用户明确的 UI 修订。Charter 不变，不恢复已取消的专属追问规则或验收。
