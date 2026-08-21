---
document_type: implementation-plan
version: v1.22
authority: implementation-and-acceptance-status
status: implemented
last_updated: 2026-08-21
---

# v1.22 Runtime Probe 更新容错实施与验收计划

## 1. 版本与长期权威

- [x] 冻结 v1.21，建立唯一 current v1.22；
- [x] 记录 bounded Probe supersession、一次重新绑定与 LKG/Ready 分离决定；
- [x] 建立 Runtime Launch and Verification v17，并同步 Architecture、基础不变量和文档路由；
- [x] 明确不增加 Migration、完整 identity lease、数据库 CAS、Adapter 特判或模型上下文 revision。

## 2. Runtime Check Manager

- [x] 完整 Deep Probe 前后复核 executable file identity，覆盖成功、直接错误和 cleanup timeout；
- [x] 首次 Superseded 在原 attempt/deadline 内重新绑定 path/fingerprint 并最多重试一次；
- [x] 统一内部 `Ready | StableFailure | Superseded` outcome，Superseded 不写 failure/diagnostic/attempt；
- [x] Catalog/User Check 投影 deferred，Execution 保持 blocked 且不结算 Runtime failure。

## 3. Snapshot 与模型目录

- [x] fingerprint 变化时提交当前静态 snapshot，立即撤销旧 Ready/capability/auth/permission evidence；
- [x] 仅保留最后成功 models 与原 `lastSuccessfulProbeAt`，在原 24 小时窗口内投影 stale LKG；
- [x] expired 不再服务 LKG，当前 fingerprint 未 Ready 时 Scheduler 继续要求 Dispatch Preflight；
- [x] 公开 `lastProbeAttempt` 过滤旧 fingerprint，历史 attempt 不删除。

## 4. 回归与交付

- [x] 覆盖一次更新后成功、一次更新后稳定失败、更新持有 stdout、稳定 cleanup timeout 与两次更新；
- [x] 覆盖旧 Ready/LKG 分离、TTL 不延长和旧 fingerprint attempt 过滤；
- [x] 运行 Rust fmt、Clippy、定向/slow 测试、TypeScript/Vitest 与文档门禁；相关新增与受影响测试通过；
- [ ] 记录最终提交、主线同步和打包/安装事实；未执行的交付不得标记完成。

## 5. 验证结论

- `cargo clippy --workspace --all-targets -- -D warnings`、Core/AgentProfile 定向回归、20 个 CLI 测试、
  273 个 slow 测试、TypeScript typecheck、71 个 Vitest 文件/485 个测试和 `pnpm test` 的其余门禁通过；
- 全量 lib 的既有 Runtime compatibility frozen digest 断言仍失败；本版未修改该寄存器或
  `docs/runtime-compatibility.md`；
- 全量 `rovai-core` binary 的 5 个 ACP fixture 仍因缺少 Built-in Tool Run tmp 失败；已在未修改的
  `origin/main` 基线提交复现，v1.22 新增和受影响测试均通过；
- 真实 Runtime smoke、主线同步和 App 打包/安装不在本轮已执行事实中。

## References

- [v1.22 版本概览](README.md)
- [V1.22-D01](decisions.md#v1-22-d01)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
