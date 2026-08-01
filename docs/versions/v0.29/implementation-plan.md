---
document_type: implementation-plan
version: v0.29
authority: implementation-status
status: complete
implementation_authorized: true
last_updated: 2026-08-01
---

# v0.29 实施门禁

> 生产合同：[production-design.md](production-design.md)

用户已明确授权进入生产代码实施。实施必须保持 Renderer-only 边界，并以冻结的生产设计
与本文件检查点作为验收依据。

## 设计门禁

- [x] 完成高影响决策访谈并覆盖关键异常场景。
- [x] 用户明确确认文档已经形成共同理解。
- [x] 冻结生产设计并确定验收矩阵。
- [x] 用户另行明确授权进入代码实施（2026-08-01）。

## 实施检查点

- [x] 队员页统一侧栏切换为唯一名册投影，保留全局入口、通知与设置。
- [x] 名册具备 Presence 分组、四类 Runtime 状态、快捷入口、21+ 本地筛选和专门排序模式。
- [x] 详情收敛为“身份 / 运行配置”双 Tab，并保留身份、头像、Presence、记忆与移除能力。
- [x] 单队员 Runtime/摘要模型草稿具备同队员保留、跨队员与离页确认、并发冲突保护。
- [x] 九种 Product Runtime 继续复用生产表单，Camp 共享摘要模型保持独立保存边界。
- [x] 组件测试、TypeScript 检查和真实页面交互/响应式/无障碍验收通过。
- [x] 实施 diff 不包含 Migration、Core、IPC/Contracts 或 Adapter 语义变化。

A3 HTML 只作为已核对的设计输入，不替代 Core、ADR、生产组件或现有测试合同。

## 验证证据

- `pnpm typecheck`
- `pnpm test`：27 个测试文件、158 项测试通过。
- `pnpm build:desktop`
- `pnpm package:mac`
- `pnpm accept:member-lifecycle-ui`：隔离 `userData` 的打包 App 验收通过，覆盖上下文名册、
  “返回 App”往返、首页白色详情表面、可点击头像与对称 Header 留白、双 Tab、键盘排序
  往返、Runtime 原子保存/清除、
  dirty 草稿继续/放弃、永久移除、
  `1440×920`、`1040×700`、200% 等效内容宽度、reduced-motion、forced-colors 与无横向溢出。
