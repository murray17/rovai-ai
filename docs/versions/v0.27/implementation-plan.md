---
document_type: implementation-plan
version: v0.27
authority: implementation-status
status: complete
last_updated: 2026-07-31
---

# v0.27 实施与验收

共同理解、领域语言和跨版本决策已经确认，生产实现按以下清单推进。

## 设计门禁

- [x] 完成逐项需求拷问并由用户确认共同理解。
- [x] 更新 `CONTEXT.md` 中的伙伴身份通用语言。
- [x] 接受 ADR-0085 与 ADR-0086，并维护被局部替代的旧 ADR 与索引。
- [x] 冻结字段、Migration、Session Charter、Memory 和 UI 生产设计。

## 生产实施

- [x] 更新 Contracts、Core AgentProfile、SQLite Migration 与默认 seed。
- [x] 将本机确认的四组半身图和圆形 icon 纳入受控内置资源。
- [x] 直接替换唯一一套内置素材并删除旧图、旧预设和无使用者兼容分支，不建立
  `v1`/`v2` 并存。
- [x] 更新四个内置队员默认身份，保持工作准则与成长课题为空。
- [x] 按 Arctic Dawn V3 更新队员详情、创建与编辑身份交互。
- [x] 从 Session Charter 移出可编辑身份，增加每 Run 冻结的必需 `MEMBER_IDENTITY`
  投影，并保持身份编辑不轮换已有 Native Session。
- [x] 删除旧字段、文案、兼容壳和无使用者测试。

## 自动化与真实验收

- [x] Core Migration、命令、冻结、恢复和 Memory 边界测试通过。
- [x] Renderer 字段、标签、高级设置展开与计数、草稿、错误和无障碍测试通过。
- [x] Typecheck、Renderer 测试、Core 测试、Clippy 与桌面构建通过。
- [x] 打包 App 在 `1440×920` 与 `1040×700` 完成真实交互和截图验收。
- [x] 内置半身图与 icon rendition、升级重置、重启持久化和正在运行任务不受影响均有证据。

## 验收证据

- `cargo test --workspace`：Core 库 221 项、主程序 46 项测试通过，5 项真实 Runtime 手动
  测试按设计忽略；专项覆盖 v42 直接切换、旧/缺失身份协议拒绝、活跃 Run 身份冻结、
  Native Session 不轮换与同 Camp 私有字段不可见。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm typecheck`、`pnpm test`、`pnpm build`：通过；Renderer 25 个测试文件、144 项测试
  通过，release Core 与 Electron Renderer 构建成功。
- `pnpm smoke:member-config`：严格六字段 RPC、命令重放、重启持久化与 Runtime 独立配置
  通过。
- `node scripts/accept-member-lifecycle-ui.mjs dist/mac-arm64/Rovai-ai.app`：成员生命周期、
  Runtime 独立保存、主题/窗口矩阵与无横向溢出通过。
- `node scripts/accept-member-avatar-ui.mjs dist/mac-arm64/Rovai-ai.app`：唯一内置图片集、
  身份/图片独立保存、managed 图片重启与受控降级通过。
- 使用隔离用户目录对打包 App 做 `1440×920` 与 `1040×700` 真实交互：六字段顺序、
  标签的回车/中英文逗号提交、300 字越界聚焦、高级区默认展开和 0/1/2 状态、Escape
  丢弃草稿以及身份/图片/记忆独立保存均通过。
- 对本机 schema v41 数据库的一致性副本执行 v42：四个 canonical Profile 得到精确默认
  配置，自建 Profile 五个新增字段为空，旧列不存在，外键检查为零；原数据库保持 v41，
  未被验收过程修改。
