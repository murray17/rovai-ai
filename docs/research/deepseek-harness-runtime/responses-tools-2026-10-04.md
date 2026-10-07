---
document_type: research-note
authority: non-normative
last_updated: 2026-10-04
---

# DSH Responses 工具参数兼容

## 问题与来源

macOS arm64、DSH `0.1.5-rc.3`、sub2api / `gpt-6.1-sol` 的真实调用出现
`invalid justification: expected a non-empty sentence`。模型给 shell 传入空的可选理由，
DSH 原生校验在执行前拒绝。10 月 3 日验收数据库已有同样错误；当时只完成
[用量采集核验](../runtime-monitoring/missing-fields-verification-2026-10-03.md)，工具健康性没有闭合。

本机官方安装包提供以下证据，不以自定义模型名称推测 tokenizer、权限或协议：

- `@earendil-works/pi-ai/dist/api/openai-responses.js` 的 `getCompat()` 对未指定的
  `supportsStrictMode` 使用 `false`，工具转换因此省略 `strict`。
- 同包 `openai-responses-shared.js` 的 `convertResponsesTools()` 在允许发送该字段时，
  普通工具默认发送 `strict: false`，保留原来的必填列表。
- `@deepseek-ai/dsh-llm-pi-ai` 原生 Provider 与 Model compat 均支持该开关。
- `@deepseek-ai/dsh-sandbox` 的 `validateEscalationArgs()` 明确拒绝空理由。

开发包中仅增加原生 `supportsStrictMode: true` 后，真实同次 Run 的两次 shell 与公开发送成功。
这证明该组合的修复效果；没有据此宣称已经抓取并证明 sub2api 服务端内部的 schema 转换过程。

## 实现范围

`dsh.rs` 读取现有原生 Home 的 `settings.yaml`，仅为显式 `api: openai-responses` 且未声明
该开关的路由生成 Host composition 默认值。使用官方 `llm-pi-ai` entry 的 patch，不修改原生包。
原生 settings 的 Provider / Model 显式值继续由 DSH 合并；其他协议不投影。
只复制路由名和一个布尔值，原生配置全文、endpoint、headers、模型列表与凭据不进入 Host patch。
设置文件不改写；YAML 错误不回显原始 scalar。Bootstrap revision 更新以失效旧 Host 配置。

自动默认值的来源是标准 `settings.yaml`。仅在自定义 composition 中声明的路由或自定义 settings
文件路径不由此 reader 推测；这些入口仍可使用 DSH 原生 compat 配置。没有增加精确版本白名单，
产品原有 ACP 最低版本不变。

## 确定性验证

`node scripts/smoke-dsh-responses-tools.mjs` 使用新构建 Core/CLI、已安装 DSH、全新隔离
data/Skills/MCP/DSH Home 和本机受控 Responses 服务。没有远端模型或真实凭据。

| 输入 | 实际请求 | 原生 shell 结果 | 文件副作用 |
| --- | --- | --- | --- |
| 未声明 compat | `strict: false`，justification 仍可选 | 成功 | 标记写入 |
| Model 显式 false | 省略 strict | 成功 | 标记写入 |
| Provider 显式 false | 省略 strict | 成功 | 标记写入 |
| 默认兼容值，但强行传入空理由 | `strict: false` | 原生拒绝 invalid justification | 无文件 |

四个场景各两次请求，原生 settings 字节不变。该受控服务不模拟模型能力，不能替代真实模型调用。
新增 Rust owner 验证配置投影与脱敏，既有权限 owner 继续验证六种原生权限组合。

复现命令：

```sh
cargo test -p rovai-core --lib dsh::tests::
cargo build -p rovai-core --bins
node scripts/smoke-dsh-responses-tools.mjs
node --test scripts/lib/dsh-host.test.mjs
```

本次 DSH 定向 5 项、Bootstrap 2 项、默认 Rust workspace 453 项通过（1 项既有忽略）。
`pnpm typecheck`、`pnpm test`、Rust fmt 与 diff-aware 文档门禁通过；Vitest 2,586 项通过，
Node 聚合层 334 项通过、2 项平台跳过。全量门禁发现并在未修改的 main 复现了
`create-configured-camp.test.mjs` 仍使用旧 Camp RPC 名称；该夹具已跟随现有 Thread 请求与消息回执更新，
未改变会话创建或发送的生产行为。

## 新构建真实 sub2api 复验

新构建 Core/CLI 使用全新隔离 data/Skills/MCP/DSH Home。从已授权开发配置读取 sub2api 路由，
特意移除 Provider 与 Model 的 `supportsStrictMode`，验证生产代码自动投影；凭据只进入子进程环境。

| 项目 | 同次证据 |
| --- | --- |
| Runtime / Provider / Model | DSH 0.1.5-rc.3 / sub2api / gpt-6.1-sol，high |
| Run | `b7ad2ded-3ebb-4104-82e0-3a3e567f3b73` |
| 开始 / 结束（UTC） | 2026-10-04 13:51:25 / 13:51:52 |
| shell | 两次 completed，实际标记文件内容逐字核对通过 |
| 公开发送 | 一次 Built-in completed，消息精确为 `DSH_SUB2API_MAIN_FIX_OK` |
| 失败 / 重试 | 无失败工具结果；未重跑该真实回合 |
| 原生配置 | 兼容开关原本缺失，调用后 settings 字节不变 |

这次同时验证工具结果和实际副作用，未以 Run succeeded 代替工具成功。不扩大为其他 Provider、
其他平台或全部 DSH 版本的真实模型验收。日常 App 与用户数据库未修改。
