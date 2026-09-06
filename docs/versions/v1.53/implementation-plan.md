---
document_type: implementation-plan
version: v1.53
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-06
---

# v1.53 实施与验收

## 实施范围

- [x] 增加严格 structured/text 网络 classifier，并显式排除鉴权、权限、配额、模型、配置、取消、限流和服务端错误。
- [x] 增加 Core generation-local queue、固定退避、attempt-end 计时、重复 signal 合并与 in-flight singleflight。
- [x] 在 ACP failed terminal 的 `not_accepted` seam 于普通终态前登记恢复，并先完成旧 Prompt route/Host 可见性清理。
- [x] 增加 system-only mark/arm/complete 命令，复用正式 Scheduler/Fleet，并重验 version/epoch/取消/预算/成员/授权/
  Delivery/Approval/Action/Runtime Delivery。
- [x] 只在新 epoch 的 Runtime Input accepted 后清除网络提示；再次网络失败沿同一 Run 推进下一档。
- [x] Renderer `online` 与 Electron system resume 只调用 wake；Core 后台独立工作，无项不轮询。
- [x] planned/unplanned shutdown 停止协调器；Core restart 把 durable live marker 归一到既有 startup recovery。
- [x] 增加 Renderer/共享 presentation 的等待、恢复、需处理文案，blocked 不显示 spinner 且保留 Run Stop。
- [x] 增加固定时钟、分类、queue、领域 fence、ACK、restart、ACP ingress、Core allowlist 与 Renderer 回归。
- [ ] 使用隔离 App data/workspace 完成一条真实 Runtime 原生自恢复与一条 ACP terminal 后 Rovai 接管的无副作用验收。

## 自动化验收重点

- interval 精确为 `1, 2, 3, 5, 10, 15, 30, 30...`，零耗时累计点为
  `1, 3, 6, 11, 21, 36, 66, 96...`；第二档从第一 attempt 完成时起算；
- online/resume 提前 wake 只使待检查项到期；同一故障周期至多消费一次提示，重复 signal 与同时到期不形成并行
  attempt，也不能逐档绕过 backoff；
- structured `ECONNRESET/EAI_AGAIN/ETIMEDOUT` 等准入，generic request failure、证书错误、HTTP 5xx、鉴权、配额、
  限流、模型、配置和取消不准入；
- ACP 只有 failed + `not_accepted` + network evidence 在 terminal settlement 前转为等待；accepted/unknown 不重放；
- attempt 只通过正式 claim 增加 epoch，Input ACK 前不清除提示，ACK 后不遗留 queue；旧 epoch、取消、期限和安全条件
  变化不能再 dispatch；
- network-blocked 显示“需要处理”且没有 spinner，Run Stop 仍可用；页面切换、无 online signal 时 Core timer 仍独立；
- shutdown 清空 process-local queue；启动不恢复 attempt/delay，只按现有 startup recovery 重新分类 durable Run。

## 必跑命令

```bash
cargo fmt --all -- --check
cargo test -p rovai-core network_recovery --lib
cargo test -p rovai-core core_restart_hands_live_network_wait_to_existing_startup_recovery --lib
cargo test -p rovai-core --bin rovai-core acp_rpc_error_keeps_only_a_bounded_structured_kind
cargo test -p rovai-core --bin rovai-core acp_prompt_failure_is_retryable_only_when_input_was_not_accepted
cargo test -p rovai-core --bin rovai-core runtime_probes_do_not_occupy_the_interactive_request_queue
cargo check -p rovai-core --bin rovai-core
pnpm typecheck
pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts apps/desktop/src/main/runtime-core-methods.test.ts
pnpm build:desktop
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<merge-base-with-main> pnpm docs:check:ci
git diff --check
```

真实 Runtime 双链路资格验收在普通 macOS 交互式终端运行：

```bash
pnpm accept:network-recovery
```

该入口只使用隔离 data/workspace，并在精确阶段提示操作者断开或恢复 Wi-Fi；它不会自行修改系统网络设置。
只有报告同时证明 Claude Code 原生自恢复与 OpenCode ACP terminal 后 Rovai 新 epoch 接管，才可勾选最后一项并把
本版本改为 `complete`。

## 当前验证记录

- `cargo fmt --all -- --check`、`cargo check -p rovai-core` 与网络恢复定向用例通过；Core binary 全量结果为
  `222 passed / 5 manual ignored`。Lib 全量为 `512 passed / 1 failed`，唯一失败是嵌套 macOS sandbox 下的
  `macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible`；同一能力的 Electron sandbox gate
  在 `pnpm test` 中通过。
- `pnpm typecheck`、Desktop build、两份定向 Vitest（165 个用例）以及 `pnpm test` 全量通过；全量包括 154 个
  Vitest 文件／1567 个用例和 Node 220 个通过／1 个 Windows-only skip。Impeccable detector 无命中。
- `pnpm docs:test`（9 个用例）、`pnpm docs:check`、以基线 `91af2eeebd7ebfb581820c2f68d259ff51497199`
  执行的 `docs:check:ci` 与 `git diff --check` 通过。
- `smoke:recovery` 的临时目录已改为先 canonicalize，避免 macOS `/var` 别名触发 Runtime Files Root 所有权拒绝；
  随后 OpenCode 1.18.20 与 Codex 的隔离运行均未取得 Product Runtime resolution。额外隔离 inventory 显示本 Native
  Session 子进程中的已发现 CLI 全部以 `runtime_version_failed` 收口，未进入模型执行阶段；临时数据已清理。
  真实 Runtime 原生自恢复与 ACP terminal 后 Rovai 接管两链路仍未验收；完成前不得把任何 Adapter/平台的新网络
  恢复 qualification 记为已实证。
