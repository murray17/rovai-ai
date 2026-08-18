---
document_type: implementation-plan
version: v0.20
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-29
---

# Rovai-ai v0.20 实施计划与验收清单

> 状态：完成（2026-07-29）
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0066](decisions.md#adr-0066)

`[x]` 只表示已有代码、Migration、自动测试或可复现验收证据。实施过程中不得为了勾选
检查点而降低 Adapter 的认证、精确 MCP、权限或冻结边界。

## 检查点 1：Contracts 与干净 Runtime schema

- [x] 拆分 Catalog、Discovery Observation、Product Availability、Capability Snapshot
  和 Probe Attempt 合同。
- [x] AgentProfile 持久化 Product Runtime Selection，允许 unresolved 且禁止回退。
- [x] 每个 `(AdapterKind, authScope)` 唯一 managed default；高级 custom 独立。
- [x] 最近成功快照、最近尝试、刷新退避与 relocation audit 分表或等价规范化持久化。
- [x] 不实现旧 Runtime preference、重复 Installation 或混合 snapshot 数据兼容。

## 检查点 2：启动搜索环境与快速发现

- [x] 在 Tokio 前构建 Runtime Search Environment，不修改进程全局 PATH。
- [x] 自动 login shell 读取满足三秒、无 TTY、只提取 PATH、有界输出和进程树终止。
- [x] 合并并保留 env、继承 PATH、login shell 和 macOS known-location 来源。
- [x] 九个 Adapter 并行快速发现，先发布 path/fingerprint，再执行最多两秒版本命令。
- [x] Core ready 不等待发现；首页无 Toast；Renderer 可订阅逐项 observation。
- [x] 显式重新检测可以读取 interactive login shell，且 UI 解释会执行 Shell 初始化。

## 检查点 3：按需深度探测、刷新与自动迁移

- [x] 未登记候选默认不深度探测；成员页加载不触发 CLI Session。
- [x] 选择、显式检查、已登记 refresh 和 Run 准入按条件触发单项 probe。
- [x] 24 小时软刷新保留成功快照；失败不重置成功时间并应用内部退避。
- [x] 暂时失败与硬身份/安全失败按 ADR-0066 分类并有自动测试。
- [x] 路径缺失后按同 Adapter 优先级逐个探测，成功才原子更新同一 Installation ID。
- [x] 迁移失败保留 Installation，成功/失败均写不含秘密的审计证据。

## 检查点 4：成员解析、Run 准入与 Session 恢复

- [x] 未安装 Runtime 仍可保存选择，模型和权限在真实快照前保持 pending。
- [x] 首次成功 probe 自动创建/复用 managed default 并解析所有匹配成员。
- [x] 只自动采用 runtime default model 和审核过的安全权限默认值。
- [x] Runtime Resolution Job 与 Pending Execution Intent 去重、持久、可恢复、可取消。
- [x] 解析成功后才原子创建消息、CampTurn、AgentRun 和冻结配置；失败不留下公开事实。
- [x] 已冻结 Run 永不随 Installation relocation 改写。
- [x] Session compatibility key 与一次 pre-input controlled resume 覆盖成功、明确失败、
  timeout、含糊结果和迟到事件 fencing。

## 检查点 5：Desktop 产品体验

- [x] 成员页固定显示九种 Product Runtime，只选择产品，不展示路径。
- [x] 状态区分 Product Availability 与成员 Readiness，成功文案统一为“已就绪”。
- [x] Runtime 设置页提供检查、重新检测、安装说明，不自动深探测全部未登记项。
- [x] 高级诊断展示路径、来源、fingerprint、探测、退避与迁移审计。
- [x] 自定义 wrapper 只在高级入口出现，并与 managed default 明确区分。
- [x] Day/Night、窄宽窗口、键盘和屏幕阅读语义通过 Renderer 验收。

## 检查点 6：自动验证与 macOS 验收

- [x] Rust 单元/集成测试覆盖搜索来源优先级、Shell timeout、发现与 probe 分层、刷新分类、
  relocation transaction、pending intent 和 session fence。
- [x] TypeScript 测试覆盖九项固定目录、未解析选择、状态文案和无路径普通 UI。
- [x] `cargo fmt --all --check` 与 `cargo test --workspace`。
- [x] `pnpm typecheck`、`pnpm test` 与 `pnpm build:desktop`。
- [x] `pnpm package:mac`，检查包内 release Core、签名和启动后的九项渐进发现。
- [x] 文档按最终代码和可复现测试证据更新为完成，不提前固化测试数量。

## 验收证据（2026-07-29）

- `cargo fmt --all --check` 与
  `cargo clippy --workspace --all-targets -- -D warnings` 通过。
- `cargo test --workspace` 通过 249 项自动测试；另有 5 项需要真实上游账号和本机
  Runtime 的显式人工 smoke，保持 `ignored`，不属于本版本自动验收门。
- `pnpm typecheck`、`pnpm test -- --run` 和 `pnpm build:desktop` 通过；Renderer/Main IPC
  共 21 个测试文件、103 项测试。
- `pnpm smoke:core` 与 `pnpm smoke:member-config` 通过；后者验证未安装 Qoder 选择跨重启
  保持 `selected_unresolved`，且没有 Runtime fallback。
- `pnpm accept:member-lifecycle-ui` 与 `pnpm accept:member-avatar-ui` 使用隔离数据目录运行
  签名 App 通过；覆盖 Day/Night、1440×920/1040×700、键盘焦点、九项 Runtime 设置、
  普通流程无路径选择和跨重启状态。
- `pnpm package:mac` 生成 `dist/mac-arm64/Rovai-ai.app`；App 与包内 release Core 均为
  arm64，`codesign --verify --deep --strict` 通过。
- 直接启动包内 Core 时，首次 `health.check` 仍包含 `detecting`，证明 Core Ready 未等待
  discovery；随后九项目录全部收敛，login-shell PATH 状态为 `captured`。
- `scripts/*.mjs` 全部通过 `node --check`，旧的路径型 Runtime 验收夹具已迁移到 v31
  干净 schema。

## 明确排除

- Windows/Linux 桌面交付和 shim 执行；
- 动态第三方 Adapter 插件；
- 未接入兼容性候选进入 Product Runtime Catalog；
- 普通成员流程中的路径选择；
- 旧 Runtime 数据兼容迁移。
