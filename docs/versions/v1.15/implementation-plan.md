---
document_type: implementation-plan
version: v1.15
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-20
---

# v1.15 Windows x64 实施与验收计划

## Checkpoint 0：v1.14 集成与版本治理

- [x] 将已发布的 v1.14 main 合入 Windows worktree，保留双方语义；
- [x] 冻结产品版本 v1.14，建立唯一 current v1.15 与 Data Contract v1.15/schema 52/Migration 97；
- [x] 保留 v1.12 AgentRun 局部停止、v1.13 实际 Runtime 模型观测、v1.14 `camp.read` Timeline 默认、
  Built-in Transport v17、Migration 96 与 Read Model schema；
- [x] 实施已确认的自身 recent public message 过滤：Profile v4 在 top-15/omission 前按 recipient Agent ID
  排除自身作者，Manifest v19/Migration 98 clean break 旧 Binding/Evidence，并以 schema 53 保留 CampMessage；
- [x] 继续采用 [v1.05 Windows 决策记录](../v1.05/decisions.md)和当前 Windows Contracts，不把历史
  v1.05 状态当作实施事实；
- [x] 完成本版所有代码后的 macOS 基线、Windows x64 交叉编译、文档全门禁和 base-aware CI 检查。

## Checkpoint 0A：Camp Published Attachment Runtime View

- [x] 完成并二次确认 revision 2；以 Camp 作为 Published Attachment 共享授权域，撤回 Run/Agent Session
  projection，不暴露或迁移 Authority Attachment root；
- [x] Desktop 显式派生实例隔离 `--runtime-camp-files-root`；Core 完成绝对路径、marker/lock、symlink/reparse、
  overlap、ownership 与 Windows private-storage admission；
- [x] 实现 Camp View catalog、staging/publication/cleanup journal、全组 copy/digest/identity 校验、quota、原子
  promote、startup recovery、controlled rebuild 与 Camp cleanup；
- [x] 使 message publication mutation gate 与整次 Runtime Run read guard 互斥；所有 Adapter 当前采用
  `generation_fenced_v1`，并将精确 Camp root/generation 纳入 Host compatibility；
- [x] 使用统一 Published Attachment path resolver 生成 Current/Shared/Gather refs，升级到 Formatter 21、
  Manifest 20、Run Facts v2、View/Auth receipts，并禁止 dispatch-time Authority path 替换；
- [x] 实现 Migration 99/schema 54：preflight 空 View root，按 delivery/action evidence 收敛旧非终态执行，
  保留历史 Manifest/Blob/Evidence/Authority，并只从 `message_attachment` 回填；
- [x] 覆盖 root admission、publication crash/retry、mutation concurrency、integrity rebuild、Runtime guard、
  force delete、Migration classification/backfill、Desktop 参数及 temporary Smoke root cleanup。

## Checkpoint 1：平台、进程与私有文件系统

- [x] 建立 Windows x64 compile baseline、平台 local IPC seam、target-aware sidecar staging 与 native frame；
- [x] 建立 Runtime platform admission、native executable resolver 与集中 managed process launcher；
- [x] 实现创建时 Job/handle list 原子启动及 owner-loss cleanup 测试；
- [x] 实现 Core/Desktop 私有 data root、local NTFS/DACL admission 与 handle-relative Attachment；
- [ ] 在 Windows 10 22H2/11 真实环境完成进程 race、DACL、reparse、long-path 与 lifecycle 验收。

## Checkpoint 2：Skill Library 与 crash-recoverable Projection

- [x] 实现 Windows logical-mode Skill import、bundled bootstrap、私有 Library copy 与完整 digest 重验；
- [x] 实现 schema 2 journal、同父 staging/final/backup、多阶段恢复与 operationId DB 幂等；
- [x] 将 NTFS entry identity 写入 journal/observation，并在 replace/delete/recovery 前与 digest、DACL 一起验证；
- [x] 实现持久 `agent_run + execution_epoch + root_identity` registration 和 active Run 延迟更新；
- [x] 覆盖 publish/replace/remove、Git exclude、project-owned drift、identity drift、ambiguous recovery 与全 transition crash injection；
- [ ] 在固定 Windows CI 执行全部 Windows Skill projection lifecycle/crash tests，并保留通过证据。

## Checkpoint 3：Transport、Renderer 与 Desktop 行为

- [x] 使 Core `camps.enter` 按权威 activation state 分流：meaningful Pending Camp 冷启动恢复跳过 Default Lead
  reconciliation 并保持 Pending，Active Camp 继续 reconcile-before-read；
- [x] 将共享 ExecutionDrawer 的 AgentRun “停止”改为单击直接提交，移除确认 Dialog，并保留 Run-local
  提交中、结果不确定、已停止与失败恢复投影；
- [x] Camp open 完整返回所有 non-terminal Execution Evidence，Renderer 取消 live event 600 项滚动裁剪，
  运行中正文与 Tool chronology 从首条 Evidence 起完整保留；
- [x] ExecutionDrawer 在底部与 Inspector 间移动同一 DOM 并保留阅读位置；Tool 行收口为
  四轨布局与九类 16px SVG，队员入口不显示状态文案，用户展开后按需读取完整 Tool
  公开结果，并在有最大高度的键盘可滚动 region 中全量渲染；
- [x] 将 `rovai` CLI 与 compaction hook 统一到同一异步 Local IPC client，Windows 与 Unix 共用 framing、超时、
  重试和 outcome-indeterminate 分类，并保留 v1.14 发布的 `camp.read` Timeline 默认；
- [x] Named Pipe 每个实例使用 session logon SID + SYSTEM protected DACL，并在创建后回读 DACL；覆盖
  first-instance、non-inheritable handle、partial byte frame、listener replenish、busy retry、malformed 与 response-loss；
- [ ] 在固定 Windows CI 实跑 Named Pipe v17 matrix，并补齐 wrong token、stale lease、idempotent replay 与
  compaction hook 的完整端到端证据；
- [ ] 对照现有 macOS 页面实现同组件树的 frame、shortcut、copy、Explorer、路径与 Runtime availability 差异；
- [ ] 完成 Forced Colors/High Contrast、keyboard-only、NVDA、中文 IME、DPI/zoom/Snap/multi-monitor 验收；
- [ ] 用 Windows Interaction Delta HTML 作为差异清单，不以原型替代现有 macOS 视觉真源。

## Checkpoint 3A：本机安装级执行台位置偏好

- [x] 确认全局粒度、唯一按钮写入口、独立 Inspector visibility、Main-owned 持久化与旧偏好默认底部，
  记录 [V1.15-D05](decisions.md#v1-15-d05)并建立 [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)；
- [x] 将 General Preferences 推进到 schema 3，加入 `executionConsolePlacement` 与串行原子 setter；v1/v2
  读取保留其他可识别字段并补 `bottom`，不增加 Core/SQLite Migration 或 downgrade reader；
- [x] 在首个 Camp workspace 挂载前取得权威偏好，把 placement 从 CampWorkspace 瞬时 state 提升到 App/Main
  控制；写成功后才移动同一 Drawer DOM，pending 防重复，失败保持旧 snapshot 并原位重试；
- [x] 保持 placement 与 Inspector visibility 独立：普通切 Camp/恢复不强制显示或临时回退，显式移动与
  Task/停止结果/世界地图精确导航仍显示 Inspector、激活“执行”并定位目标；
- [x] 增加 General Preferences migration/store/API 单测、Renderer 状态与失败单测，并扩展 packaged App
  `accept:runtime-activity-ui` 覆盖跨 Camp、一级页面、重启、hidden 组合及首屏无闪跳。

## Checkpoint 4：打包、升级与发布安全

- [ ] 完成 target-isolated resources、x64 per-user NSIS、三个 PE 与 longPathAware manifest；
- [ ] unpacked/installer verifier 校验架构、资源、manifest、hash 与 Core ready；
- [ ] clean-user install/start/uninstall、data 保留、显式删除和 planned-shutdown upgrade 通过；
- [ ] 完成 Electron/Core/CLI/installer Authenticode、RFC 3161 timestamp 与 release signer/hash 验证。

## Checkpoint 5：逐 Runtime 资格与最终发布

- [ ] 十个 Adapter 分别完成 Windows 10 22H2 与 Windows 11 的 immutable digest-bound evidence；
- [ ] 未完成 Adapter 保持 `not_qualified` 且不可 discovery/check/install/select/migrate/execute；
- [ ] macOS 全 Runtime、Transport、process-group、打包和 Renderer 回归通过；
- [ ] 发布 support matrix、安装/升级/故障排查与已知限制后，才更新 Root README 并关闭 v1.15。

## References

- [v1.15 版本概览](README.md)
- [v1.05 历史设计快照](../v1.05/README.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md#历史-adr-索引)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)
- [Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
- [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)
- [Context Delivery Profile v4](../../contracts/context-delivery-profile-v4.md)
- [Camp Published Attachment View architecture](../../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)
- [Camp Attachment v2](../../contracts/camp-attachment-v2.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [Run Facts v2](../../contracts/run-facts-v2.md)
- [Runtime Launch and Verification v10](../../contracts/runtime-launch-and-verification-v10.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
