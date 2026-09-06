---
document_type: implementation-plan
version: v1.52
authority: implementation-and-acceptance-status
status: in-progress
last_updated: 2026-09-06
---

# v1.52 实施与验收

## 正文持久化补充

- [x] Core 以原生消息身份或明确连续边界聚合正文、thought 与 reasoning summary；每块单行、首次位置不变。
- [x] 原生完成结果覆盖同块累计内容；工具事实、旧历史和已有 reasoning 保留语义不变。
- [x] 活动读取叠加内存正文；正常关闭、取消、失败保存已收到的中断块；大正文使用既有 Blob。
- [x] Renderer 数据适配支持块定稿、偏移去重、稀疏历史序号与按需全文读取，不改变 UI 布局。
- [x] 有效 Lead enter 跳过新 reconcile；可见通知采用 Camp 局部变化和冻结 UUID/request 重试；Roster sweep 尊重已有缓存。
- [x] Navigation 聚合先过滤实际影响 marker 的事件；CampOpen 业务读继续不访问 event_log。
- [x] 离线工具默认只操作副本；显式原库模式获得 Core 同款 flock、SQLite 排他锁和完整恢复备份。
- [x] 本地历史副本逐块内容/序号/状态校验，并验证 event_log、工具投影、封存渠道快照不变。
- [ ] 成品 App 隔离验收及真实新 Run 的正文块/写入量验证。
- [ ] 用户授权的日常 App 升级与原库一次性聚合。

### 合同 owner 与最小验证

新增 `execution_text::slow_tests` 拥有跨 Runtime ingress、SQLite/Blob、活动读取和正常关闭的完整 seam。
原 Evidence 测试只证明单条持久化和取消 fence，不能捕捉 1,000 个片段写放大、多组正文/工具交错与定稿
原位覆盖；同一集成 owner 同时覆盖失败、epoch 复用、重启读取和重试零写入。UTF-8 有界前缀由低成本纯函数
owner 覆盖。原生消息矩阵扩展已有 Claude/Pi 测试，批处理、CampOpen 和分页直接扩展既有 owner，不创建平行数据库夹具。

```bash
cargo test --workspace
cargo test -p rovai-core --features slow-tests --lib execution_text::
cargo test -p rovai-core --features slow-tests --lib camp_open_slow_tests:: -- --nocapture
cargo test -p rovai-core --features slow-tests --lib camp_open::slow_tests::
pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/renderer/src/NotificationAttentionController.test.ts apps/desktop/src/shared/execution-presentation/public-result.test.ts apps/desktop/src/main/channel-settings.test.ts
python3 scripts/aggregate-execution-text.test.py
```

测量工具 `measure_camp_open` 仅在 `slow-tests` 下以 SQLite READ_ONLY/query_only 打开明确副本，禁止迁移、
恢复、Runtime 和后台任务；报告首样本及重复分布，不冒充 Renderer 或锁等待的端到端时间。
`aggregate-execution-text.py` 的报告只包含数量、哈希与操作者本地路径，不记录正文或凭据；含用户数据的
副本/备份不得提交仓库。重跑必须使用新输出目录，原库模式不能覆盖已有备份或忽略 Core 独占锁。

真实运行验收复用 `accept:planned-shutdown`；设置 `ROVAI_EXECUTION_TEXT_ACCEPT=1` 时先验证三个正文块与
工具交错，再在下一次运行输出正文期间正常退出并验证中断正文恢复。SQLite 写入计数触发器只安装在该
自动验收 fixture 中，不进入产品 Schema 或日常数据库。

## 实施范围

- [x] 扩展 `ResolvedFilePreview` 成功结果，允许返回可选且既有类型的 `RestoreFilePreviewRequest`。
- [x] Main 在合格 child 成功打开后独立取得当前 Camp workspace 根，并形成可逆的 root-relative 引用。
- [x] workspace authority 不可用、目标越界或引用有歧义时安全省略字段，同时保留既有当前预览结果。
- [x] 在异步 workspace 投影后再次检查 Main binding generation，再注册与发布 handle。
- [x] Renderer 安装时优先使用 Main 稳定来源，阻止后来的临时 child 覆盖同一 Tab 的业务来源。
- [x] 以 `previewKey` 与 Main 确认的项目相对 source key 复用冷 Tab 的稳定 ID。
- [x] 保留外部／临时 child、业务来源身份、restore 副作用和失败内容态的既有边界。
- [x] 增加父释放／删除、A→B→C、冷 Tab 去重、稳定来源保留、外部来源和 A→B→A stale result 回归。
- [x] 完成全仓 Vitest、Desktop build、UI 检查和文档治理门禁。

## 验收重点

- `docs/README.md` 中打开 `./design.md` 后，成功结果携带相对 workspace 根的 `docs/design.md`，不携带父目录相对值；
- 父文件 handle 被释放或父文件被删除后，切换 Camp 再返回仍能以子文件自己的来源恢复；
- A→B→C 每层都获得直接 `camp_workspace` locator，不形成父链或延长父能力；
- 同一项目文件从不同入口或冷 Tab 打开时复用稳定 ID，后来的临时 child 不覆盖稳定业务 source；
- 子文件删除后恢复返回 `file_not_found`，内容区仍只有居中轮廓与“找不到这个文件”；
- 外部／临时／Root Grant child、系统应用格式与旧 binding generation 不获得稳定来源、权限或原生副作用；
- `message_reference`、`attachment` 与 `run_evidence` 保留原来源身份和重验语义。

## 必跑命令

```bash
pnpm exec vitest run apps/desktop/src/renderer/src/file-preview-session.test.ts apps/desktop/src/renderer/src/FilePreviewTabs.test.ts apps/desktop/src/main/file-preview/file-preview-authority.test.ts apps/desktop/src/main/file-preview/file-preview-ipc-input.test.ts apps/desktop/src/file-preview-reference.test.ts apps/desktop/src/main/file-preview/file-preview-service.test.ts apps/desktop/src/main/file-preview/file-preview-watchers.test.ts
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm test:file-preview-layout
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

## 最终验证记录

- File Preview authority、reference、IPC input、Main service、watcher、Renderer session 与 Tabs 定向回归：7 个文件、
  80 个用例通过；
- `pnpm typecheck` 与 `pnpm build:desktop` 通过；
- `pnpm test` 通过：Vitest 154 个文件、1566 个用例通过；Node 220 个用例通过，1 个仅限 Windows 的用例跳过；
- `pnpm test:file-preview-layout`、`pnpm test:desktop-bridge` 与 `pnpm test:file-reference-navigation` 已执行，但本机
  嵌套 macOS sandbox 阻止 Chromium sandbox 初始化，原生业务断言明确跳过且不计为通过；本版本没有改变 File
  Preview 布局、Preload channel 或链接点击行为，相关 TypeScript、Main/Renderer 定向回归和生产构建均通过；
- `pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=6bed8dea125710c0ccb0853a7bc613ec0b0c5e73 pnpm docs:check:ci` 与 `git diff --check` 通过。
