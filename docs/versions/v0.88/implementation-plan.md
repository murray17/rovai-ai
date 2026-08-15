---
document_type: implementation-plan
version: v0.88
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.88 实施与验收计划

## Checkpoint 0：版本与隔离基线

- [x] 从 `origin/main` 的 `2f95684a334140b988da52cda2681afa9c94137d` 建立独立 worktree，并在合入前重放到 `4475767367511973565408b3a7febc32865f1d29`；
- [x] 使用 `codex/v0.88-world-map-ambient-v2` 分支，保持原工作区未提交改动不受影响；
- [x] 冻结 v0.87，建立唯一 current v0.88，并记录九项跨版本文档影响；
- [x] 更新 Camp 世界地图 UI 合同。

## Checkpoint 1：环境片段资产与纯选择器

- [x] 导入并强类型化 120 条已接受正文，删除三词槽数组和组合生成器；
- [x] 实现节点、环境、运动、单人/偶遇、topic 与 70/30 条件分支；
- [x] 实现参与者/pair 公平选择、55/120 秒冷却、相邻 ID/topic 硬去重与固定软历史层级；
- [x] 增加 catalog 不变量与 selector 的确定性边界测试。

## Checkpoint 2：Camp 级全局调度器

- [x] 以独立 `setTimeout`、单调时钟和 Camp-seeded PRNG 替代角色级计时；
- [x] 实现首次 6–12 秒、后续 22–34 秒、展示 5.6 秒和单次条件式 encounter 抽样；
- [x] 实现 Camp/可见性重置、权威 speech 抑制、事件有效性检查及 schedule/event generation guard；
- [x] 验证无候选不会停摆、过期回调不会清除或写入新事件。

## Checkpoint 3：共享偶遇与响应式字幕

- [x] 增加单个中点共享偶遇气泡，不复用真实 A2A rendezvous 视觉语义；
- [x] 拆分 `sceneActive` 与 `motionActive`，让 reduced motion 保留静态闲时文案；
- [x] 实现 `real > waiting > encounter ambient > solo ambient` 底部仲裁；
- [x] 在 condensed 与 crowded 布局提供统一字幕回退，并保持真实/等待内容可操作性。

## Checkpoint 4：自动与视觉验收

- [x] 扩展全 idle、reduced motion、condensed、crowded 与可控 encounter acceptance fixture；
- [x] 运行格式化检查、类型检查、相关单元测试、文档门禁和 `accept:world-map-ui`；
- [x] 检查 Day/Night、最小窗口、200% 缩放、共享气泡与权威中断视觉；
- [x] 回填实际门禁证据，并只在全部必需工作完成后把版本状态标为 `complete`。

## 自动验收证据

- 120 条目标正文与输入资产逐条比对完全一致；catalog 的数量、唯一性、分类、标点与 grapheme 上限测试通过；
- `pnpm typecheck`：通过；环境资产、selector、scheduler、caption 与原地图模型定向测试 22/22 通过；
- `pnpm test`：文档单测 21/21、Vitest 358/358、package Node tests 186/186 通过；
- `pnpm build:desktop` 与 arm64 macOS directory package：通过；最终 App `codesign --verify --deep --strict` 通过；
- `pnpm accept:world-map-ui`：通过。隔离 fixture 覆盖真实 speech 抑制、1 人 all-idle solo、reduced motion
  静态文案、11 人 crowded、确定性 encounter、单个共享气泡、condensed、Day/Night、`2560×1440`、
  `1040×700` 与 200% zoom；所有布局均无文档横向溢出；
- 截图目检发现并修复港湾边缘共享气泡裁切，复跑后气泡完整位于地图 frame 内；闲时气泡保持中性色、
  无真实 A2A 箭头或交互，crowded/condensed 使用非交互单行字幕；
- Impeccable detector 对本次世界地图 TSX/CSS 新增区域无命中；报告的 warning 均位于未修改的既有全局样式。

以上证据只证明 Renderer 闲时调度、呈现与离线/隔离 UI 回归闭合，不把任何环境片段或偶遇提升为
Core、Runtime、Task、A2A 或 Delivery 事实。
