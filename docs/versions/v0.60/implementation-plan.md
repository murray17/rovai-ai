---
document_type: implementation-plan
version: v0.60
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-12
---

# v0.60 实施与验收计划

## Checkpoint 0：范围与既有合同

- [x] 保留现有 Tool Call 行、Evidence 单块预览、AgentRun 聚合与 Drawer 交互；
- [x] 确认只实现开头截断与按需复制全文，不照搬一次性 HTML 的 Shell、字段或布局；
- [x] 复用既有 Camp-scoped `agentRunEvidence.getContent`，不修改 IPC 或 Core schema。

## Checkpoint 1：Renderer

- [x] 短输出原样显示；长输出按 10 行、2,000 Unicode 字符和 Core Blob 标记有界保留开头；
- [x] 删除可见 Tool 行的“查看完整工具调用”二层入口，改为预览右上角无边框复制图标；
- [x] 按事件类型提取公开输出字段，完整 Payload 不写入 state、不渲染到 DOM；
- [x] 实现读取中、复制成功、失败重试和可访问反馈；
- [x] 保留没有可见 Tool 详情的历史 Evidence fallback，避免丢失既有访问能力。

## Checkpoint 2：自动化与真实 App

- [x] 纯函数测试覆盖短输出、只保留开头、Core 截断提示收口、ANSI 清理与公开字段提取；
- [x] CSS 测试覆盖 25px Icon-only、无边框、Focus 与预览右侧保留空间；
- [ ] `pnpm typecheck`、目标 Renderer 测试、完整 `pnpm test` 与 `pnpm build:desktop` 通过；
- [ ] 隔离打包 App 以真实 Managed Blob 验证 8,432 行输出：DOM 无中段/末尾，复制含完整首中尾且无 Envelope JSON；
- [ ] 1440×920、1040×700、200% zoom、Drawer resize 与 sticky-follow 回归通过。

## Checkpoint 3：发布

- [ ] `pnpm package:mac` 生成 arm64 App，签名与嵌入 Core/CLI/native 二进制校验通过；
- [ ] 提交并 fast-forward 推送到 `origin/main`；
- [ ] 退出旧日常 App 后，将已验收构建安装到 `/Applications/Rovai-ai.app` 并从安装位置验证启动路径；
- [ ] 全部门禁完成后将本计划和版本概览状态更新为 `complete`。
