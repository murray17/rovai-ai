---
document_type: model-context-change
version: v1.72
authority: model-input-change-proposal
change_id: reference-projection-simplification
revision: 1
confirmation_status: confirmed
confirmed_by: User
confirmed_at: 2026-11-08T13:56:07Z
confirmed_revision: 1
confirmation_message_id: 26011e50-403b-4f3a-a6e7-37e7614b5991
implementation_status: implemented
last_updated: 2026-11-08
base_commit: cab7f7788eddaad3308a9d5574de649ecb1ae6e5
---

# 引用正文精简 R1

User sequence 51 提供完整前后方案，sequence 53 明确未上线功能不做版本或兼容处理，sequence 55
明确“改吧，简单做，千万不能做复杂”。本记录对应这个已收敛范围；confirmed_at 是登记时间。

## 变更前

文件和目录正文标签包含完整相对路径，目录标签另加 /；文件、目录、对话和使命的标签转义所有 ASCII 标点。
例如 messages[*].body 中：

```text
检查 [src\/auth\/login\.ts](file:///workspace/src/auth/login.ts) 和 [src\/auth\/](file:///workspace/src/auth/)。
对照 [登录\-重构 v1\.2](rovai://thread/rvth_01k5c9m7x2q4r6s8t0v2w4y6z8)。
```

## 变更后

```text
检查 [login.ts](file:///workspace/src/auth/login.ts) 和 [auth](file:///workspace/src/auth/)。
对照 [登录-重构 v1.2](rovai://thread/rvth_01k5c9m7x2q4r6s8t0v2w4y6z8)。
```

只改变现有 messages[*].body／正文投影的字符串，不增加、删除或重排消息字段。
文件与目录从保存的相对路径取最后名称；目录标签无 /，目录 URI 保持末尾 /，目标 URI 编码保持。
对话和使命保留完整标题及目标 ID，不取 basename。
标签仅保护 Markdown/GFM 中可改变文字或结构的 `\ [] * _ ~ < & |` 及反引号；点号、短横线、括号等保持原样。
两端共用同一组输入输出样例。调用方原有控制字符和标题空白处理保持，URI 编码不与标签转义混用。
新生成的 Markdown 导出复用同一正文投影，保留结构化引用的链接目标；HTML/PNG 继续静态展示。

## 明确不变

草稿仍为 ComposerDocument v2，Atom 完整 shape 为
`{type:'project_file_reference',threadId,rawReference,labelFallback,targetKind?:'file'|'directory'}`；
正式段仍为 `{kind:'project_file_reference',threadId,rawReference,pathAtSend,labelAtSend,targetKind?:'file'|'directory'}`。
字段含义、封闭校验、完整路径、类型、身份、同名界面消歧、权限、有效根、发送保护和失败留稿保持。
不增加 files/references 数组、附件、目录内容注入、搜索算法或设置。
4096 段、1 MiB 可变内容／实际正文预算和 32 个不同项目条目保持。

按 User sequence 53，直接修改未上线功能的当前投影与测试；不增加旧投影、格式路由、迁移或兼容分支，
不批量改写数据库。数据库 schema、Host 协议、formatter/manifest、profile、Bootstrap 与 Charter 版本全部保持。

详情弹层继续复用：正常状态只有打开、重选、移除；错误时提供适用的重试。目录使用目录图标和“打开目录”。
业务不可用、网络与协议异常仍分别处理，不把网络失败说成文件删除。

## 二次确认

确认 revision 1 为上述三类改动及 sequence 53 的版本／兼容范围。实施授权为 User sequence 55，
不是从旧的文件或目录功能确认中推定，也不加入新的确认步骤。

## 验证

扩展既有 Core/Renderer owner：共享转义样例、长路径短标签、目录 URI、特殊字符、同名目标的不同 URI、
复制与恢复保留身份；用生产 Markdown/GFM 解析验证恰好一个正确链接与原名称。
复用正式 Desktop／认证 Web 验收，检查目录详情动作、正常无重试、错误可重试、焦点与复制。
真实读取沿用现有同名和特殊路径任务，不新增兼容矩阵、性能框架或平台资格测试。
PR/实施结果记录实际命令与通过、失败和未测范围。

### 实际结果

- `pnpm typecheck` 通过；`TZ=UTC pnpm exec vitest run --maxWorkers=4`：274 文件、3187 项通过，2 项原有跳过。
- `cargo test --workspace --jobs 4 -- --test-threads=4`：484 项通过，1 项原有忽略；
  extended-tests 下现有 `camp_content::` 16 项、`thread_reference::` 1 项通过，共用 15 组标签样例。
- `pnpm test:message-export-ui` 三组通过：Markdown 保留结构化引用目标，HTML/PNG 及回复摘要仍静态展示；
  原有代码围栏、网页链接、图片、窄屏与完整会话导出检查通过。
- `CARGO_BUILD_JOBS=4 pnpm package:mac:daily` 完成 arm64 ad-hoc 验签；
  `node scripts/accept-project-file-references.mjs --packaged` 的 Desktop／认证 Web 25 项通过。
  [界面结果](reference-projection-simplification-ui-evidence.json)包含正常文件/目录菜单、目录消息结构化复制、
  失效/协议错误与重试、迟到响应不能清除发送拒绝、草稿恢复、键盘、输入法、触屏和日夜窄屏。
- [真实读取证据](reference-projection-simplification-evidence.json)：Codex CLI 与 Claude Code 各运行同名文件、
  同名目录任务，共 4 项通过。实际冻结输入只有短标签与完整定位；运行时读取选中目标的随机值，未误读另一同名目标。
  文件内容不注入输入。Core 投影测试源为 `6ffc92493`，后续仅补导出、验收和文档，没有改写该投影。
- `pnpm docs:test` 10 项通过。本地主 checkout 的通用链接检查受原有未跟踪 `docs/prototypes` 中的失效链接影响；
  未移动或修改这些原型，也未增加 checker 例外。PR 的干净 checkout 继续执行通用文档门禁。

真实 Runtime 本轮只重跑与短标签定位直接相关的同名文件／目录任务；特殊字符由共享 TS/Rust 样例与
生产 Markdown/GFM 解析覆盖，没有重跑全运行时特殊路径、工作树资格或性能矩阵。
没有升级数据库、Host、输入格式或 Charter，没有迁移、历史改写或新增兼容分支。
