---
document_type: implementation-plan
version: v0.81
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.81 实施与验收计划

## Checkpoint 0：版本与合同

- [x] 从完成的 v0.80 最新 `origin/main` 开启唯一 current v0.81；
- [x] 接受 Camp Open Projection v1 与 Camp Open Read Path；
- [x] 以真实 evidence-heavy Camp 记录完整 snapshot 约 22.1 MB / 5.74 s 的冷进程基线；
- [x] 确认方法只属于 Desktop typed IPC，不进入 Agent tools。

## Checkpoint 1：Core 与 Main

- [x] 实现 `camps.enter` 的 reconcile → projection 顺序与 rejected fail-closed；
- [x] 实现 `camps.open` 有界 transaction、coverage/count 与 `camp.messages.page`；
- [x] 增加 DTO/route/allowlist/schema tests，并证明普通投影不读取 Manifest/Action/terminal Evidence；
- [x] 增加匿名 trace、Core phase、Main roundtrip/payload bytes 日志。

## Checkpoint 2：Renderer

- [x] 点击、启动恢复、通知/成员返回复用 enter；普通 event/command refresh 使用 open；
- [x] meaningful paint 前只等待 projection，项目恢复、campViewed 与侧栏刷新移到后台；
- [x] 缓存和刷新保持 selection/Camp/high-water fence，并保留用户主动加载的 earlier messages；
- [x] cache miss 在投影返回前保留当前工作区，成功后原子提交目标 Camp/项目；移除整页打开占位，
  仅对超过 400 ms 的请求在目标侧栏行显示非阻塞进度；
- [x] 加入更早消息 Partial/Loading/Error 控件与 prepend scroll preservation；
- [x] 普通 Renderer 路径零 `camps.snapshot`。

## Checkpoint 3：验证与发布

- [x] Core/Renderer 定向与完整测试、Rust format/Clippy、typecheck、Desktop build 通过；
- [x] Impeccable detector 与 desktop/minimum-width UI 验收通过；
- [x] 验证普通无缓存点击在投影返回前不改变当前一级 surface，快速 A→B 与离开页面均由 generation fence
  阻止旧响应提交；
- [x] 相同数据库副本记录 Camp open after payload/duration，并与基线对比；
- [x] 文档治理与 diff gate 通过；
- [x] 打包、隔离 userData smoke、替换 `/Applications/Rovai AI.app` 并验证日常数据冷/热打开；
- [x] 回填最终数值、剩余瓶颈和测试证据后才标记 complete。
