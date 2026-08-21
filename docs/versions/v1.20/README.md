---
document_type: version-overview
version: v1.20
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.20：会话附件系统打开

> 冻结状态：设计与实现已完成，仓库自动化验收除一项既有 Runtime compatibility register 摘要失配外
> 已通过；提交 `75930b1e` 的 macOS arm64 包已通过签名、架构、Sidecar UUID 与隔离 App 基础验收并完成本机
> 安装，附件动作的完整隔离交互矩阵仍待后续执行。
>
> 前置版本：[v1.19 Agent 文件入口隔离与纯附件发送](../v1.19/README.md)。v1.19 已按完成事实冻结为
> historical；其 Authority ingress、统一 publication 与 Runtime View v3 继续作为本版基线。

## 版本目标

让已发布的会话附件遵循桌面系统的自然交互，同时保持本地路径和 Authority 边界不可从 Renderer 绕过：
图片继续在会话内预览，普通文件使用系统默认应用打开，目录交给 Finder / 文件资源管理器打开；高风险
文件在 Desktop Main 执行前二次确认。

## 交付范围

- Core 增加仅供 Desktop Main 使用的 published Attachment open-target lookup；输入只接受 canonical Camp ID
  与 Attachment ID，查询必须同时命中对应 Camp 的 `message_attachment`；
- Core 对 Authority 精确路径、类型、大小、digest、目录树和 no-follow identity 重新验证，目标必须位于
  `<data_dir>/camp-attachments/<camp-id>/<attachment-id>/...`；
- 用户打开 Authority Attachment 不依赖 `runtimeProjectionState`，Runtime View pending、recovery 或 failed
  只影响队员读取；已发布图片预览同样与该状态解耦；
- Desktop Main 独占 `shell.openPath` / `shell.showItemInFolder` 与风险确认；Renderer 只发送 Camp/Attachment ID，
  永不接收路径或可能包含路径的原始系统错误；
- Timeline Attachment Card：图片单击保持会话预览，其他附件单击系统打开；右键菜单提供打开与显示所在位置，
  并覆盖键盘、忙碌、失败和长文件名状态；Composer Prepared Attachment 保持既有准备/移除交互。
- 同版维护修复让 Claude Code 进程存活期间的已知 API 自动重试以安全结构化 Evidence 即时呈现，避免长时间
  只显示泛化“正在处理”；Run 仍保持 running，并在真实终态后使用既有 outcome/failure 权威。
- 同版维护修复让 Claude Code 与 TRAE/ACP 的公开 Shell command 在 started/terminal Evidence 中自包含，
  执行台显示完整脱敏命令、独立命令/输出详情，并把 ACP execute 的非零 exit code 诚实显示为失败。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不改变 Data Contract、CampMessage/Attachment read model、Runtime View、
ContextManifest、Run Facts、Built-in Tool 或模型输入字节。Camp Attachment 合同升级到 v5，只新增 Desktop
本机读取与打开边界；Renderer `RovaiApi` 增加封闭的 `attachments` namespace。

## 实施结果

- Core 将图片预览和 Desktop open target 都拆成短数据库候选查询与无数据库锁的阻塞式 Authority 校验，
  不在全局数据库 mutex 内读取或哈希 payload；
- Desktop Main 已实现 closed target parsing、高风险原生确认、系统打开/显示所在位置和稳定无路径错误映射；
- Unix Authority Camp root 保持 `0100`，精确 Attachment container 以 `0500` 允许 Finder 枚举但禁止删除、
  改名和写入；历史 `0100` container 在完整校验后按需收敛，Main reveal 先验证 parent 可枚举与 target 存在；
- Timeline 已实现图片预览、普通文件/目录系统打开、右键菜单、`Shift+F10` / Context Menu 键、忙碌与 Toast；
- Claude Code 已实现 stdout 未结束前的 session-bound `system/api_retry` 识别，并保留严格 stderr fallback、
  最小公开 diagnostic、持久 Evidence 与当前 Run attention notice；provider error/UUID/Session、raw stderr 与
  凭证不进入公开投影；
- Claude Bash terminal 复用原生 tool-use ID 对应的公开 command；ACP 仅白名单提取 `rawInput.command`，
  同 operation 的稀疏 terminal update 从进程内观察补齐 command/kind/digest，其他 rawInput 字段不公开；
- 所有拥有公开 command 的 Shell Activity 复用完整命令标题与“命令/输出”详情；TRAE 非零 exit code 不再
  被 tool lifecycle 的 `completed` 误显示为成功；
- 定向 Rust、TypeScript、Vitest、fmt、Clippy、Desktop build、文档与全量前端测试通过。Rust PR suite 的
  功能无关唯一失败是当前 `main` 已存在的 `runtime-compatibility.md` 摘要与
  `MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION` 常量不一致；本版不擅自吸收另一分支上的独立修复；
- 提交 `75930b1e` 的 macOS arm64 App 已完成深度验签、三枚 Mach-O 架构检查、Core/CLI 构建与包内 UUID
  一致性检查，并以全新隔离 `userData` 通过 packaged onboarding、Runtime 探测、Camp/Draft、重启和双主题验收。

## 明确不做

- 不让 Renderer、消息、Context、日志或错误携带 Authority / Runtime View 绝对路径；
- 不从 Renderer 接收任意路径，不使用 `shell.openExternal(file://...)`；
- 不把 `.rovai` Runtime View 作为用户打开来源，也不因 View 未就绪而禁用 Authority 打开；
- 不改变 Prepared Attachment 的 Composer 交互或让未发送附件进入 Timeline open API；
- 不把系统打开结果解释为文件内容安全、执行成功或 Runtime 可读。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.19 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.20。 |
| Decisions | 已更新 | [V1.20-D01](decisions.md#v1-20-d01)记录 Authority open target 与 Main-owned Shell 边界。 |
| Contracts | 已更新 | Camp Attachment v5 冻结 open target；Runtime Launch v16 与 Run Process Detail v19 冻结 structured live retry、公共 Shell command lifecycle 与跨 Runtime 展示。 |
| Architecture | 已更新 | Attachment Architecture 同步 Authority 用户打开；基础不变量补充 non-terminal Runtime diagnostic 权威。 |
| UI | 已更新 | Camp 会话工作区定义 Timeline 附件动作，并增加当前 Run 的 Claude API retry notice 与终态收敛。 |
| Runtime Activity | 已更新 | Registry 增加 Claude Code 严格 stderr retry grammar、最小 Evidence 与 non-activity 规则。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 目录准入、已验证版本或功能资格。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航切换到 Camp Attachment v5、Runtime Launch v15 与 Run Process Detail v18。 |
| Root README | 确认无需更新 | 不改变项目定位、平台范围、安装入口或常青能力列表。 |

## References

- [v1.20 实施与验收计划](implementation-plan.md)
- [v1.20 决策记录](decisions.md)
- [Camp Attachment v5](../../contracts/camp-attachment-v5.md)
- [Runtime Launch and Verification v16](../../contracts/runtime-launch-and-verification-v16.md)
- [Run Process Detail Surface v19](../../contracts/run-process-detail-surface-v19.md)
- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
