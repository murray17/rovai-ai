---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: preview-implementation
last_updated: 2026-10-08
---

# Cline Native Hub 原生 ChatGPT 账号认证

User 85 要求保留 Native Hub、让实际 Cline 读取和刷新凭据；User 87 明确授权直接使用本机已登录账号，
无需隔离认证。沿 `rovai/mission/052` / `8eb7f648` 推进，保留已有 Windows/错误/清理/历史边界修正。
账号来源复用不等于所有 OAuth Provider 通过，也不把登录或 Session 配置成功当作真实请求成功。

## 实际安装与调用链

| 项目 | 实际观察 |
| --- | --- |
| CLI 绝对入口 | `/opt/homebrew/Cellar/cline/3.0.3/libexec/lib/node_modules/cline/bin/cline` |
| 正常发现 | `/opt/homebrew/bin/cline` 解析到上述 Homebrew 安装 |
| 原生版本 | CLI/package 3.0.3；该安装此前 Hub 观测为 0.0.41 |
| 平台 | 本机 macOS arm64；不据此提高其他平台资格 |
| 实际平台二进制 SHA-256 | `1be9d0ad68b753b5efaf573b58dd7d48dc98db7475cc17d415dab9bd1071f574` |
| 原生认证入口 | 该安装 `auth --help` 广告 `auth [provider]`、`--provider`、`--data-dir`；明确 Provider 不要求 TTY |
| 本次 Provider / 模型 | `openai-codex` / `gpt-6.1-sol`，`tokenSource:oauth`，无静态 apiKey |
| 持久源 | 用户 `.cline/data/settings/providers.json`，由原生 Cline 管理；不复制到 Host |

只读取实际安装的帮助及编译文件中已有源码定位，不下载另一个 SDK/Core，不修改安装或版本门槛。
原生链路为 Hub `session.create` → Core startSession/buildConfig → ProviderSettingsManager 读取所选文件
→ 原生 Provider 初始化；executeTurn 的 syncOAuthCredentials 再读源，TokenManager 解析/必要时刷新并保存。
原生 auth retry 仍由 Cline 处理。Rovai 的 sessionConfig 不含 apiKey 或手工改装的 token。
本机 TokenManager 的 refreshInFlight 只在实例内合并，未观察到跨进程刷新锁。

[官方 CLI 文档](https://github.com/cline/cline/blob/main/apps/cli/README.md)仅作入口参考，实际安装帮助和行为才是本次证据。
不能拿其他版本源码的刷新算法或锁证明此安装已通过刷新验收。

## 三步交付与所有权

1. **原生路径验证**：正式 Core → Hub Adapter，无静态 Key；已有账号首次、续接及 Core cold 的三个请求成功。
   初次脚手架把可选 models.json 当必需文件，在零模型阶段失败；下一轮三个请求成功后，旧 warm Host 相等断言失败。
   原报告保留，调整为账号单所有者策略后重新执行完整矩阵。
2. **认证存储与所有权**：BYOK 只投影选中原生记录，保留未知元数据，排除无关 OAuth；账号直接引用持久源。
   同文件的 Rovai 登录/Hub 全生命周期由 OS 文件锁和原有内核进程账本共同管理。账号 Host 每轮退出，
   下一轮保持 Session/Binding/generation cold；不合并成员可变 Rule/MCP。源忙在输入发送前明确拒绝。
   只有证明旧进程树退出才交接，所有权不明阻断。Host/Camp/普通 App 退出不删除持久凭据。
3. **产品入口与验收**：Cline 启动设置中的显式 ChatGPT 登录/重新登录，选中绝对路径和 argv 调用，
   bounded 私有交互及取消，结束清空内存输出。完成后沿既有检查入口核对 Session，不自动提交模型请求或重放用户输入。

本次授权允许 Cline 向日常凭据文件写回刷新，不再承诺该文件永久字节不变。Rovai 本身不保存第二份 token 模型。
其他日常安装、App、Hub 和配置不由验收接管；测试 Core/App/userData/Skill Library/工作区独立。
正常 access/refresh token、expiry 和 updatedAt 变化不重绑；原生 accountId、Provider、端点、认证来源仍参与兼容性。
缺稳定账号标识、OAuth+静态 Key 冲突或自定义账号端点明确拒绝，未知认证不猜成 OAuth。

## 验收矩阵

| 场景 | 结果与范围 |
| --- | --- |
| 已有原生登录、无静态 Key | 正式 Adapter 的扩展九轮：8 succeeded / 1 cancelled；环境排除残留 API key，源无静态 Key |
| 同 Session 续接 / Core cold | 保持 Session、Binding、generation、身份及早期记忆；账号每轮回收 Host，不宣称 IdleWarm |
| 双成员 / 工具 / 允许 / 拒绝 / 取消 | 九轮扩展矩阵通过；取消后 16 秒无延迟文件写入，下一轮成功；每个成功 Run 恰好一次 builtin public send |
| BYOK 回归 | 原授权 BYOK 来源 first/warm/cold 三轮成功，同 Host warm；原 Provider、模型及地址行为保持 |
| 首次产品登录 | 界面/子进程交互与取消 fixture 通过；未把用户此前手工登录算作新入口的完整真实登录验收 |
| 真实刷新 | **未触发**：初次核验凭据尚有约 239 小时有效期；未改真实 token 或有效期，不声称刷新通过 |
| 并发刷新 | 当前仅 Rovai 管理进程单所有者降级；外部 Cline 不服从该锁，跨外部 CLI/Hub 刷新不获资格 |
| 未登录 / 撤销 / 服务失败 | 未登录与封闭分类分别验证；未撤销真实用户授权。原生将网络/撤销合并为重新授权时不能进一步区分 |
| 长上下文 / 压缩后 cold | 本轮账号 7 轮成功；第5批原生历史由34条/575752 bytes收缩到29条/567381 bytes，cold后28条/432485 bytes；同 Session/Binding/generation、System身份与早期记忆保持；未改模型窗口 |
| Core crash / 未登录 | 实际独立 Core SIGKILL 后原生 daemon 仍存活；重启按内核身份回收，下一次同源诊断 ready。两次 MCP 配置准备失败均清空临时目录；synthetic 未登录源正确返回认证错误，真实源未改 |
| MCP / Skills | 本轮账号3轮成功：first、stdio MCP真实tools/call、原生Skill读取；不外推HTTP MCP、更新/撤销、受管索引及压缩后Skill读取 |
| 打包 App / 同源占用 | 新包 Renderer→preload→Core 的4轮为3成功/1预期取消；运行中的原生工具占用账号时，竞争诊断明确scope_busy、零模型输入；取消及后续恢复通过 |

实际安装的原生刷新失败可能只给 requires re-authentication，Rovai 保留原生事实，不把普通网络错误自动理解为退出登录。
不删除凭据、不切换 Provider/账号/计费来源、不重发未知输入。明确原生拒绝与传输未知仍按共享终态结算。

## 登录选择回归

打包零模型测试 `account-packaged-login-09/10` 暴露一次产品错误：fresh search 只重新读取环境，
没有叠加已保存 RuntimeStartupConfiguration，登录可能使用全局安装及默认凭据源。不是 OAuth 服务故障。
失败保留；修复为在 help/login 前重新读取本机已保存配置并加入同一搜索快照，避免绕过用户选择。
这两次自有授权进程均已随 App 关闭回收，未提交授权码；真实日常凭据摘要前后相同。
后续 `account-selected-login-11` 正式 Core fixture 已通过所选绝对路径、私有源、原生输出脱敏、输入、取消、再次完成及活动登录退出；零模型请求，临时 Host 清空，真实源未改。最终重新打包的 `account-packaged-login-12` 经真实 Renderer/preload/Core 重复通过同一零模型矩阵，ad-hoc 签名通过。它专门拥有此回归，不能再用纯 Login 单测替代。

## 自动化与凭据检查（认证三步交付，合流前）

Rust 默认 workspace 463 passed / 2 ignored；Cline extended 9 passed / 2 ignored；workspace all-targets/all-features check、
typecheck、Vitest 2605、Node 335 passed / 2 skipped、Desktop bridge、settings Electron 日夜/1040×700/200% 交互、
fmt 和通用文档门禁通过。首次全量前端测试发现一个新增英文文案缺失，补齐后全量通过。
724 个账号验收文件（数据库、原生历史、报告和临时配置）未命中真实 access/refresh token；
34 个公开变更文件未命中原生凭据或私有 BYOK 端点。所有验收自有 Host 目录已清空；持久原生源未删除。
本轮没有实际凭据刷新写入；文件未变是本次观察，不是禁止未来 Cline 原生写回的承诺。

## 复现与证据

产品入口：`fixtures/native_hub_product_probe.mjs --native-account --settings-source <授权原生 settings> ...`，
支持 `--extended`、`--single-member`、`--long-context`、`--extensions-only`、`--app`。
运行前须按[隔离流程](../../development/local-workflow.md)声明测试 Core/App 数据根；隔离的是产品验收数据，不是授权账号。
`fixtures/native_hub_diagnostic_recovery_probe.mjs --native-account ...` 只提交无模型诊断，覆盖崩溃及未登录负例；
未登录只创建 synthetic Provider 源，绝不改真实凭据。

私有报告保留在本次 `/private/tmp/rovai-052-account-*` 和 `/private/tmp/rovai-052-auth-*`；公开文件只保存封闭结果、
Run/Binding 标识和安装身份，不收录 token、完整 Provider、认证 URL/设备码、原始模型正文或私有端点。
长上下文为 `account-long-04`（最后输入曾为370223，cold后278325；basic 未提供压缩生命周期事件，不伪造通知）；零模型重启为 `account-recovery-06`。
账号 MCP/Skill 为 `account-extensions-07`，打包生命周期及实际同源占用为 `account-packaged-08`。
当前三次基本请求的脚手架负例为 `account-single-02`；修正后扩展矩阵为 `account-extended-03`；BYOK 为 `auth-byok-regression-05`。
公开[封闭证据](native-account-auth-2026-10-08.evidence.json)仅列真实 Run 状态与已知限制。
当前权威见 [Runtime Launch v52](../../contracts/runtime-launch-and-verification-v52.md#cline-native-hub)及
[V1.72-D23](../../versions/v1.72/decisions.md#v1-72-d23)。本报告不提升 Preview 为完整认证/刷新资格。

## 最终主干合流与 App 复验

认证交付提交为 `232ecaf7`（路径与验收）、`1a2255cd`（凭据与所有权）、`728ff463`（显式登录及选择来源）。
随后合入主干 `ed90fa9b`，运行代码提交为 **`95ded2d2c7c43aa51d4c8ed33bc331d31d2e014e`**。
主干与 Preview 独立使用 Migration 184，按精确结构区分两种已存在来源，并由 185/186 合流至 schema 136；
原因与保留边界见[当前版本说明](../../versions/v1.72/README.md#主干与-preview-数据合流2026-10-08)。

该提交重新构建的 macOS arm64 App 通过 ad-hoc 签名；`account-packaged-final-13` 经真实
Renderer→preload→Core 完成首次、同 Session 续接和 App/Core cold 三轮 succeeded，Binding、generation、
早期记忆与 System 身份保持。`account-login-final-14` 零模型复验选中 CLI、显式登录、私有输出脱敏、
输入、取消、再次完成和活动登录退出，临时 Host 均清空。它仍是交互 fixture，不是完整真实 OAuth 授权。

合流后 Rust workspace **465 passed / 2 ignored**、Vitest **2607**、Node **335 passed / 2 skipped**；
workspace all-targets/all-features、typecheck、fmt、通用与 diff-aware 文档门禁通过。继续执行浏览器测试
首次在键盘等待处超时；保留负例，同一生产及测试代码复验通过，没有删除或放宽断言。
[Ubuntu CI](https://github.com/murray17/rovai-ai/actions/runs/37729920420)和
[Windows runner](https://github.com/murray17/rovai-ai/actions/runs/37729971072)均在 `95ded2d2` 通过。
Windows 编译通过不构成 Cline Windows Runtime 资格。

额外的扩展 migration 扫描为 **28 passed / 1 failed**。失败 owner 为
`authority_migration::tests::macos_provenance_added_after_ticket_is_readmitted_without_losing_business_data`，
本机在任何 migration 执行之前的 `authority_open` 返回 `authority_contract_changed / IdentityChanged`。
已从 Git 提取合并前 **728ff463** 到独立临时源码目录，运行同一 owner，得到同样失败；该 owner 与
生产 admission 未在本次合流修改。这个 macOS 元数据重验问题仍未修，不计入通过项。Cline/Command catalog
两种来源、continuation 迁移、receipt 回滚和重开 owner 均已通过。

最终扫描 **1131** 个账号验收文件与 **96** 个公开变更文件，真实 access/refresh/id token 匹配为零。
源凭据未复制到 Host；本轮真实源没有变化，仍允许今后由 Cline 原生刷新写回。实际刷新、首次完整产品
授权和跨外部 Cline 进程刷新并发依然未获资格；本次复验不改变这些结论。
