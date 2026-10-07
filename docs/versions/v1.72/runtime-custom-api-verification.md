---
document_type: implementation-verification
version: v1.72
source_version: v1.72
status: implemented
last_updated: 2026-10-06
---

# Claude Code / Codex 原生连接编辑验收

当前实现以 [Runtime Launch v48](../../contracts/runtime-launch-and-verification-v48.md) 和
[V1.72-D15](decisions.md#v1-72-d15) 为准：Rovai 只在保存时编辑原生连接；正常执行由原生 CLI 读取配置、认证及发送请求。
先前为永久保留两套连接引入的启动覆盖、临时 provider 和额外身份核对已退出，历史验收不能代表当前行为。
范围仅包含 Claude Code、Codex；不增加表单字段、账户系统、探活、能力认证或版本白名单。

## 实施结果

- `native` 读取实际配置目录、环境与原生凭据引用，只回显地址、模型和凭据状态；打开页面不写文件，也不复制 Key。
  本地原生配置决定当前连接方式，旧 `_connectionMode` 不再控制运行或界面。官方方式与是否已登录分别展示。
- Renderer 保留完整编辑草稿，单选项往返没有请求或写入；新 Key 仅在当前编辑会话内存中保留。
  没有其他修改时返回原选项即恢复干净状态；放弃更改恢复基线并丢弃新 Key。
- 保存提交按最终选项投影。官方选项只提交普通启动字段和必要的模式／连接修订保护；隐藏的地址、模型和 Key
  不进入校验、目录生成或写入。失败和冲突保留完整草稿；成功后重新读取原生结果并清理未提交的敏感输入。
- API 保存合并用户实际编辑的字段。已有原生模型条目、provider 查询参数、传输／重试／超时配置及未知字段保留；
  Codex 默认项绑定稳定行 ID，默认项变化不重建目录，名称修改不覆盖模型能力。继承默认模型不产生允许名单。
- 官方保存停用当前 API 路径。Claude 移除相关原生 API 字段，并按原生 `settings.env` 语义停用继承的 API 环境覆盖；
  官方 OAuth 令牌和其他设置保留，请求头只过滤 Authorization／X-Api-Key，保留跟踪及独立代理认证。Codex 在当前 profile／根配置选择内置 OpenAI，移除当前 API 默认模型和目录引用；
  只清理文件认证中的 API Key 字段及 API 选择标记，保留 OAuth token、未知字段和无关 provider。不承诺 API 凭据可恢复。
- 普通 Rovai 数据库不保存 Key 或第二份连接选择。Key 保持原生来源；用户替换才更新当前连接对应的原生来源。
  Claude 静态 Key 保持 X-Api-Key／Bearer 方式。Codex `auto` 仍由原生选择钥匙串及文件回退，不提升文件 Key 的优先级。
- 正常启动、原有检查与恢复不再生成同一连接的配置覆盖，也不增加 `get_settings`、`config/read` 或身份读取门槛。
  队员显式模型、推理强度、工作目录、工具、审批和沙箱保持既有集成；“运行时默认”交给原生配置。
- 当前连接及凭据摘要继续参与进程复用／恢复兼容性，未使用 provider 和无关 UI/MCP 内容不构成连接冲突。
  辅助读取失败不单独禁止执行；正常原生错误仍反馈。保存后的共享文件可能影响外部会话，不承诺热切换。
- 保留共享原生配置的影响范围说明；没有新增保存提示、确认弹窗、常驻重新读取或后台轮询。

## 本轮验证（2026-10-04／05）

自动验收在 macOS arm64。实际原生版本：Claude Code **2.1.280**、Codex **0.159.2**。
初轮原生夹具根目录 `/private/tmp/rovai-native-save-acceptance-20261004`，最终确认目录 `/private/tmp/rovai-native-save-final-20261005`。
隔离 HOME、配置、工作目录，固定假 Key 与 loopback 服务。
Electron 界面 owner 使用独立 `user-data` 和 `managed-skill-library`，以内存 RPC 夹具挂载正式 React 组件，不启动 Core。
没有读取或修改日常 Rovai 数据，没有发送真实中转或官方模型请求。

| owner / 命令 | 本轮覆盖 |
| --- | --- |
| `cargo test -p rovai-core --features slow-tests --lib runtime_custom_api::` | 原生读取不写入、字段合并／冲突、隐藏 API 输入隔离、官方保存、原生／数据库失败回退、OAuth 保留、无 Key 副本、连接修订、元数据保留与包装入口；既有 5 项 |
| `cargo test -p rovai-core --features slow-tests --lib runtime_startup::` | 普通启动环境规则、并发 overlay 与父进程环境隔离；既有 2 项 |
| `cargo test -p rovai-core --features slow-tests --lib application::runtime_check_environment::tests` | 草稿和正式检查环境、保存与旧检查竞争、读取失败不发布旧环境；既有 3 项 |
| `cargo test -p rovai-core --features slow-tests --lib profile_and_installation_commands_are_idempotent_and_explicit` | 冻结连接摘要与绑定兼容性，旧 UI 模式不接管原生执行；既有 1 项 |
| `vitest run .../runtime-startup-draft.test.ts` | 最终选项投影、隐藏无效输入、模式往返、稳定默认行、API 编辑遇到外部模式变更的保护；既有 3 项 |
| `node --test scripts/lib/runtime-custom-api-ui.test.mjs` | 正式组件的草稿往返、Key 内存／隐藏状态、放弃更改、失败／冲突保留、成功重置、原生读取失败重试、模型行、日夜主题及窄屏 |
| `scripts/smoke-runtime-custom-api.py` + `custom_api_native_fixture` | 保存后实际 CLI 直接读取原生连接，原生目录／配置加载、路径／模型／认证头、新旧进程、恢复及官方保存 |

默认 Rust workspace、完整 `pnpm test`、类型检查、桌面构建、格式及三项通用文档门禁均按仓库路由执行。
默认 Rust：455 passed／1 既有 ignored；JavaScript：237 个 Vitest 文件／2587 项、Node 334 passed／2 平台 skipped。
完整 suite 后的收尾变更再次运行对应 owner；没有把“0 tests”当成通过。

### 原生调用结果

- Claude 实际收到 `/custom/prefix/v1/messages?beta=true` 和 `rovai-main`。Bearer、X-Api-Key 替换以及只在环境中的 Key 均成功，
  路径前缀、原生附加请求头与模型设置保留。官方保存后原生 API 字段已移除或停用，假 OAuth 输入仍在；不是实际订阅调用。
- Codex 模型 `gpt-6.1-sol` 与未知 ID `rovai-unknown` 均能由完整原生目录加载并调用。首次继承默认 A 不阻止显式 B。
  已有条目的 8192 上下文、纯文本输入、关闭 reasoning summary 与未知字段，在名称编辑后保留。
- Codex 原生 provider 的 `api-version=fixture-v1` 查询参数、传输／重试／超时字段保留。地址／Key 轮换后新进程使用
  `/custom/prefix/rotated/responses` 和新 Key，旧进程仍持原连接；新进程恢复线程时使用新原生连接。
  运行参数不再传入重建的 provider 或目录覆盖，也没有生成临时连接文件。
- Codex `auto` 文件回退实际完成 Responses 回复，未复制文件 Key。官方保存选择内置 provider，保留其余 provider／OAuth。
- 记录使用 `keyMatches`、`keyVersion` 而不打印 Key，固定提示词 `Reply OK.`，工作目录不含项目代码。

重跑须使用新的绝对隔离目录：

```bash
cargo build -p rovai-core --example custom_api_native_fixture
python3 scripts/smoke-runtime-custom-api.py --claude /absolute/claude --codex /absolute/codex --fixture-root /absolute/isolated-fixture
```

## 可用性与证据边界

- 以上证明配置交付正确，不证明真实中转或模型所有能力。没有保存前／执行前的额外 HTTP 检查。
- 真实官方往返、OAuth 刷新、Claude 官方订阅、真实钥匙串及其他平台未实测，不作为禁用入口或版本封禁的依据。
  前一轮本机 `codex login status` 只读确认 ChatGPT 已登录，未复制凭据或请求模型；无需用户重新登录或购买 Claude 订阅。
- Codex 常见包装入口通过实际启动入口的本地 `debug models --bundled` 读取；无资源 SHA 或版本号白名单。
  已有完整目录的小改不依赖重新扫描程序。未知模型的兼容默认值来自原生实现，不标为真实能力验证。
- `ANTHROPIC_REASONING_MODEL` 可保存、清空并由原生配置进入进程；不能据此宣称目标 Claude 实际识别了该兼容字段。
- Rovai 历史启动环境中的当前 API Key 与地址覆盖在官方保存时直接移除，保留 OAuth 和无关变量，不再隐藏后要求用户自行查找。
  若移除 Rovai 自有项后，Codex 的外部继承环境仍有会抢占官方路径的 `OPENAI_API_KEY`、`CODEX_API_KEY` 或 `OPENAI_BASE_URL`，
  保存官方选择会指出来源及移除覆盖的处理办法，保留草稿；不在每次启动屏蔽变量，也不退出账号。
  个人文件中相反的登录方式限制随明确切换解除；组织管理来源仍由原生执行约束，未新增策略扫描或绕过；原生未知身份不新增运行门槛。
- 原生系统凭据继续由 CLI 消费。不可见来源的状态不等于已登录；普通环境引用可通过输入新 Key 替换连接，
  不强制迁移原来源。已有 API 改地址保留其原生认证，即使凭据投影未知也无需补 Key；从官方新建 API 时须提供独立 Key，
  不把 OAuth 或不明类型官方登录凭据迁移成 API 认证。
- Codex 的原生 HTTP 栈没有把 Proxy-Authorization 发到 origin；验证的是代理凭据配置保留与不误拦截，未声称真实代理认证成功。
- 保存成功只表示原生写回完成，相关 Rovai 实例按既有机制重连；对共享原生配置的外部会话不承诺无影响。

## 可用性修复验收（2026-10-05）

在同一任务 worktree 和既有测试 owner 中补齐以下回归，无新增表单、提示、探活或执行时认证覆盖：

| 场景 | 结果与证据 |
| --- | --- |
| 旧启动环境的隐藏 Key → 官方保存 | SQLite owner 覆盖 Claude 静态 Key、Codex 标准 Key 及当前 provider 的任意 env 引用；准备阶段无写入，成功时删除自有 API 环境，OAuth 与普通环境保留 |
| 原生或数据库提交失败 | 同一 owner 注入数据库发布失败，原生配置和 auth 文件恢复旧内容，启动环境保留；重试可成功，草稿不丢 |
| 凭据回显未识别时编辑模型 | 原生 owner 保留未知认证字段与现有 provider，不插入未配置 Key 引用；正式 React 组件分别以 missing／invalid_reference 状态保存 Claude 模型和 Codex 显示名称，无需新 Key |
| 新 Key 带首尾空白 | Renderer 请求与原生保存均仅写入去除首尾空白后的值；空值、内部控制字符和掩码仍拒绝 |
| 符号链接目标 | 原生配置、Codex auth 的相对符号链接正常写入与回退，链接保留；目标被改指即使字节相同也冲突；可写的缺失目标可创建，Unix 已有父目录权限不变、新文件为 0600 |
| TOML 内联表 | 顶层内联 model_providers／profiles，以及普通表内的内联 provider／profile，均支持地址、Key、默认模型和官方保存；查询参数、未知字段、其他 profile 及注释保留 |
| 外部 shell 覆盖 | 不修改系统环境；仍阻止官方路径的变量返回具体名称，文件保持原状，错误不含 Key |

定向 `runtime_custom_api` 仍为 5 项通过，草稿 Vitest 仍为 3 项；Electron owner 通过，目录为
`/private/tmp/rovai-api-usability-ui-b1winj`，使用独立 `user-data` 与其下 `managed-skill-library`。
界面验收覆盖原有草稿往返、放弃、错误／冲突恢复，并新增未知凭据模型编辑及 Key 空白处理；没有保存提醒。
实际 Claude Code 2.1.280、Codex 0.159.2 重新运行本地假服务验收，目录
`/private/tmp/rovai-api-usability-native-20261005`。两种 CLI 均通过，Codex auto 文件回退也通过；
地址前缀、查询参数、认证方式、Key 轮换和恢复继续符合上面的原生调用记录，没有真实订阅请求。

## 隐藏 ID 与原生选择修复（2026-10-05）

本轮仍扩展既有目录与原生文件 owner，不新增 Rust 测试函数、表单、探活或认证识别层：

- Codex 模型改为完整目录中已有的隐藏 ID 时，复用目标条目的完整元数据，旧 ID 未继续选用时转为隐藏。
  同时覆盖交换 ID、连续改名、添加已有隐藏 ID，生成目录保持唯一 ID；已有目标不依赖再次读取可执行程序元数据。
- 已有 API 修改地址保留现有认证来源，覆盖未知凭据、原生 keyring、内置 OpenAI 和自定义 provider。
  模型／名称编辑保持原行为。新选 API 不将官方 OAuth 或不明类型官方认证转成 Key。
- 明确切换时，只解除个人文件中相反的 `forceLoginMethod`／`forced_login_method`，不新增强制限制。
  本地文件测试保留 OAuth、权限、管理文件和未知字段；只读符号链接目标拒绝写入且保持内容、权限和草稿。
  这些测试证明编辑边界，不冒充真实组织策略服务验证。

原生 owner 5 项通过；正式 React 组件在 missing／invalid_reference 状态下保存已有 API 新地址，无需输入 Key。
界面夹具使用 `/private/tmp/rovai-api-selection-ui-4iELr8/user-data` 和其下隔离 Skill Library，无 Core。
本轮完整回归：Rust workspace 455 passed／1 既有 ignored；Vitest 237 文件／2587 项，Node 334 passed／2 平台 skipped；
类型检查、桌面构建、Core 编译检查与三项通用文档门禁通过。

实际 Claude Code 2.1.280／Codex 0.159.2 使用本地假服务，根目录 `/private/tmp/rovai-api-selection-native-20261005`。
Codex 改名到已有隐藏 `gpt-6-astra` 后，完整目录加载、线程创建和 Responses 回复通过，目标完整元数据保留；
`auto` 文件回退及改地址后调用通过，provider 仍为内置 OpenAI，认证文件字节未变。
`config/read` 的默认 provider 可为空，验收以线程返回的实际 `modelProvider` 及服务端收到的新路径、Key 为准；
最初该静态字段断言过严，修正后在独立 `codex-auto-retest` 目录重跑通过。没有额外产品侧检查或真实订阅请求。

原生配置位置和设置优先级参考 [Claude 设置来源](https://code.claude.com/docs/en/settings)；
Codex 的地址覆盖与登录限制字段参考 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

## 原生认证来源与路由切换修复（2026-10-05）

本轮继续使用两张简单表单及保存时原生编辑，不增加用户探活、认证方式字段或运行时连接覆盖。

| 场景 | 结果与边界 |
| --- | --- |
| Codex `auth.command`／`aws` | 原生 owner 按声明识别来源，不执行命令取 Key；改地址保留认证。替换静态 Key 后移除互斥 `auth`／`aws`／`env_key`，保留查询参数、传输、超时及独立网关配置 |
| Claude 三种云路由 | 无显式端点时回显空值，有端点时使用对应云地址；只改模型保留路由，明确提供 Messages 地址与新 Key 时停用个人选择开关；继承开关用原生设置停用，OAuth 与未使用云字段保留 |
| Codex 托管账号类型 | 隔离模拟后端覆盖 keyring／auto 的 API、ChatGPT、未登录与未知；通过实际选中入口 `account/read(refreshToken:false)` 的结构化结果回显，失败不阻止执行；观察不改变执行快照 |
| Codex 官方选择 | 原生 `forced_login_method="chatgpt"` 排除存储中的 API 认证，不复制或删除钥匙串对象；已有 OAuth 和未知字段保留。只有 API 的认证文件清除 Key 后保留类型标记，由原生筛除，避免空 JSON 被误读为残缺 OAuth |
| 正式组件 | 云路由端点不伪造、只改模型无需新地址／Key、Messages 切换需独立 Key；命令认证显示原生来源；未知账号类型不默认选官方。既有草稿往返、冲突、默认项及日夜主题／窄屏全部保留 |
| 模型目录 | 本轮重跑已有完整目录改名、添加／删除、默认选择、隐藏 ID 冲突与完整元数据保留，以及实际原生目录加载和两个模型调用 |

实际平台 macOS arm64，Claude Code **2.1.280**、Codex **0.159.2**，验收根目录
`/private/tmp/rovai-api-auth-acceptance-hhf41_a3`。使用固定假 Key 与本地服务，不发送项目代码：

- 实际 Codex 先加载命令认证并完成调用，再换静态 Key；AWS 声明可被原生解析，替换后同样完成 Responses 回复。
  AWS 原有服务本身未请求；这里只证明切换后无互斥配置，原生实际采用新地址／Key。
- Claude Bedrock、Vertex、Foundry 分别切为 Messages 后，实际 CLI 请求均到新前缀并携带新 Key；旧云选择未抢占。
- 实际 Codex file／auto 从 API 保存为官方后，`account/read` 返回 `account:null`、`requiresOpenaiAuth:true`。
  auto 额外保留一个 API 对象重开原生进程，仍被原生 ChatGPT 选择过滤；观察没有删除或改写该对象。
- 真实 OS keyring 用例仅在 `--native-keyring` 显式启用，曾尝试以全新 CODEX_HOME 写入固定假 Key；因隔离 HOME
  没有默认钥匙串而在初始化失败，未进入切换验收。未修改日常钥匙串、默认钥匙串或用户登录。
  **模拟后端通过不冒充真实系统钥匙串切换通过**；该项仍待具备独立钥匙串的环境实测。失败用例保留为失败，不改成跳过即通过。

Electron 根目录 `/private/tmp/rovai-api-auth-ui-w5tx64v8`，独立 `user-data` 与其下 Skill Library，无 Core。
Rust 默认 workspace 455 passed／1 既有 ignored，定向原生 owner 5 passed；草稿 Vitest 3 passed、Electron owner 1 passed。
类型检查、Core 编译、桌面构建通过；收尾修改重新运行原生 owner，没有新增独立 Rust 测试函数。
完整 `pnpm test` 通过：237 个 Vitest 文件／2587 项，Node 334 passed／2 平台 skipped；三项通用文档门禁通过。
最后一次完整本地原生验收位于上述根目录的 `final` 子目录，Claude／Codex 主路径、认证迁移和 file／auto 官方切换全部通过。
真实订阅、真实中转、真实 AWS 云认证和其他平台本轮未实测，不据此封禁版本或入口。

原生语义核对使用实际版本对应的 Codex `rust-v0.159.2` 源码：
[provider 互斥字段](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/model-provider-info/src/lib.rs)、
[原生认证加载与登录方式过滤](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/login/src/auth/manager.rs)、
[凭据后端](https://github.com/openai/codex/blob/rust-v0.159.2/codex-rs/login/src/auth/storage.rs)。
账号投影参考 [Codex app-server](https://learn.chatgpt.com/docs/app-server)，云路由参考
[Claude 原生环境变量](https://code.claude.com/docs/en/env-vars)。这些是开发证据，不成为产品的固定版本限制。

## 配置来源、身份观察与模型可选性收尾（2026-10-05）

以 PR #632 的 `52ba759` 为修复基线，先固定普通入口误读旧 profile、身份变化产生伪模式修改、
`supported_in_api=false` 模型被过滤的失败输入，再扩展既有 owner。保持两张表单、保存时原生编辑和正常原生执行。

| 工作项 | 实现与验收 |
| --- | --- |
| A：实际来源 | 普通入口读取基础 `config.toml`，不从遗留 selector 猜当前层。包装入口按需用本地 `config/read(includeLayers:true)` 确认 User 文件，缓存只含来源引用；版本只用于解释旧格式，不作准入名单 |
| A：保存目标 | 目标层、provider、目录引用和相对路径按实际来源处理；保存才移除目标版本拒绝的旧 selector，未启用的旧表保持原处。独立 profile 的有效值合并、继承默认值清理、凭据替换与目标保护由隔离文件 fixture 覆盖 |
| A：并发与失败 | 符号链接目标和基础文件参与写入保护；目录生成期间外部修改完整元数据时返回冲突，重试合并新内容。跨文件失败只回退本次写入，保留无关内容与后续外部修改 |
| B：保存独立 | 原生模式基线不再被账号观察改写。账号读取失败保留同来源的上次显示信息，状态为暂未确认；只改名称不提交模式，也不要求新 Key。保存前后不再无条件调用账号接口 |
| B：真正的冲突 | 身份未知、OAuth 刷新、无关 provider 或名称变化不制造连接冲突；实际 provider、凭据来源、目标文件或被编辑字段变化仍受保护。目录生成后的晚到字段变化不会被旧准备结果覆盖 |
| B：进程复用 | 仅名称变化不改变执行摘要、运行搜索 generation 或原有资格。真实地址、凭据、模型变化继续触发既有重连判断；替换历史启动环境 Key 同步移除废弃私有项，不重新暴露到普通环境列表 |
| C：原生可选 | 明确添加、重启用或改名的 API 条目设置 `visibility=list` 和 `supported_in_api=true`。完整能力字段、未编辑内部条目与默认模型语义保留；隐藏 ID、交换及连续改名仍保持唯一 ID |

纯配置／模拟证据：既有 5 个 `runtime_custom_api` owner 覆盖以上路径及此前命令／AWS 认证、云路由、
OAuth、内联表、符号链接、失败回退。SQLite owner 覆盖身份 API → Unknown 后仍能保存名称、真实 provider 冲突，
以及目录生成期间外部元数据变化。原生文件 owner 使用真正的目录生成结果断言名称修改不改变执行兼容性。
Renderer 草稿 3 项及正式 Electron 组件覆盖账号结果在输入期间变为未知、不覆盖选项／草稿、只发送一次保存；
原有模式往返、隐藏 Key、冲突处理、日夜主题及窄屏保留。
Electron 证据目录为 `/private/tmp/rovai-api-abc-ui-20261005-final`，独立 user-data 与 Skill Library，无 Core。

实际 CLI 对本地假服务：平台 **macOS arm64**，Codex **0.159.2**、Claude Code **2.1.280**。
完整运行证据位于 `/private/tmp/rovai-api-abc-native-lfkpzy9s/verified`；包装入口专项位于其 `wrapper-confirmation`。
收尾重跑使用同一根目录的 `closing-mvRuUr` 子目录。固定假 Key、固定最小提示词，无项目代码及真实中转请求。

- Codex 原生 `model/list(includeHidden:false)` 可列出配置模型，包括由原先 `supported_in_api=false` 的隐藏条目改名得到的模型；
  未知 ID 也能列出并实际完成 Responses 调用。目录元数据保留，默认模型不变成唯一允许集合。
- 包装入口改写 `CODEX_HOME` 后，回显和保存均采用原生返回的实际文件，不创建未使用的默认配置；
  下一次 `thread/start` 不传模型覆盖，实际采用保存的默认模型，收到的请求路径、Key、模型一致。
- 普通根配置的旧 selector 保存后解除，未启用旧表不抢占。原生查询参数、传输和超时、新进程／恢复连接、
  auto 文件回退、命令／AWS 转静态 Key、file／auto 官方选择、Claude 三种云路由转换均保留回归。

原生边界必须与代码支持区分：本机 **0.159.2 的 app-server 明确拒绝 `--profile`**，Rovai 普通启动也没有该参数。
独立 profile 层只有在实际原生入口明确报告时才使用；该分支本轮由模拟层响应／隔离文件验证，
**没有宣称 0.159.2 app-server 支持 profile 或完成了真实 profile 执行**。
当前程序拒绝的是旧顶层 selector，独立的旧 `profiles` 表可保留；未批量迁移或启用无关 profile。
配置来源读取与账号读取均不构成每次执行的新增门槛，也不因此禁用某个版本。

真实 OAuth／官方订阅、真实系统 keyring、第三方中转和其他平台仍未实测，不能以本地假服务结果代替。
最终完整回归：Rust workspace 455 passed／1 既有 ignored，定向原生 owner 5 passed；完整 `pnpm test`
通过（237 个 Vitest 文件／2587 项，Node 334 passed／2 平台 skipped）。Core 编译、类型检查、桌面构建、
格式与通用文档门禁通过；未因本轮修改新增独立 Rust 测试函数或屏蔽原有失败场景。
配置语义参考 [Codex 高级配置](https://learn.chatgpt.com/docs/config-file/config-advanced) 与
[Codex app-server](https://learn.chatgpt.com/docs/app-server)，实际运行命令的参数支持以目标程序结果为准。

## 首屏与字段限制收尾（2026-10-05）

以 `2a03e39c` 为基线，继续扩展既有 owner：

- `runtime.startup.get` 只读本地文件；单独的一次 `runtime.startup.observe` 在首屏返回后运行，且不占主交互队列。
  保存路径不调用辅助版本、来源或身份读取；新增模型所需的本地目录元数据读取保留。
- 原生文件 owner 确认：默认模型和 provider 选择受启动参数固定时，本地地址、Key、模型仍回显；当前 provider 的地址和新 Key 可保存，
  受限默认模型不被改写。已确认目标的临时来源错误不阻止其他编辑；从未确认的包装入口即使默认文件存在，
  也不会把连接修改写进去，原内容保持不变。
  provider 被固定时，仅确认仍指向当前 provider 的地址／静态 Key 编辑可写入；选择实际上指向其他 provider 时不会误写本地旧定义。
- Core 的既有检查 owner 用子进程文件屏障让辅助进程等待，期间本地 get 与普通环境字段 save 均能返回；
  依赖未知目标的写入立即报告具体限制，未启动另一轮辅助进程或误写文件。释放屏障后读取失败不清空本地表单。
- Electron 正式组件用挂起的补充响应确认本地表单已可输入；迟到模式／来源结果不覆盖地址、模型名称或新 Key 草稿，
  保存完成后补充读取失败不改变成功状态。隔离证据目录 `/private/tmp/rovai-finish-ui-20261005`，无 Core／真实 Runtime。

macOS arm64 全量回归通过：Rust workspace 455 passed／1 既有 ignored；定向原生 owner 5 passed、Core 启动设置 owner
3 passed、交互队列 owner 1 passed。完整 `pnpm test` 为 237 个 Vitest 文件／2587 项与 Node 334 passed／2 平台 skipped。
类型检查、`cargo check --workspace --all-targets`、桌面构建、格式和文档门禁通过。
实际 Codex **0.159.2** 对本地假服务再次通过，证据目录 `/private/tmp/rovai-finish-native-MOYnpr`：
包装入口的实际配置来源、目录可选性、保存后的地址／Key／默认模型、查询参数、auto 文件回退、命令／AWS 凭据替换均保持。

这轮验证区分本地配置、受控辅助进程和真实 CLI；未增加真实订阅、系统钥匙串或第三方中转实测结论。
没有新增字段、常驻刷新、轮询、探活或独立 Rust 测试函数。

## 来源缓存与同页衔接收尾（2026-10-05）

基线 `8f06c9a3` 的两个失败已固定在既有 owner：原生文件用例在修改 `LOG_LEVEL` 后失去已确认来源；
Electron 用例在保存 `CODEX_HOME` 后等不到同页补充请求。修复后缓存只依赖实际入口与配置目录，普通环境值不再使目标失效。

真正换程序／目录仍重新确认目标。页面在保存启动选择后发起一次独立补充读取，期间输入的地址、模型和 Key 保留；
确认结果只合并实际草稿修改，期间已保存的普通环境值及修订不回退。若原先已有 API 草稿，切换时不把它写入旧位置，
而是保留到新目标确认后继续保存。后端也拒绝把新未知入口的默认路径当作旧目标。无新增刷新按钮、轮询或保存前同步检查。

验证使用隔离文件、SQLite、模拟账号／来源和正式 Renderer，未增加真实账号或第三方中转的验证承诺。
`scripts/smoke-runtime-custom-api.py` 的 npm 式 Node 入口转发给所选实际 Codex，模拟 npm 的脚本启动形态；
它不代表安装并运行了某个官方 npm 包，也不验证任意包装脚本。

macOS arm64 验证结果：

- 原生连接 5 个既有 owner、Core 启动设置 3 个 owner 通过；新增场景扩展既有 Rust owner，未新增独立 Rust 测试函数。
- 草稿单元 4 项及隔离 Electron 正式组件通过。最终界面证据目录 `/private/tmp/rovai-source-cache-ui-verified-20261005`，
  覆盖普通环境保存后继续改 API、同页换目录／程序、已有新 Key 草稿、观察期间普通保存、真实保存错误保留、
  以及连接摘要未变的名称保存不被迟到结果还原。没有启动日常 Core 或使用日常 userData。
- 实际 Codex **0.159.2** 对本地假服务通过，证据目录 `/private/tmp/rovai-source-cache-native-20261005`。
  shell 和 npm 式 Node 包装入口均在修改普通环境变量后复用已确认位置，完成原生写回、模型选择与正常调用。
- Rust workspace 455 passed／1 既有 ignored；完整 `pnpm test` 为 237 个 Vitest 文件／2588 项，Node 334 passed／2 平台 skipped。
  类型检查、全 workspace 编译、桌面构建、格式及通用文档门禁通过；界面收尾保护再次运行对应验收。

## 主分支集成验收（2026-10-06）

将主分支 `23b989c1` 合入原有 `rovai/runtime-custom-api` 工作树，保留主分支的真实 Host 初始化、
静态安装发现、Fast 偏好和 v0.4.5 发布元数据；原生连接编辑、脱敏、模型列表所有权及恢复摘要继续保留。
主分支已使用 Runtime Launch v47 和 V1.72-D12／D13，故 API 合同顺延为 v48，相关理由顺延为 D14／D15，
继承原 v47 内容，不覆盖主分支既有规范。

macOS arm64 合并后验证：

- 默认 `pnpm test:rust:pr`：454 passed／1 既有 ignored；`cargo check --workspace --all-targets` 与格式检查通过。
- 定向 `slow-tests`：原生配置 5 项、启动设置 3 项、冻结／重绑定 1 项、发现文件身份 1 项、Codex 真实 Host 协议夹具 1 项通过。
  主分支新增的文件身份测试夹具补齐两个可选原生配置字段；没有新增独立 Rust owner。
- `pnpm test`：238 个 Vitest 文件／2603 项，Node 334 passed／2 平台 skipped；类型检查、桌面构建和通用文档门禁通过。
  首轮后台评测用例等待超时；该文件单独 5 项及随后完整套件均通过，未修改相关生产代码或测试等待时间。
- 隔离 Electron 正式设置组件通过，证据目录 `/private/tmp/rovai-pr632-merge-ui-20261006`，
  使用其独立 `user-data` 和 `managed-skill-library`，不启动 Core 或真实 Runtime。

Codex 原有缺失显式模型的单场景测试由主分支的
`real_host_validates_before_input_and_executes_in_the_same_process` 接替，继续验证缺失模型零正文，
并保留认证、选项、初始化、Fast 反馈与同进程执行场景。没有以禁用测试解决冲突。
本轮未重复真实 CLI／账号调用，之前的本地假服务证据与未实测边界保持独立，不等同于真实 OAuth 或中转验收。

## 测试准入与退役

本轮没有新增独立 Rust test。`runtime_custom_api` 的 5 个 owner 保持不变：配置／身份 parser、SQLite 发布、
原生文件来源、目录转换、本地程序入口。SQLite owner 扩展保存时切换、隐藏草稿、真实字段冲突和跨文件回退；
纯 parser 不能证明原生文件与数据库发布之间的失败边界。Renderer 草稿和 Electron 测试分别拥有状态投影与真实组件事件。

同一改动中删除运行时连接覆盖、额外私有配置／身份验证生产路径及其断言，后继合同由原生写回 owner 和 CLI Smoke 负责；
未把这些退出的行为改成 ignored 测试。恢复兼容、未知模型、原生参数、权限、Key 脱敏、路径及不可变目录等仍有效的边界保留。
现有检查、协作、审批、取消和其他 Runtime 的 owner 没有退役。
