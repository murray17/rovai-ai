---
document_type: version-overview
version: v1.19
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-20
---

# Rovai-ai v1.19：Agent 文件入口隔离与纯附件发送

> 当前状态：设计、实施、验证、推送与 macOS arm64 安装发布均已完成。
>
> 前置版本：[v1.18 Codex 执行台真实命令预览](../v1.18/README.md)。v1.18 已按完成事实冻结为
> historical；v1.17 建立的统一附件 publication、Delivery gate 和 Runtime View v3 继续作为本版基线。
>
> 后续版本：[v1.20 会话附件系统打开](../v1.20/README.md)。

## 版本目标

修复 Agent 文件发送正常路径上的两个隔离缺口，并让 Agent 与 Composer 使用一致的 attachment-only payload
语义：`ROVAI_RUN_TMP` 对当前 lease 真实可写且不会把 warm Host 的旧文件带入下一 Run；同一 Camp 的
Authority 根权限切换不会在并发 Composer/Agent ingress 间相互破坏；`rovai send --file <path>` 无需制造
占位正文即可提交真实公共附件消息。

## 交付范围

- `ROVAI_RUN_TMP` 保持 Runtime 进程启动时继承的稳定精确路径，但每次新 lease 在激活前 fail-closed 清空并
  重新创建；unbind 尽力清理，后继 bind 必须重新初始化成功才可签发凭据；
- Codex、Claude Code、七个 ACP Runtime 与 Antigravity 都把当前进程精确 Run tmp 根加入原生目录准入，且不
  暴露其 Application Support 父目录；
- authenticated invocation 返回当前 active lease 已重置的 exact Run tmp；文件冻结继续重验
  process/lease generation/Run/epoch/path identity，不能从 warm Host 的前一 lease 读取遗留文件；
- `CampAttachmentStore` 的所有 Camp Authority 根权限切换、子目录创建/删除和失败清理由跨 Store 实例共享的
  per-Camp ingress gate 串行；不同 Camp 不共享该锁，文件 copy/hash 不回到数据库或 built-in 全局锁；
- `CampMessageSendInput.body` 缺省为 `""`，`files` 缺省为 `[]`；领域准入要求 trim 后正文非空或至少一个文件；
  `rovai send --file "$ROVAI_RUN_TMP/report.pdf"` 成为正式 CLI 形态；
- accepted、真实 `messageId` / `deliveryIds`、异步 View publication、Delivery projection gate、附件配额和
  terminal failure 语义全部保持不变。

## 数据与 Context 兼容性

本版不增加数据库 Migration，继续使用 Data Contract `v1.17 / projection schema 58 / Migration 103`。
Camp Published Attachment View contract 3、Receipt v2、Formatter 21、ContextManifest 21、Run Facts v2、
Profile v4 与 Session Charter bytes 不变。

Built-in Tool contract/capability 升级到 v19，Runtime Launch and Verification 升级到 v13，以 fence 没有
Run tmp lease 重置和精确目录准入的旧 Host。Send schema/help 的可选 body 属于按需 CLI contract，不改变
自动注入的模型上下文字节。

## 明确不做

- 不把 Run tmp 改成 Camp 共享目录、附件 Authority 或历史存储；
- 不允许任意临时目录、Application Support 父目录、其他 Run tmp 或 Authority 根进入 Runtime；
- 不用全局 invocation guard 或数据库 mutex 串行化附件复制；
- 不改变附件 publication/View revision、Delivery gate、数据库状态机或 Agent accepted output；
- 不为 attachment-only 消息生成占位正文，也不让空正文加空文件通过领域准入。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.18 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.19。 |
| Decisions | 已更新 | [V1.19-D01](decisions.md#v1-19-d01)记录稳定进程路径上的 lease 隔离与 per-Camp Authority ingress；[V1.19-D02](decisions.md#v1-19-d02)记录正文或附件联合发送门禁。 |
| Contracts | 已更新 | Camp Message Send v12、Camp Attachment v4、Built-in Tool Transport v19 与 Runtime Launch and Verification v13 冻结新边界。 |
| Architecture | 已更新 | Built-in Tool Runtime、Camp Published Attachment View 与基础不变量同步 Run tmp 和 Authority ingress 责任。 |
| UI | 确认无需更新 | Composer 已支持纯附件；Agent attachment-only 复用同一空正文 Timeline 和附件卡投影。 |
| Runtime Activity | 确认无需更新 | 目录准入和 Authority 锁是 Host/Core 内部安全边界，不新增 Runtime activity 或 Evidence shape。 |
| Runtime compatibility | 确认无需更新 | 不改变已实测 Runtime 版本或功能结论；旧 Host 由 Built-in/Launch contract fence 失效。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航切换到 v1.19 当前合同。 |
| Root README | 确认无需更新 | 不改变项目定位、平台范围、安装入口或常青能力列表。 |

## References

- [v1.19 实施与验收计划](implementation-plan.md)
- [v1.19 决策记录](decisions.md)
- [Camp Message Send v12](../../contracts/camp-message-send-v12.md)
- [Camp Attachment v4](../../contracts/camp-attachment-v4.md)
- [Built-in Tool Transport v19](../../contracts/builtin-tool-transport-v19.md)
- [Runtime Launch and Verification v13](../../contracts/runtime-launch-and-verification-v13.md)
