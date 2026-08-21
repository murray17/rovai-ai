---
document_type: implementation-plan
version: v1.20
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-21
---

# v1.20 会话附件系统打开实施计划

## 1. 治理与合同

- [x] 冻结 v1.19，建立唯一 current v1.20 与 Authority/System Shell 决策；
- [x] 建立 Camp Attachment v5，并同步 Attachment Architecture、基础不变量、UI 和文档路由；
- [x] 明确不修改数据库、Runtime View、Context/Manifest、Built-in Tool 或模型输入。

## 2. Core 与 Desktop 安全边界

- [x] Core 只按 `campId + attachmentId` 查询已发布 `message_attachment`，重验 Camp 精确 Authority path、
  节点类型、大小、digest、目录树与 no-follow identity；
- [x] open target 产生 Core-owned `normal | confirm` 风险结论，覆盖可执行、脚本、安装包和平台程序容器；
- [x] Desktop Main 校验 IPC identity，执行风险确认与 `shell.openPath` / `shell.showItemInFolder`；所有返回 Renderer
  的失败都使用稳定无路径错误码；
- [x] Unix Camp root 保持 `0100`，精确 Attachment container 使用不可写 `0500`；旧 container 在完整 open-target
  校验和 per-Camp admission 内收敛，Finder 可枚举目标但不能删除、改名或写入；
- [x] Desktop Main 在 reveal 前验证 parent 可枚举且 target 仍存在，不把 Electron best-effort `void` 调用未抛错
  解释为文件管理器已确认选择；
- [x] 已发布图片 Authority preview 不再依赖 Runtime projection state，且 preview/open 的文件系统校验都在
  全局数据库 mutex 外执行。

## 3. Renderer 交互

- [x] Timeline 图片保持会话内预览，预览失败可退化为系统打开；普通文件和目录单击执行系统主动作；
- [x] 附件右键菜单提供打开与显示所在位置，具备键盘、焦点、平台文案和 collision handling；
- [x] 每个附件动作防止重复提交，失败通过固定无路径提示呈现；Runtime projection 状态不禁用用户打开；
- [x] Composer Prepared Attachment 保持现有预览、准备与移除边界。

## 4. 验证

- [x] Rust 定向测试覆盖 Camp scope、Published-only、Runtime state 解耦、receipt mismatch 与风险分类；
- [x] TypeScript/Vitest 覆盖 Main closed target、风险取消、reveal preflight、无路径错误、Timeline 可操作状态与平台文案；
- [x] fmt、Clippy、typecheck、Desktop build、文档门禁、全量前端测试和 Impeccable detector 已执行；Rust PR
  suite 仅剩当前 `main` 已存在的 Runtime compatibility register 摘要失配，功能相关范围与其余 295 个 fast
  library tests、CLI、slow suite 单独验证；
- [x] 提交 `75930b1e` 的 macOS arm64 App 已通过深度验签、架构、Core/CLI UUID 一致性和全新隔离
  `userData` 的 packaged onboarding/Camp/Draft/重启/双主题验收，并完成本机 Applications 安装；
- [ ] 在隔离 App fixture 中验证普通文件、图片、目录、高风险确认、失败状态与双主题键盘交互。

## 5. Claude Code 运行中 API 重试维护修复

- [x] 在不等待 stdout EOF/子进程退出的前提下识别 Claude Code session-bound `system/api_retry`，并保留严格
  stderr grammar fallback 与原有 capture/digest；
- [x] 只发布固定 diagnostic ID/code/status、attempt/max 与等待秒数，拒绝 raw stderr、provider body 和凭证；
- [x] 将 diagnostic 持久化为 non-terminal Evidence，明确排除 Canonical Tool Activity；
- [x] 当前 Run 显示 attention notice 与最新重试次数，终态后移除 stale notice 并服从既有 failure/outcome；
- [x] Rust 时序测试覆盖实际 2.1.220 structured event 在 stdout 保持打开时即时投影，并与脱敏/分类、Renderer
  最新 attempt、状态诚实性和私有字段排除测试一并通过。

## 6. Claude Code / TRAE Shell 展示维护修复

- [x] Claude Bash started/terminal `runtime.action` 按同一 tool-use ID 携带相同公开 command；
- [x] ACP 仅白名单公开 `rawInput.command`，稀疏 terminal update 从当前 Prompt 内存观察补齐
  command/kind/digest，其他 rawInput 字段仍只参与 digest；
- [x] ACP execute 的非零 exit code 映射为失败 outcome，并保留 stdout/stderr 与 unknown effect disposition；
- [x] Renderer 对所有公开 Shell command 复用完整脱敏标题与独立“命令/输出”详情，没有 command 的 Adapter
  继续使用现有 fallback；
- [x] Rust/Renderer 定向 fixture 覆盖 Claude terminal 自包含、TRAE command allowlist、稀疏 terminal、exit 7、
  复合命令与详情；
- [x] 完成全量门禁、打包、本机 Applications 替换与受控 Runtime Activity 成品验收。
- [ ] 使用真实 Claude/TRAE 再跑 post-fix 八命令展示复验。

## References

- [v1.20 版本概览](README.md)
- [v1.20 决策记录](decisions.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
