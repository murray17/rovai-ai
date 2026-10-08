# Cline 原生认证简化、warm 与并行复验（2026-10-08）

按 User 89 / 91，在 `rovai/mission/052` 的 `60dba4a8` 上继续，未回退既有实现。
认证简化提交为 `4e635b78`；合并主干 `a77b537d` 后的最终运行代码为 `b9a43fb9`。
合并只拼接 Hub/执行 driver 导入和保留两份版本说明，保留主干的新唤醒、预算与用户信息展示。
当前合同为 [Runtime Launch v53](../../contracts/runtime-launch-and-verification-v53.md#cline-native-hub)，
取舍见 [V1.72-D24](../../versions/v1.72/decisions.md#v1-72-d24)。
原始私有结果的摘要与受限字段见[证据 JSON](native-auth-warm-parallel-2026-10-08.evidence.json)。

## 实现

- 删除 `cline_hub/auth.rs`：Provider、OAuth 字段、账号标识、端点及混合凭据准入全部退出。
  不以其他模块或新模式开关替代。`NativeAuthLease`、scope_busy 和账号强制回收一并删除。
- 所有 Host 直接引用选中安装的持久 Provider 源，不再写 Provider 副本，不清除用户认证环境。
  实际安装原生解析静态 Key/OAuth，sessionConfig 不注入 API key。Rule/MCP/discovery/历史保持既有隔离。
- 账号与 BYOK 统一按共享 Fleet warm/cold/并行。旧认证锁不再读取；不扫描或删除遗留用户文件。
  Managed Process 内核身份账本、取消、崩溃回收和未知输入不重发保留。
- 兼容性只取当前 Provider/目录，保留当前源、账号观察、Key、端点和未知配置元数据的变化；
  排除正常 token/expiry/updatedAt 与无关 Provider 变化。不要求 accountId 存在。
- 显式登录保留原生交互/取消，不再独占凭据文件或验证账号字段。completed 仅表示原生命令流程完成。
  零模型诊断不宣称认证成功；匹配的 `ok:true / finishReason:error` 也按现有封闭分类反馈，不公开原文。

## 实际安装与范围

所选绝对入口为 `/opt/homebrew/Cellar/cline/3.0.3/libexec/lib/node_modules/cline/bin/cline`，Homebrew CLI 3.0.3，
安装内 `@cline/cli-darwin-arm64/bin/cline` SHA256 为
`1be9d0ad68b753b5efaf573b58dd7d48dc98db7475cc17d415dab9bd1071f574`。
未下载、替换或修改 Runtime。账号为已登录的 `openai-codex / gpt-6.1-sol`，所选原生 Provider 无静态 Key；
验收子进程排除了残留 BYOK 环境，不代表产品会移除用户环境。
BYOK 继续使用此前授权的 `openai-compatible / gpt-6-sol` 配置来源与原端点。

Core/App 数据、工作区、MCP 根与 Skill Library 都位于本轮独立验收目录；账号凭据直接引用日常原生源，
Cline 获授权原生写回。日常 App 未停止、覆盖或迁移，外部 Cline 未被接管。

## 本轮证据

| 场景 | 结果 |
| --- | --- |
| 账号 first/warm/cold | 真实请求成功；first/warm 为同 Host，cold 为新 Host；同 Session/Binding/generation、身份和早期记忆 |
| 同源双成员并行 | 两个独立 Hub 通过相互等待的工具 barrier；各自身份、审批、工具结果和 committed builtin send 正确，未出现 scope_busy |
| 取消与后续恢复 | 预期 cancelled，等待后无迟到文件写入；下一轮成功；活动账号 Run 期间另一诊断也可 ready |
| 账号总计 | 8 轮：7 succeeded、1 预期 cancelled，不写成 8 次成功 |
| BYOK | 新建验收会话 first/warm/cold 三轮成功，无静态 Key 注入；另保留一次原因未证实的首轮失败 |
| Core 重启与清理 | SIGKILL 验收 Core 后仍活着的自有 daemon，在重启时按内核身份回收；连续两次非法 MCP 准备失败无残留 |
| 未登录 fixture | 实际 Cline 报告缺凭据；正式 Run 显示 credentials_unavailable，不假定零模型 ready 等于已登录 |
| 原生拒绝/服务不可达 | 实际 Cline 请求 loopback 401/503 fixture，分别得到 authentication_failed/service_unavailable；每个场景一个 Run，无 Rovai 重放或来源切换 |
| 登录 fixture | 最终打包 App 的选中 CLI、私有输出脱敏、输入、取消、未知账号格式下退出成功、活动登录 App/Core 退出清理通过；这是模拟交互，不是真实首次授权 |
| 旧认证锁 | 现有 Rust 登录 owner 在旧 starting 记录及已持有 OS 锁下完成两个独立登录；锁不再参与准入 |
| 打包 App | 最终运行代码 b9a43fb9，Renderer/preload/Core 八轮（7 成功、1 预期取消）再次验证账号 first/warm/cold、双成员 barrier、审批、发送与取消后恢复；相同构建 Core 的 BYOK 三轮成功 |

最终打包 App 也完成三条失败路径与原始服务错误不回显断言；三个负例都是明确失败，不计入成功模型请求。
所有完成的验收目录中，自有 Host 临时目录归零，Runtime Files Root 清理完成，没有 Provider 副本。
最终确认自有 App/Core/Hub 已退出，所选 Cline 平台二进制摘要未改变。
本轮观察到的账号及 BYOK 源摘要未改变；这只是本次事实，不承诺 Cline 刷新时源文件永不改变。

## 负例与验证边界

首个 BYOK 正式请求收到原生 failed，未生成模型输出；当时旧反馈路径仅有 runtime_prompt_failed，
没有足够证据归因于凭据或网络。没有自动重试该 Run、改 Key、改端点或换计费；后续独立验收三轮成功。
因此不把这次失败写成已经定位或已经修复的认证缺陷。

移除提前认证门槛后，原有 diagnostic fixture 的“零模型检查必须返回未登录”断言不再成立。
已改为检查认证 unknown，并在真实请求中验证原生错误。未登录 fixture 实际报告的是缺少 API key，
不是重新授权；分类按原生事实扩展为 credentials_unavailable，没有根据本地字段推断 OAuth。
用于确认该原生返回形状的临时观测仅针对 synthetic native-model，已从交付代码删除。

已有登录复用通过；首次完整授权、实际刷新、外部 Cline 并发刷新、其他 Provider/平台仍未验证。
未改真实 token 或有效期。两成员普通并行成功不能证明并发刷新安全。
本轮不重做 compaction、MCP/Skills、大历史恢复或文件证据全矩阵；既有范围与缺口保持原报告。
这些未验证项不再形成 warm/并行的新增封禁，产品继续保持 Preview。

## 自动检查

定向 Cline extended：8 通过、2 个需要真实安装的测试按原理由忽略；默认 workspace Rust：464 通过、2 忽略。
all-targets/all-features check、typecheck、Vitest 2607、Node 335 通过/2 跳过及通用文档门禁已执行。
设置页 fixture 的旧“登录已完成”断言随新的“登录流程已完成”文案修正，复验通过。
上述完整 Rust/前端检查在合并主干后重跑通过；App 构建及 ad-hoc 签名通过。
同一运行代码的 [Ubuntu CI](https://github.com/murray17/rovai-ai/actions/runs/37740978566) 与
[Windows 编译](https://github.com/murray17/rovai-ai/actions/runs/37741195908)通过；Windows 编译不提升 Cline 平台资格。
测试退役与 successor owner 见[测试指南](../../development/testing.md#cline-认证简化的测试变更2026-10-08user-89)。

最终扫描本轮 60 个公开变更文件及 945 个验收文件，实际源中的 Key、access/refresh/id token 与私有端点匹配为零。
