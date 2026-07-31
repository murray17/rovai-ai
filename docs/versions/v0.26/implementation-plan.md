---
document_type: implementation-plan
version: v0.26
authority: implementation-status
status: complete
last_updated: 2026-07-31
---

# v0.26 实施与验收

## 文档与领域

- [x] ADR-0082 冻结队员运行配置、默认值、漂移和无兼容重置边界。
- [x] ADR-0083 冻结 Runtime 后台检查、缓存消费、保存与用户状态投影边界。
- [x] ADR-0084 冻结 Inspector 本机偏好、停止事件投影、正文复制和共享顶栏边界。
- [x] `CONTEXT.md` 定义 Runtime Default/Explicit Model Selection 和 Member Runtime
  Configuration。
- [x] Arctic Dawn 队员规范增加“运行参数”折叠区。

## Core 与持久化

- [x] v41 Migration 清空全部队员 Runtime 选择、模型和权限参数。
- [x] 原子保存命令支持完整配置与未就绪 `AdapterKind` 例外。
- [x] 停止 snapshot/Installation 后台自动补齐队员配置。
- [x] Core 为九种 Adapter 提供明确的最宽松队员权限默认值。
- [x] 保存和 Readiness 使用当前模型、option、权限 schema 与原生值校验。
- [x] AgentRun 继续冻结配置，Host/Session 差异沿用 ADR-0007 惰性交接。
- [x] Core 使用按 Product Runtime 去重的后台队列处理启动发现、后续发现、队员切换、
  24 小时过期、显式检查和文件身份变化。
- [x] 队员保存只在缓存 Snapshot 上事务校验；不再等待 Discovery、深度探测或完整哈希。
- [x] 后台刷新保留仍可用的最近成功结果，硬失效继续阻止新 Run。

## Renderer

- [x] “运行配置”下增加默认收起的“运行参数”。
- [x] 队员运行配置只保留“保存运行时”；空选择通过同一按钮清除配置。
- [x] 保存期间按钮显示“正在保存…”，完成后恢复并显示成功 Toast。
- [x] Runtime 保存后的 Skill 投影由 Core 后台通知执行，不阻塞保存响应。
- [x] 九种 Runtime 使用专用字段组件和原生序列化。
- [x] `runtime_default` 隐藏模型与模型参数；固定模型按 snapshot 渲染。
- [x] Copilot `allow_all` 与 Antigravity `dangerously_skip_permissions` 使用开关。
- [x] 切换 Runtime 只重置本地草稿；原子保存失败保留草稿。
- [x] 普通队员页不显示 Installation、路径、fingerprint、auth scope 或探测详情。
- [x] Runtime 选项不堆叠内部状态；摘要只显示一个可操作主状态、版本与必要修复入口。
- [x] 删除队员区顶部 Readiness 警告和“正在检查并保存”提交文案。
- [x] 配置页打开读取缓存并按需 `ensure`，切换 Runtime 只异步排队检查。
- [x] Inspector 默认展开、可完整隐藏并记忆；Header 状态摘要可恢复并打开目标页签。
- [x] 终态取消按 CampTurn 投影唯一停止事件，未确认效果链接到 Inspector Activity。
- [x] 复制入口位于正文下方；时间线与 Composer 在 Inspector 两种状态下保持同轴。
- [x] 队员与记忆页复用 50px 可拖拽 AppHeader，不覆盖现有 Workbench。

## 自动化验收

- [x] `cargo fmt --all -- --check`
- [x] `cargo test -p rovai-core`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm build`
- [x] `pnpm package:mac`

## 真实交互检查

- [x] Runtime 未就绪时可以保存选择，但参数保持未配置。
- [x] Runtime 就绪后必须显式保存完整参数才 Ready。
- [x] 九种 Runtime 默认值、字段名和开关值与 ADR-0082 一致。
- [x] 固定模型切换会重建该模型 option 草稿；跟随默认不保存 options。
- [x] 能力漂移显示 `needs_attention`，不会静默重置。
- [x] 缓存可用且后台刷新时主状态保持“可用”；缺少证据时显示“正在检查…”。
- [x] 需要登录、未安装、版本不支持和暂时失败均显示唯一主状态及明确下一步。
- [x] Renderer 纯函数覆盖停止事件排序、耗时、一 Turn 一事件和未确认效果聚合。
- [x] 静态渲染覆盖 Inspector 显示/隐藏、正文复制结构、Header 路由控件与共享顶栏。
- [x] 本地 arm64 App 能启动并打开队员页，折叠、编辑、保存和错误状态可操作。

## 验收证据

- Core：218 个 library test 与 46 个 binary test 通过；5 个依赖真实外部 Runtime 的
  手工 smoke 按定义忽略。
- Renderer：25 个 test file、144 个测试通过，TypeScript typecheck 通过。
- `smoke:member-config` 验证未就绪选择、无 Runtime fallback 和重启持久化。
- 打包 App 的 `accept:member-lifecycle-ui` 验证 v41 全量清空、默认收起、Runtime
  切换重置、放弃草稿、固定模型 option、原生权限原子保存、正文复制、共享队员顶栏、
  重启和两个目标尺寸。
- 打包 App 的 Camp Inspector 验收覆盖 `1440×920` 与 `1040×700`：显示/隐藏偏好、
  Header 控件、Inspector 跨越 Composer、会话/输入同轴、正文复制层级及无横向溢出
  均通过。
- 打包 App 的 `accept:memory-ui` 验证共享记忆顶栏未破坏既有工作台、重启持久化、
  完整 Memory 生命周期、日间/夜间偏好路由和窄屏无横向溢出。
- `dist/mac-arm64/Rovai-ai.app` 已完成 arm64 目录打包并通过 `codesign --verify
  --deep --strict`；本地开发包为 ad-hoc 签名，未做 notarization。
