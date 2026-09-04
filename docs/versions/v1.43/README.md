---
document_type: version-overview
version: v1.43
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-04
---

# Rovai-ai v1.43：Lexical Composer V2

前置：[v1.42](../v1.42/README.md)。本版本把 Desktop Camp Composer 从 React 全文受控
`contenteditable` 收敛为 Lexical 驱动的结构化纯文本输入框，并把持久 Draft/Pending 内容统一为
`ComposerDocument` V2 的 Text + Atom 领域协议。

## 范围与当前状态

- 输入期间由 Lexical `EditorState` 唯一拥有正文、selection、composition、局部 DOM reconciliation 与
  undo/redo；React Shell 只保留 Catalog、Picker、发送编排和小型同步状态，不逐字符保存完整正文。
- Lexical 内部树只允许单个 `ParagraphNode` 下的 `TextNode`、`LineBreakNode` 与一个
  `ComposerAtomNode`。Atom 是 token、unmergeable 的 `TextNode` 子类，以简单 DOM 呈现，不为每个引用挂载
  React Root。
- Rovai 领域协议只包含 `text` 与 `atom`；Member、All Members、Skill 是 Atom payload。Lexical JSON、节点
  key、selection、history、DOM 和 presentation state 都不进入 Core。
- Member 以 `agentId`、Skill 以 `skillId` 为身份。Catalog 改名、头像和 available 状态只更新展示，不增加
  local content version、不保存 Draft、不进入 history，也不按同名对象重绑。
- `@` Member 与 `/` Skill Typeahead 只扫描光标附近最多 128 个字符，受换行、Atom、分隔符和 composition
  边界限制。Composer 仍是纯文本输入框，Markdown、Rich Text 与 HTML identity 导入均未启用。
- Clipboard 同时提供 `text/plain` 与 `application/x-rovai-composer+json`。私有 MIME 经 closed-schema 校验后
  恢复有效 Atom；不可恢复引用转成可见文本，纯文本和外部 HTML 不反推 identity，文件优先进入附件入口。
- 内容变更以 350ms debounce、1500ms max-wait、single-flight 保存 V2 Snapshot；发送、Draft/Camp 切换和
  其他 revision-dependent mutation 前显式 flush。发送中产生的新 local version 不会被成功回执清空。
- Core 兼容读取旧 Composer Segment 数组，但 Draft 与 Pending 后续只写 V2；`body` 始终从权威
  `ComposerDocument` 派生。公共 Camp Message 的既有 Structured Content 和模型上下文 wire 不变。

## 数据合同

没有 SQLite Migration。既有 `content_json` 列通过严格 reader 接受旧用户可写 Segment 数组与
`ComposerDocument` V2；任何成功 Draft/Pending mutation 都写回 V2 envelope。公开 Message 在发送事务中
由 V2 转换为既有 Structured Camp Message Content，因此 Channel、History、Runtime 与
`CURRENT_INPUT.skills` 的协议版本和语义不变。

所有 `lexical` 与 `@lexical/*` 依赖锁定同一精确版本 `0.50.0`。Extension 配置保持稳定引用，普通 prop
或 Catalog 更新不重建编辑器；只有 `campId:draftId` 身份切换或明确 authoritative replacement 才替换
EditorState。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.42 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.43 |
| Decisions | 已更新 | [V1.43-D01](decisions.md#v1-43-d01)记录 Text + Atom 与 Lexical/public-message 分层；[V1.43-D02](decisions.md#v1-43-d02)记录本地 EditorState、轻量 Atom 与低频 Snapshot；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)和[Pending Camp Input v3](../../contracts/pending-camp-input-v3.md)拥有 V2 wire、旧读新写、派生 body 与 exact flush；公开 Message 合同不变 |
| Architecture | 已更新 | [Camp Composer Draft](../../architecture/camp-composer-draft.md)拥有 Lexical/React/Core 三层权威、编辑树、同步与 replacement 边界；Architecture 索引已更新 |
| UI | 已更新 | [结构化 Mention](../../ui/components/structured-mentions.md)扩展为 Composer Atom、局部 Member/Skill Typeahead、IME、键盘和 Clipboard 合同；既有视觉世界不变 |
| Runtime Activity | 确认无需更新 | Composer 本地更新与 Draft Snapshot 不新增 Canonical Activity、Evidence 或运行状态展示 |
| Runtime compatibility | 确认无需更新 | 公共 Message、Runtime 输入、Skill resolution 与 Adapter wire 不变，没有 Runtime-specific capability 或准入变化 |
| Documentation routing | 已更新 | 文档总导航、Contracts/Architecture/UI 索引和 CURRENT 决定导航均指向 Composer V2 当前权威 |
| Root README | 确认无需更新 | 本次重构输入内部所有权、持久协议与性能路径，不改变项目定位、安装方式或公开 Runtime 支持范围 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)
- [Pending Camp Input v3](../../contracts/pending-camp-input-v3.md)
- [Composer 架构](../../architecture/camp-composer-draft.md)
- [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)
