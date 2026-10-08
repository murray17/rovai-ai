---
document_type: implementation-plan
version: v1.72
status: implemented
last_updated: 2026-10-08
---

# 使命描述提及队员

User 已确认交互稿、内部稳定 ID 与模型读取 `@名字` 的分层，并授权实现、PR 与合并 main。
本记录覆盖 Mission v12；初始交互稿仍仅是本地评审素材，生产证据以本次代码及验证为准。

## 实现范围

- 描述保存有序 text/member_mention 片段；UI 编辑、阅读、搜索使用当前显示名，模型继续读取原有 description。
- 创建合并显式队伍和提及身份；编辑仅加入队外成员，保留队长及既有成员。描述与成员同事务提交。
- 复用 Composer 的 Atom、候选、剪贴板和键盘路径。使命只启用个人提及，普通 Enter 换行。
- 新建草稿、失败重试、版本冲突、取消邀请、失效身份、深浅主题保持现有表单的恢复与显示约束。
- 保存不启动执行；`mission get`、Bootstrap、RUN_INPUT、Run Facts、ContextManifest 的 shape/版本均未修改。

## 数据升级与证据

Migration 185：v1.72/schema 134 → 135。新增带 Mission 级联外键的 description 表；旧字符串按字面转为
文本片段，不解析其中的 @。旧消息、投递、成员、使命、附件及冻结上下文保留，不执行 clean break。
表、回执与 marker 原子写入；注入 receipt failure 时回滚三者，保留原证据摘要。旧来源继续通过现有
迁移链升级，184 的验收仍判断其拥有的 schema 134，随后才进入新迁移。

## 测试准入

- `mission_description::tests` 是最低成本的封闭结构/规范化 owner；新增广播、Skill、未知属性拒绝矩阵。
- `mission::tests::description_members_commit_together_preserve_identity_and_never_schedule` 进入 extended-tests。
  原使命测试不拥有多成员与正文同事务失败；数据库夹具证明写入中途故障后成员、版本和正文共同回滚，
  并覆盖失效身份、重复引用、重试回放、改名、纯文本替换、未启动执行及 Agent 输出不含结构化字段。
- `db::mission_description::tests` 进入 extended-tests，拥有本次新表/回执/marker 的升级和回滚；纯函数无法
  证明 SQLite DDL 与权威准入。既有 migration-state 矩阵继续验证新旧收据组合。
- 扩展既有 Mission board Electron fixture，使用生产组件和内存 API，覆盖候选选择、失败重试、保存入队与阅读。
  它不证明真实 Core 事务；该边界由上述 Rust owner 证明。无测试被退役或永久禁用。

最小 Core 命令：

```sh
cargo test -p rovai-core --features extended-tests --lib mission_description::
cargo test -p rovai-core --features extended-tests --lib description_members_commit_together_preserve_identity_and_never_schedule
```

合入 main 的 Pending 首消息邀请后，Mission 和 Pending 继续共享 `commit_camp_member_add`；Mission 复用
独立成员命令的完整准入。定向复跑两个原子提交 owner 和原有 generation/idempotency owner，均通过。

## 验证记录

- `pnpm typecheck`、`pnpm test` 通过：238 个 Vitest 文件、2,608 项测试；Node 检查 334 项通过、2 项平台跳过。
- `pnpm test:rust:pr` 通过：456 项通过、1 项既有忽略。Mission 扩展定向 26 项通过。
- `db::` 扩展矩阵 98 项通过；其余 2 项历史使命夹具按旧 schema 准备数据、完整升级后调用当前读取器，
  各自定向重跑通过。保留原有升级、回滚、记录保留及外键断言。
- `node --test scripts/lib/mission-board.test.mjs`：7 项通过；重复提及去重、取消全部引用、失败保留、重试入队、
  Enter 换行、保存不执行及阅读资料卡均取得浏览器证据。深浅主题截图已人工检查。
- `node --test scripts/lib/composer-invitations.test.mjs` 验证合入 main 后的 Pending/Active 会话邀请路径。
- `pnpm build:desktop`、`DOCS_BASE_REF=b4745527 pnpm docs:check:ci` 通过；`pnpm test` 已包含文档与 Skill 治理。

桌面验收使用隔离 userData 和内存 API；Core 使用临时 SQLite，不启动真实 Runtime，不升级日常 App 数据。
验收夹具同步当前 Thread API 与通知 schema 9；窄窗口回归同时修复最后状态列在滚动到底后被前列覆盖选中状态，
保留并稳定执行原有导航断言。
