---
document_type: implementation-verification
version: v1.72
source_version: v1.72
status: implemented
last_updated: 2026-10-04
---

# Claude Code / Codex 原生连接编辑验收

范围仅包含两种 Runtime。当前合同为 [Runtime Launch v47](../../contracts/runtime-launch-and-verification-v47.md)，
选择理由为 [V1.72-D12](decisions.md#v1-72-d12)。界面沿用既有启动设置，不引入探活或模型能力认证。

## 实施

- `runtime_custom_api/native` 读取实际配置目录、环境、原生凭据引用及模型投影；不复制 Key。
- `native_edit` 只更新被编辑的连接和模型字段，保留无关字段和 TOML 注释，以原子文件替换安装。
- `runtime_startup` 保存独立模式，用字段补丁合并并发修改，连接身份进入原有 Host／binding digest。
- Renderer 使用独立行 ID 保持 Codex 默认项和输入焦点，保留草稿及字段冲突处理；没有常驻重新读取。
- 官方登录操作说明使用“本机”，未登录／未确认与连接方式分开显示。

## 已执行证据

实测平台：macOS arm64；实际二进制 Claude Code **2.1.280**、Codex **0.159.2**。
自动验收目录为 `/tmp/rovai-native-api-accept-20261004-01`，独立 `user-data`、
`user-data/managed-skill-library` 与原生 Home。只使用固定假 Key 和 loopback HTTP 服务；没有真实中转凭据或计费调用。

| owner / 命令 | 验证内容 |
| --- | --- |
| `cargo test -p rovai-core --features extended-tests --lib runtime_custom_api` | URL/闭集、读取不写入、首次零保存、字段合并和真实冲突、无密钥回读/普通持久化、静态 Key 与地址变化、不可写 env 引用替换、原生未知字段/注释、版本摘要、旧快照拒绝及草稿内存凭据 |
| `cargo test -p rovai-core --features extended-tests --lib runtime_startup` | 普通启动环境校验、并发 Runtime overlay、父进程环境不被改写 |
| `cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests` | 草稿/正式检查共享环境、保存与旧探针竞争、读取失败不发布旧环境；3 项通过 |
| `cargo test -p rovai-core --features slow-tests --lib profile_and_installation_commands_are_idempotent_and_explicit` | 冻结连接身份、Key 修订和来源变化参与复用/恢复判断；保留旧快照及冻结时无覆盖的状态 |
| `vitest run .../runtime-startup-draft.test.ts .../interface-language-catalog.test.ts` | 模型 ID／默认项、保留/替换/清除、本地校验、英文目录；5 项通过 |
| `node --test scripts/lib/runtime-custom-api-ui.test.mjs` | 正式 React 组件的首次回显、空 Key、眼睛、失败保留、字段级冲突、外部变化合并、ID 清空重输/焦点/默认项、删除默认项、读取失败重试、日夜主题和窄屏 |
| `scripts/smoke-runtime-custom-api.py` + `custom_api_native_fixture` | 实际原生进程、本地 Responses/Messages SSE、原生目录加载、真实收到的路径/模型/认证头，以及新旧进程和会话恢复 |

原生服务端记录：Claude 收到 `/custom/prefix/v1/messages?beta=true`、`rovai-main`、指定 Bearer Key。
Codex 精确模型 `gpt-6.1-sol` 与未知模型 `rovai-unknown` 都进入目录并完成最小回复；随后新进程使用
`/custom/prefix/rotated/responses` 和新 Key，旧进程继续原地址和原 Key。新进程恢复持久线程后仍使用新连接。
记录只包含 keyMatches/keyVersion，不输出 Key；提示词固定为 `Reply OK.`，工作目录没有项目代码。
Claude 另以 shell-only Key 完成最小回复，确认不把环境凭据复制到文件。两种 CLI 都保留既有非认证请求头。
官方模式检查确认 API 地址、凭据和自定义模型覆盖停用，原生 API 配置字节保持不变；隔离环境没有账号，
不把此项作为真实 OAuth 登录成功证据。数据库提交失败的定向用例确认原生文件回退，不留下替换了一半的连接。

仓库门禁：`pnpm typecheck`、完整 `pnpm test`（236 个 Vitest 文件／2528 项，Node 328 passed／2 平台 skipped）、
`pnpm build:desktop`、默认 `pnpm test:rust:pr`（455 passed，1 既有 ignored）及
`pnpm docs:test`、`pnpm docs:check`、带基线的 `pnpm docs:check:ci` 已通过。
验收命令不向默认 workspace 强加 `CODEX_HOME` 或 `CLAUDE_CONFIG_DIR`，各 owner 使用自己的隔离目录；
统一覆盖会干扰原生 Skills 目录优先级用例，已恢复测试原有夹具边界。

重跑原生验收先构建 helper，并使用一个新的绝对隔离目录：

```bash
cargo build -p rovai-core --example custom_api_native_fixture
python3 scripts/smoke-runtime-custom-api.py --claude /absolute/claude --codex /absolute/codex --fixture-root /absolute/isolated-fixture
```

## 证据边界与限制

- 上述为实际 CLI 对本地假服务的配置交付实测，不是对真实中转的能力、工具或账号有效性证明。
- `ANTHROPIC_REASONING_MODEL` 的保存与进程注入可验证；目标 Claude 是否真正识别它不能由此推出。
- Codex 目录生成依据所选 0.159.2 二进制内嵌资源及对应原生 fallback。其他资源、版本或不可读取资源的包装程序
  需要 adapter 适配；原有原生配置无需先生成新目录即可读取复用。
- 未使用真实 OAuth 账号测试登录／刷新。原生账号路径和冲突隔离通过本地元数据处理，不新增 OAuth 生命周期。
  Codex auth.json 只存 API Key 而无法无损选择 OAuth 的情况明确拒绝切换，保留凭据。
- Claude 原生系统凭据未提供可只读确认的登录状态时显示“未确认”，不把没有 Key 显示为已登录。
- 原生辅助凭据／系统钥匙串继续交给 CLI 消费；未做真实系统凭据或刷新实测。API Key 与既有认证请求头冲突时
  明确报出原生来源，停止该连接，不自动改写请求头或尝试其他账号。非认证请求头按原配置保留。
- 只有官方 OAuth 登录不算已有 API Key。Codex 内置 provider 的系统凭据类型尚不能离线确定时，
  已有连接继续交给原生 CLI 使用；更换接口地址须输入新 Key 或先在原生配置绑定该地址，避免向新接口发送官方 token。
  普通文件／环境静态 Key 不受此限制，未改地址的模型编辑也不要求复制系统凭据。
- Windows、Linux 与其他 CLI 版本尚无此次新连接表单的真实运行验收；既有 Runtime 平台资格不构成此路径验证。
- 原生共享文件可能影响外部会话。保存成功不是热切换成功；来源变化后旧冻结执行重建／恢复明确要求重新连接。

## 测试准入与退役

`runtime_custom_api` 是原生配置/凭据边界 owner；扩展层使用隔离 SQLite 验证发布和兼容摘要，纯 parser 无法证明这一 seam。
同一修改退出四 Runtime 私存草稿及 Key GC 合同，对应旧测试由原生读取/字段写回/无副本测试替代；
URL 闭集、掩码、输出脱敏、权限、路径逃逸和不可变文件的有效边界保留。Kimi/Grok 新表单测试退出，原有 Adapter 测试保留。
原有原生 Smoke owner 收敛到两种 Runtime 并覆盖新来源，不增加在线服务的用户准入门槛。
