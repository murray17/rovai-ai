---
document_type: version-decisions
version: v1.37
lifecycle: current
last_updated: 2026-09-01
---

# v1.37 决定

<a id="v1-37-d01"></a>
## V1.37-D01：Runtime 图片采用结构化来源与混合生命周期，不升级为文件发布

### 背景

稳定 Runtime 图片路径可直接使用，但本机 Run 临时目录必然清理；有些 Runtime 同时返回 bytes 与 path。
把所有图片转成消息附件会混淆中间结果和显式交付，并把本机可视化带到飞书；把所有路径复制或新增目录授权
又会显著扩大实现和交互。用户明确要求可用性优先、最小验证及不限制目录/符号链接。

### 决定

只接收已适配的结构化结果。稳定路径引用原文件，inline bytes 始终保存，仅 Run 临时路径为生命周期保存到
现有 Blob。普通文件检查与真实解码构成最小读取链；失败局部降级。图片拥有独立 Run 元数据，不自动产生
CampMessage/Attachment/渠道投递。当前规范由 [Runtime 图片架构](../../architecture/runtime-images.md)与
[Runtime Images v3](../../contracts/runtime-images-v3.md) 拥有。

### 后果与替代方案

- 保留零拷贝意味着稳定文件修改/删除会改变或失去预览，这是接受的取舍，不承诺历史 bytes 不变。
- 拒绝路径一律优先：会丢失已有 inline bytes，且临时文件清理后不可恢复。
- 拒绝全部复制：稳定文件无需额外副本；拒绝全不保存：Run 临时结果会必然丢失。
- 拒绝自动 Attachment/文件预览授权框架：图片观察不是交付，扩大领域状态与交互不解决本次问题。

<a id="v1-37-d02"></a>
## V1.37-D02：取消以业务事务为终态边界，Runtime 清理独立且有界

### 背景

实际半取消由 Input 回调推进 Run version 后，旧 cancellation ACK 被 version fence 拒绝引起。重试又以相同
command ID 携带新版本 payload，永久触发幂等冲突。单纯放宽版本或更换重试 ID 仍让会话可用性依赖失联 Runtime。

### 决定

取消事务直接结算业务 Run、义务和受影响 Turn；Runtime 使用既有 active/launch permit 和受管进程后台清理。
新增最小发送 timestamp 区分尚未发送与可能接受；取消原因拥有业务终态，目标 Run 一律为 cancelled，Input/Action
未知证据留作审计且禁止重发，不升级为公共失败或待确认提示。成员离队完全保留既有定向 cutover 集合，单 Run/
离队不关闭整轮渠道；整轮取消抑制重试并允许下一渠道请求推进。

当前权威为 [Cancellation Settlement v2](../../contracts/cancellation-settlement-v2.md)及其专属合同；
模型上下文边界已按[revision 2](model-context-change-cancellation.md)确认。

### 后果与替代方案

- 取消仍不证明进程退出、Input 未发送或效果回滚；底层证据保留，但不再把用户明确停止后的 Run 显示为失败或
  “外部效果待确认”。同 Conversation 清理无法确认时，新 Run 仍有界失败，牺牲该次自动启动以避免旧新执行重叠。
- 拒绝继续修补异步 ACK：无法消除失联进程对业务完成的依赖，也保留重复领域命令的冲突面。
- 拒绝新增通用依赖图、额外 Input 状态协议或每 Run 工作目录隔离：现有持久关联足以界定离队范围，发送前一个
  条件更新足以界定未知证据；扩大模型不能消除本次根因。

<a id="v1-37-d03"></a>
## V1.37-D03：Agent 目标教学收敛到 `--to`，inline alias 只扩展连续有效前缀

### 背景

旧 parser 只识别逻辑行首的一个 exact display-name alias，导致自然生成的 `@惠 @响子` 只投递首位队员；
同时把完整 alias grammar 写入 Agent `body` help 会与稳定 canonical `--to agent_N` 入口竞争。把 cluster 内
未知 token 升级成新错误又会收紧旧行为，使原本可发布的正文被整体拒绝。

### 决定

Agent `body` help 只保留 payload 说明，canonical `--to` 是唯一推荐目标 authoring 入口。Core 继续把 inline
addressing 当兼容与运维兜底：从逻辑行首连续解析由空白分隔的有效 canonical/exact active-member mention，
保留 occurrence 顺序并按 canonical ID 去重 Delivery。第一个未知、歧义或普通文本终止 cluster；相关
display-name lookalike 保持 Text 且不新增发送拒绝，后续 canonical token 延续既有 mid-line 语义。既有
malformed canonical token 与全部 recipient admission 保持不变。

### 后果与替代方案

- 同一行可稳定表达多个现有队员，同时不把 alias 变成公开 Agent authoring 接口；catalog digest 按既有 Binding
  compatibility 轮换，不增加 wire、schema shape、数据库迁移或 Session Charter revision。
- 拒绝继续“一行一个 alias”：它把普通多 mention 截断成部分投递。拒绝任意 mid-line alias：会把叙述文本误当
  调度。拒绝 invalid-tail 原子失败：这是旧行为没有的新严格度，无法为兼容兜底带来相称收益。
- 当前规范由 [Camp Message Send v18](../../contracts/camp-message-send-v18.md)、[Public A2A Message Delivery](../../architecture/public-a2a-message-delivery.md)
  与[确认 revision 3](model-context-change-multi-mention-cluster.md)共同拥有。

<a id="v1-37-d04"></a>
## V1.37-D04：具体文件点击直接形成临时文件能力，不自动升级目录授权

### 背景

文件引用已经明确表达用户要打开的目标，但旧实现仍以 Camp/project root containment 作为普通文件读取前提。
工作区外的 `~/.codex/config.toml` 或 sibling worktree HTML 因而返回 `authorization_required`，Renderer 随即弹出
目录选择器。该流程把一次具体文件意图扩大成目录授权，也让用户必须理解内部 Root Grant；另一方面，完全取消
路径能力会使 HTML 本地资源和 Markdown 相对链接无法安全延续。

### 决定

Core 继续拥有来源映射，Main 在可信点击最终定位到现存普通文件后签发窗口/Camp 绑定的临时具体文件 handle；
canonical file 可以位于来源 root 外，不生成 Root Grant，也不触发目录选择。支持格式直接预览，不支持格式交给
系统默认应用。HTML/Markdown 的自动资源 token 单独绑定当前文档目录并随 Tab 释放；可信子链接点击再获得自己的
具体文件 handle。Root Grant 只保留给选择目录、打开文件夹、添加外部目录或浏览目录等明确目录操作。

当前规范由 [File Preview v3](../../contracts/file-preview-v3.md)、[File Preview Architecture](../../architecture/file-preview.md)
与[Camp 文件预览区](../../ui/components/file-preview.md)拥有。

### 后果与替代方案

- 文件是否位于工作区内不再制造交互差异；描述符恢复、刷新和系统动作重新验证同一来源与 canonical identity，
  失败只反馈无法打开，不把 capability 原因暴露给用户。
- HTML 自动资源获得文档目录内的临时读取范围，这是支持真实本地交互稿的必要扩大；token、sender、generation、
  containment、MIME/大小门禁和 Tab 生命周期共同限制该范围，不能转成持久目录授权。
- 拒绝继续要求 Root Grant：它增加无效 Modal，并把单文件意图扩大成目录能力。拒绝对点击文件永久信任：来源撤销、
  文件替换或身份变化后仍须失败。拒绝让 HTML 直接使用 `file://`：它绕过受控协议、sender gate 与资源释放边界。
