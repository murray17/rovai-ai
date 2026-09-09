---
document_type: implementation-plan
version: v1.56
authority: implementation-status
status: complete
last_updated: 2026-09-09
---

# v1.56 实施与验收

起始基线 a7668a335cc553defdfd3ef68261de59193edf41，实施分支 codex/partial-message-quotes；已合入 main 基线 23c00258 的个人资料改动。开发者确认 revision 6 模型上下文和后续 revision 9 交互，并授权真实 Runtime、PR 合入 main 与本机 Applications 安装。

## 实施范围

- Core 按实际 Camp/精确 Conversation 验证单条用户或队员消息的选区，生成不可变有序快照；多个部分逐次添加，移除保留剩余条目的顺序。
- Migration 148 将 v1.55 / schema 97 推进到 v1.56 / schema 98，为八个 Draft/Pending/Edit/Message owner 添加引用存储，为编辑 owner 添加移除暂存。发送、排队、编辑取消/保存、发布、重启、失败和删除遵循原事务边界。
- CURRENT_INPUT.quotes 与 message/skills/attachments 同级。来源采用 current_conversation_messages、messageId、作者，引用作为完整纯文本材料；不解析提及、Skill、指令或派发意图。
- Formatter 23、Manifest 23、Profile 5、Charter revision 6、Built-in Transport 24、Camp History 5；新增引用证据与完整输入摘要。旧 formatter 22 冻结字节与 digest 继续精确重放；含引用历史按完整组计费，必要输入不截断。
- 公共和私聊的草稿、待发送编辑及历史共用紧凑标签。悬浮/键盘显示非模态气泡，整行选文点击回跳，草稿独立直接移除；没有撤销入口、具体选文常驻、二级查看按钮或模态框。移除最后一段后关闭气泡并移除标签区，键盘焦点回到问题输入框；保留原问题和失败时的引用。
- 来源定位由不可变快照内的可选投影摘要与标量范围恢复，覆盖涉及的完整视觉行，双主题底色短暂淡出。重复文本按捕获范围区分，旧快照只做唯一匹配，内容变化/歧义不猜测；布局重排重新计算，装饰不阻断下一次选文。
- 单条正文可含多个段落、代码、Unicode、结构化队员/当前用户前缀；当前用户自定义名称仅影响用户实际选取的可见文字，不改写来源或冻结上下文。跨消息、正文外、卡片/附件和复制后的残留选区不显示引用入口。

## 验证证据

| Gate | 结果 |
| --- | --- |
| pnpm typecheck | 通过 |
| pnpm test | 168 个 Vitest 文件、1,717 个测试通过；脚本/Benchmark 222 通过、1 个 Windows 专项按平台跳过；文档和 Skill 治理通过 |
| pnpm test:rust:pr | Library 545、Agent CLI 33、slow integration 309 全部通过 |
| Core Main target | 234 通过、5 个需要外部条件的既有测试按原策略忽略 |
| Quote projection/capture owner | 共享 Unicode、CRLF、GFM、代码与结构化前缀输入矩阵通过；来源身份、不可变快照、旧快照兼容及定位信息不进入模型均通过 |
| cargo clippy --workspace --all-targets -- -D warnings | 通过 |
| Electron test:message-quotes | 生产 Renderer 原生悬浮、跨气泡移动、键盘、全文只读/移除/撤销、选区排除、失败保留、重复文本与过期来源、两行代码及跨段落、重排、两主题/200% zoom 通过 |
| pnpm test:desktop-bridge | 通过，使用独立 userData 的真实 Electron IPC |
| pnpm build:desktop | 通过 |
| docs:check:ci | 按真实 main base 23c00258 验证历史决定冻结与当前权威路由 |

Rust 新测试的独立 owner 为消息可读投影与来源捕获边界：普通映射和非法来源无需完整 App；持久化、队列、迁移、预算及 frozen delivery 的 case 扩展原有唯一 owner，没有新增平行数据库 fixture 或停用既有测试。结构化前缀与按行定位后续改动再次运行对应最低成本 owner，完整 owner 事务由 Runtime 验收补充证明。

2026-09-09 直接移除修订：按开发者补充要求取消撤销入口，保留 Core restore 协议兼容。生产 Electron 夹具验证移除失败保留、剩余顺序/计数、键盘相邻行焦点、最后一段移除后无空占位并回到原问题、重新添加后默认收起；原悬浮、来源行定位、两主题与 200% zoom 均通过。Typecheck、完整 pnpm test 与按 base 12255a49 的文档门禁通过；本次未改 Rust。上表及下文中的撤销验收保留为初次交付事实，不代表当前 UI 提供该入口。

## 隔离真实 Codex Runtime

最终验收根目录为 `/private/tmp/rovai-message-quotes-final-20260909`；数据库、Skill Library、MCP config 与测试项目均为隔离资源，Runtime files 由规范 data-directory helper 解析。未访问日常 userData 进行发送或修改。

- 公共 Camp `rvcamp_01m22x502nee8swsy3vr2grc1f`，Run `17dd5f70-c3ea-4e7f-bbc9-e4af6c422d65`：同一来源的两段加另一来源的一段完整送达，发布消息保存原顺序和 locator；重复命令不重复引用，移除/撤销和 quote-only 失败保留通过。Manifest 为 23/Profile 5，引用证据为 3 段。仅预期队员执行，无额外 Task 或引用命令生成的文件，字面 campfire 不进入 Skill 选择。
- 私聊 Conversation `1401bd6a-fe72-493f-8d96-372ddef499f9`：三次真实 Run 成功。引用发送、忙时排队、编辑移除/取消/恢复/保存、自动提升、精确 Conversation 隔离、空问题拒绝及选文保留通过。
- 私聊 Run：`f58a8f36-141e-4cf5-843a-d69751ea5910`、`1b3ecca6-4349-42f4-8944-efd9571399c2`、`c3876784-271d-4c6d-a2a5-238fa547dec2`。

本地详细报告保存在该验收根目录的 report.json / private-report.json。上述是本机 Codex Runtime 的实测，不替代其他 Adapter 的独立兼容性资格。

## 交付边界

实现和上述验收完成后通过 PR 合入 main。daily App 使用 package:mac:daily 与 install:mac:daily 的签名、架构、暂存及备份门交付；具体 PR、合并 commit、安装与非终止交接结果记在该 PR 和任务交付记录，不把本地代码验收当成已安装证明。主 checkout 的其他未提交文档保持原位，功能分支合入后按 worktree 清理规则收口。
