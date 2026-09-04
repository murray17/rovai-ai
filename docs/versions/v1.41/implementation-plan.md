---
document_type: implementation-plan
version: v1.41
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-04
---

# v1.41 实施与验收

## 实施范围

- [x] `NavigationPreferencesSnapshot` 与 `navigation.json` 升级为 schema 3，并以 nullable
  `projectOrder` 区分“尚未首次冻结”和“已初始化为空列表”。
- [x] Main Store 接受 schema 2 无损升级，校验 canonical Project key，并串行、原子地完成首次初始化、
  既有项保序、新项追加和消失项清理。
- [x] Project 本机移除同时清理顺序；恢复或新发现后在下一次同步中追加，不复活旧活动位置。
- [x] Preload 暴露受限同步调用；Renderer 在首次 Overview 和每次 Navigation Snapshot 刷新后同步，
  偏好失败不阻断 Core Navigation Refresh Coordinator。
- [x] 侧栏与新对话列表按持久顺序投影；Core Snapshot 与 Project 内 Camp 最近活动排序保持不变。

## 验收重点

- schema 2 用户第一次进入 Sidecar 时，看到的旧版 Project 顺序成为 schema 3 的初始 `projectOrder`；
- 同一批旧 Project 即使 Core 因新消息返回了不同活动顺序，保存顺序和 Sidecar 行位置都不变化；
- 新 Project 追加到尾部，已消失或本机移除的 Project 从顺序清理；空 Project 同样位于末尾；
- `lastActivityAt`、未读 marker 和 Camp 最近活动排序继续更新，不被 Project 稳定顺序吞掉；
- 畸形、重复或非 directory key 不进入持久顺序，合法旧 schema 不产生错误降级提示；
- 没有 SQLite、Runtime、Channel、Context 或模型输入变化。

## 必跑命令

```bash
pnpm exec vitest run apps/desktop/src/main/navigation-preferences.test.ts apps/desktop/src/renderer/src/new-conversation-preferences.test.ts
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=544e5353 pnpm docs:check:ci
git diff --check
```

## 验证记录

- [x] Main Store 与 Renderer 纯投影定向测试通过：2 files / 17 tests。
- [x] `pnpm typecheck` 通过。
- [x] 扩展定向回归通过：3 files / 173 tests。
- [x] 完整 `pnpm test` 通过：146 个 Vitest 文件 / 1538 tests；221 个 Node tests 中 220 个通过、
  1 个既定 Windows test skipped。
- [x] `pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、固定 base 的
  `docs:check:ci` 与 `git diff --check` 通过。
- [x] `test:desktop-bridge`、`test:startup-presentation` 与 `test:camp-open-projection` 均使用脚本创建的
  临时隔离 `userData` 启动，但宿主在业务断言前返回 `sandbox initialization failed: Operation not permitted`，
  随后 Chromium GPU 进程终止；该结果只记录为环境阻断，不关闭 sandbox、不改写产品代码，也不宣称
  Electron 组合断言通过。
