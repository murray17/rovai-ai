---
document_type: implementation-plan
version: v1.20
authority: implementation-and-acceptance-status
status: planned
last_updated: 2026-08-20
---

# v1.20 会话附件系统打开实施计划

## 1. 治理与合同

- [x] 冻结 v1.19，建立唯一 current v1.20 与 Authority/System Shell 决策；
- [x] 建立 Camp Attachment v5，并同步 Attachment Architecture、基础不变量、UI 和文档路由；
- [x] 明确不修改数据库、Runtime View、Context/Manifest、Built-in Tool 或模型输入。

## 2. Core 与 Desktop 安全边界

- [ ] Core 只按 `campId + attachmentId` 查询已发布 `message_attachment`，重验 Camp 精确 Authority path、
  节点类型、大小、digest、目录树与 no-follow identity；
- [ ] open target 产生 Core-owned `normal | confirm` 风险结论，覆盖可执行、脚本、安装包和平台程序容器；
- [ ] Desktop Main 校验 IPC identity，执行风险确认与 `shell.openPath` / `shell.showItemInFolder`；所有返回 Renderer
  的失败都使用稳定无路径错误码；
- [ ] 已发布图片 Authority preview 不再依赖 Runtime projection state。

## 3. Renderer 交互

- [ ] Timeline 图片保持会话内预览，预览失败可退化为系统打开；普通文件和目录单击执行系统主动作；
- [ ] 附件右键菜单提供打开与显示所在位置，具备键盘、焦点、平台文案和 collision handling；
- [ ] 每个附件动作防止重复提交，失败通过固定无路径提示呈现；Runtime projection 状态不禁用用户打开；
- [ ] Composer Prepared Attachment 保持现有预览、准备与移除边界。

## 4. 验证

- [ ] Rust 定向测试覆盖 Camp scope、Published-only、Runtime state 解耦、receipt mismatch 与风险分类；
- [ ] TypeScript/Vitest 覆盖 Preload contract、Timeline 主动作、右键菜单与失败提示；
- [ ] 通过 fmt、Clippy、Rust PR suite、typecheck、Desktop build、文档门禁和 Impeccable detector；
- [ ] 在隔离 App fixture 中验证普通文件、图片、目录、高风险确认、失败状态与双主题键盘交互。

## References

- [v1.20 版本概览](README.md)
- [v1.20 决策记录](decisions.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
