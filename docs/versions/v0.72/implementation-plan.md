---
document_type: implementation-plan
version: v0.72
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.72 实施与验收计划

## Checkpoint 0：版本与边界冻结

- [x] v0.71 按完成事实冻结为 historical，v0.72 成为唯一 current；
- [x] 冻结“只改会话阅读面”，左侧菜单、Camp Header、Inspector、Composer、Approval/Recovery Dock 与
  可拖动 Agent 执行台不改结构；
- [x] 冻结地图是只读 Renderer projection，不表示进度、不写回领域状态；
- [x] 冻结真实执行播报、带标签闲时预设、静态模式继续更新真实文字的诚实性边界；
- [x] 完成九项跨版本文档影响判断，确认不新增 ADR、Contract 或 Architecture 文档。

## Checkpoint 1：只读投影与深模块接口

- [x] 从现有 CampMember、AgentRun 与 `LiveExecutionProgress` 投影有界的地图队员 view model；
- [x] 复用 `MemberAvatar` 与现有身份 fallback，不硬编码本机示例队员或绝对路径；
- [x] 定义固定地点、固定路网、稳定种子、停留与等待状态选择器；
- [x] 为投影、真实摘要选择、截断、路线可达性和稳定随机规则增加纯函数测试。

## Checkpoint 2：会话区地图与路线移动

- [x] 引入项目提供的 2K 港湾地图资产并记录来源；
- [x] 在现有时间线容器内增加常规会话 / 世界地图悬浮切换，不占用 Header 或独立工具栏；
- [x] 实现固定路网、路线显隐、慢速节点间移动与停留；
- [x] 地图随 Inspector 显隐和执行台拖动后的容器高度自适应，紧凑高度仍可识别人物与播报；
- [x] 切换视图保持时间线滚动、Draft、Approval、Inspector 与执行台选择。

## Checkpoint 3：真实播报、闲时预设与 A2A 投影

- [x] 忙时气泡选择真实 narration、plan 或 tool activity，长文本有界省略且不合成进度；
- [x] 闲时气泡使用确定性预设组合并显示“闲时 · 环境预设”；
- [x] 等待与结果待确认状态静止，文案不暗示恢复中或成功；
- [x] 点击有过程的队员复用现有 Agent 执行台，后台更新不自动打开或切换；
- [x] 仅在既有事实充分时投影 A2A 快速集结，并明确不把会合当作 Delivery 或协作完成。

## Checkpoint 4：运动、主题与可访问性

- [x] 静态模式与 `prefers-reduced-motion` 停止移动、脉冲和路线流光，真实文字仍实时更新；
- [x] Porcelain Day / Steel Night 使用同一 DOM、状态矩阵和语义 token，不引入主题分叉硬编码；
- [x] 切换与路线控件具备可访问名称、可见焦点、键盘操作和清晰选中状态；
- [x] 空成员、单成员、长名称、长 CJK/emoji、头像缺失和部分 Snapshot 状态保持可恢复。

## Checkpoint 5：自动化与隔离 App 验收

- [x] 相关 Vitest 与 `pnpm typecheck` 通过；
- [x] `pnpm build:desktop` 通过，`git diff --check` 无格式问题；
- [x] 文档 test/check/diff-aware/generation 门禁通过；
- [x] Impeccable hardening detector 对最终 UI 改动返回空问题集或全部问题已审阅处理；
- [x] 使用隔离 `userData` 的开发版或打包 App 完成 Day/Night、1040×700、1440×920、2560×1440、
  200% zoom、reduced motion、执行台上下拖动和真实文字更新的有界视觉验收；
- [x] 只有全部发布门槛具备可复现证据后，才把版本 `implementation_status` 与计划 `status` 改为
  `complete`。

## 当前证据

- 生产只读投影、固定路网、运动与播报分别落在 `camp-world-map-model.ts` 与 `CampWorldMap.tsx`；
  `CampWorkspace` 只负责提供既有 Camp Snapshot、真实执行摘要和打开现有执行台的回调；
- `camp-world-map-model.test.ts` 的 7 项纯函数测试覆盖稳定点位、路线连通、最近会合、预设文案、
  Markdown/CJK/emoji 截断、真实/等待播报和 A2A 事实门槛；全量 Vitest 为 48 文件 / 328 项通过；
- `pnpm test`、`pnpm typecheck`、`pnpm package:mac`、`git diff --check` 与四项文档治理命令通过；
- 最终 Impeccable detector 没有命中新增世界地图选择器；输出的 warning 均位于本版本未改动的既有
  全局样式行，已审阅且不扩大本版本边界；
- `pnpm accept:world-map-ui` 使用隔离 `userData` 的打包 App 通过：默认地图与键盘切换、4 位当前队员、
  2560×1440 资产、15 条固定路线、真实执行与带标签闲时播报、Day/Night、执行台最大压缩、1040×700、
  2560×1440、200% zoom 和 reduced motion 均保持真实文字；各尺寸整页横向溢出为 0；
- 项目提供的 HTML 交互稿仅作为路线与视觉输入，没有被用作生产完成证据。
