---
document_type: research-report
authority: windows-account-runtime-validation
last_updated: 2026-10-29
---

# Windows 账户 Runtime 增量验收（2026-10-29）

本记录覆盖任务工作副本的实验接线，不晋升平台准入，不代表完整产品验收通过。**已通过：CodeBuddy/OpenCode 的真实模型首条、热/冷历史、原生工具与合成 Skill/MCP，CodeBuddy 活跃取消无迟到写，账户附件/头像读取，以及 Core 在线与离线 Hook、祖先链接反例。Pi 仅启动、activate 首条与热/冷历史在 04/05 通过；最新源码复跑首条 stop_reason=error、无正文，判为未过。未通过：Grok 1.0.70 仅 advertised grok.com，卡非交互认证。**

## 最小范围矩阵

| Runtime | Windows Product 准入 | 本轮产品搜索 | 账户代码 | 本轮事实 |
|---|---|---|---|---|
| CodeBuddy | Qualified | 找到 cmd，2.178.0；后本机已安装包为 2.178.1 | 新接线 | 用户级入口被 OS EPERM 拒绝；授权纯程序独立部署 2.178.1 后 initialize 成功。标准 Windows profile 初始化后，账户内真实 Sol 首条、随机标记热/冷历史、原生 Shell、合成 Skill/MCP 与活跃工具取消均通过；Windows Hook relay 仍未实现，正式默认初始化路径与模型附件未单独取证。 |
| OpenCode | Qualified | 找到 cmd，1.19.4 | 新接线 | initialize/新会话成功；自身 provider 的首项 Haiku 报 unknown provider。隔离内存 model/small_model 改选其自身已有 gpt-5.6-sol 后真实回答、热续聊、关闭后冷会话可继续生成。07 已以随机首轮标记、真实 initialize 能力、相同恢复 ID 验证热/冷历史回忆；08 原生 Shell 合成文件效果与取消请求通过，11 以真实活跃原生工具验证专用账户匹配、非管理员和无迟到写。 |
| Codex / Claude | Qualified | 找到 npm locator / cmd | 原有接线；cmd bootstrap 扩展共享 | 默认 shared/git_worktree 路径不变；本轮真实模型聊天未重跑。 |
| Pi | Qualified | 找到 npm locator，1.4.0 | 新接线 | 账户启动、Session 目录、activate 首条与热/冷历史在 04/05 通过；最新源码复跑 06 首条 stop_reason=error、无正文，未过。External MCP 原生 Unsupported，不新增桥。 |
| Grok | Qualified | 找到 native，1.0.70 | 新接线 | 已到认证阶段，仅 advertised grok.com，非交互认证未就绪；配置读取已加逐层无跟随、拒绝 hardlink、1MiB 上限并通过 Windows 实测。未执行 login。 |
| Qwen | Qualified | 产品含 PATH/注册表/已知目录搜索未找到 | 未接线 | 未找到不是不支持；不安装或重研全部候选。账户环境中预留其独立 Home 不等于产品准入。 |
| Copilot / Antigravity / Kiro / Qoder / TRAE / Kimi / MiniMax / DeepSeek / ZCode | Qualified | 本轮未找到 | 未接线 | 本次未安装、未进行账户模型验证。 |
| Cursor | NotQualified | 找到 native | 未接线 | 产品平台不准入，不能以本机找到程序绕过。 |
| Cline / Command Code | NotQualified | 未找到 | 未接线 | 保留原平台限制。 |

## 已实现安全边界

- 删除启动前自动 icacls grant；目录权限不足由账户本身访问失败，不修既有 ACL，不回退宿主身份。原 ACL owner 改为成功/失败验证均不改权限。
- bootstrap 帧包含完整 native/cmd identity，两端核对后继续原 serializer、System32 cmd 和 Job。没有将 npm 命令假设成 EXE，也不重造 Adapter。
- CodeBuddy、Qwen 和 XDG 使用专用 profile；OpenCode 宿主 config/DB 路径及 Node 注入覆盖清除。ACP Host compatibility 包含账户部署摘要和隔离档。
- ACP FS 用已验证非管理员 token 的独立 OS 线程实际打开/写入；不在线程池残留身份。Run scope 与 Host 关闭拒新操作并等待已开始操作。关闭失败不跳过进程/Terminal 回收。
- Built-in 主 pipe 不变；独立账户 pipe 只准本次登录 SID/SYSTEM，再核精确 Job 成员和 process identity。当前租约从内存读取；普通业务仍走 Core 既有鉴权。运输测试使用合成业务拒绝，不冒充成员查询成功。
- 本地附件/头像 source 同账户观察尚未实现，规范化且完整 schema 校验后对该输入明确拒绝，纯文本/无头像合法操作可进入原业务；不先账户检查再宿主 reopen。
- 账户 native journal tail 未资格化则禁用，不借宿主历史；结构化 ACP Usage 保留。CodeBuddy 冷恢复确切路径同账户检查，未完成真实恢复资格。

## 可核查证据（本任务 target/，不提交原始日志）

| 证据 | 退出码 / 结果 | 范围与不足 |
|---|---|---|
| account-check-recovery-01.log | 0 | Core/Host bins 编译。发生过自有大文件错误对象覆盖，已从干净基线重放自有修改恢复；损坏片段/失败保留，不将旧通过冒充当前源码。 |
| account-managed-process-final-01.log | 0，20 passed / 0 failed / 10 ignored | capture/shared/git_worktree、账户 profile、双端 bootstrap、cmd 元字符/identity、Job/handle 所有权；ignored 为子进程入口或真实部署 smoke。 |
| account-filesystem-live-03.log | 0，1 passed | 真实既有非管理员账户 token；允许读写；创建时私有假标记宿主正对照，账户读/覆写 PermissionDenied/raw5、字节/DACL不变；存在文件 closed 精确错误；可控在途写完成后 close 返回，后续写拒绝。 |
| account-builtin-live-07.log | 0，1 passed | 真实账户产品 CLI 调用 + 合成合法 Envelope；外部 Job 谓词拒绝、实际外部连接使用真实 processId 仍无 context/业务响应（不宣称 OS 拒绝打开）、退出 Job 空。不是实际 Core lease 业务成功。 |
| account-product-opencode-06.log | 0，1 passed | 真实回答及热/冷可继续生成；06 硬写能力/新词不能代历史恢复最终资格。 |
| account-product-opencode-07.log | 0，1 passed | 随机首轮标记；hot/cold不重述却准确回忆；冷恢复 ID 与请求相同，能力取真实 initialize。 |
| account-product-opencode-08.log | 0，1 passed | 原生 Shell 写合成文件，内容精确匹配；取消请求成功和 Job 收尾。不代活跃长工具无迟到写证明。 |
| account-product-opencode-11-stop.log | 0，1 passed | 原生工具事件+ready，System32身份内存比较专用账户且非管理员，取消成功、Job归零，等待超过延迟写点仍无late文件。09/10因GNU whoami不支持/groups未产生ready，严格失败保留。 |
| account-codex-regression.log / account-claude-regression.log | 0 / 0，21/0/1 与34/0 | extended原Adapter owner兼容回归，不重跑真实provider聊天。 |
| account-secret-scan-01.json | 已知秘密无匹配 | 268个本任务文本产物与专用profile原生日志，精确匹配只输出布尔/相对名，不声称证明未知秘密不可能存在。 |
| account-real-core-cli-04.log | 0，1 passed | 同账户真实产品CLI经专用桥/生产Core handler/current lease，member.list threadId/预期成员及真实Envelope operation/ok/result强断言；unbind后旧auth拒绝，Job空。03为harness前缀解析失败，已保留。 |
| account-builtin-live-08-source.log | 0，1 passed | 创建时私有假源，真实账户CLI send --file 被安全拒绝，普通member.list仍返回，假源字节不变；不表示附件支持通过。 |
| account-opencode-projections-02.log | 101 | 随机MCP返回及实际tools/call=1通过；Skill随机标记缺失，宿主原私有插件不可读。 |
| account-opencode-projections-04.log | 0，1 passed | 随机Skill/MCP实际返回、MCP tools/call=1，同账户token成功读取实际重建TEMP插件，不代表已触发compaction事件。 |
| account-check-final-02.log / account-managed-process-final-02.log | 0 / 0，20/0/10 | 最新插件映射与环境修正后的生产check及受管进程回归。 |
| account-secret-scan-final.json | 已知秘密无匹配 | 最终467个文本产物与专用profile原生日志精确布尔扫描。 |
| account-opencode-projections-03.log | 0，1 passed | 随机Skill/MCP标记及MCP实际调用通过；独立DB核skill/MCP completed。03插件字段错把宿主拒读当可读，不作为插件加载证据；04改验实际重建路径。 |
| account-builtin-lease-regression.log | 0，2 passed | 原 Core lease 旋转、fence、旧 lease 拒绝及回放 owner；不是模型+真实 Core 业务验收。 |
| account-platform-regression.log | 0，14 passed | 主私有 pipe、平台 DACL/存储准入回归，未放宽主通道。 |
| account-docs-test.log / account-docs-check.log | 0 / 0 | 通用治理测试10/0与文档检查通过；后续报告变动仍需最终重跑。 |
| account-product-codebuddy-01.log | 101 | 私有用户级 npm 入口 OS EPERM；只记启动失败。 |
| account-product-codebuddy-02.log / -03.log | 101 | 隔离程序副本 initialize 成功，但无官方环境认证时 session/new auth-required。 |
| account-product-codebuddy-local-auth-06.log | 诊断 owner 0，prompt 未通过 | Sol 目录/选择正确、vendor 校准为原 OpenAI，原生 internal/refusal、本地无请求。诊断通过只证明失败事实，不是聊天通过。 |
| account-product-opencode-02..04.log | 101 | Haiku provider 模型选择失败；保留原生短原因，不归为 OS 权限。 |
| account-product-opencode-05.log | 101 | end_turn/有回答；owner 在 detach 后读已清空观察器造成误判，后续修复为提前冻结精确正文。 |

## 未完成与最小后续动作

CodeBuddy 在标准 profile 初始化后已通过 Sol 首条、随机历史热/冷、原生 Shell、随机原生 Skill/MCP 与活跃工具取消；仍待正式 start_or_resume_session 默认路径、模型附件与原生受保护目录拒绝的独立证据。不能复制宿主登录历史、向第一方发送第三方 key、修改官方包或给 Home 开放权限。

OpenCode 的真正同 ID 历史回忆已由07通过，原生 Shell 写入效果已由08通过；Shell实际专用账户身份及活跃工具主动取消无迟到写已由11验证；真实 Core 内置工具业务已由Core04通过；唯一合成Skill和本机MCP由投影03/04通过，账户附件source支持仍未实现。首批两者 ACP Client Terminal 原能力为 disabled；新登录/Job 派生工具不得借宿主桥授权。

Qwen 等未找到行保留；Pi/Grok 已接线但状态如上，不宣称全部 Runtime 已支持。默认 Codex/Claude、shared/git_worktree 保留原行为；未用隔壁评测/Judge/语料或日常数据库。

真实凭据只原位读取并内存环境使用；新增模型文件只有环境变量字面引用。合成假 key/假标记与真实 provider 使用分开。纯程序部署 provenance 位于任务 target；未 push/PR/发布或替换日常程序。


## Fixture 与生产默认差异

07/08/11真实模型 Host 的 CompactionDetectorPolicy 为 Disabled，不能代表正式 release_default_policy 的 BestEffort；投影03/04另按BestEffort执行。OpenCode 正式默认会创建额外插件并引用私有绝对路径；独立合成Skill及本机MCP由03实际工具/随机回执验证；账户默认插件采用bootstrap内存重建修正，CodeBuddy Hook、compaction事件发送与附件完整可用性未在本轮闭合，不得据这些隔离结果宣称默认产品全部通过。没有更改生产默认。

新增真实Core owner复用现有 runtime_resolution_test_core 和 claimed_runtime_cleanup_test_run，只开放相同 fixture helper 的 Windows cfg。独立失败语义是账户CLI经过专用pipe、生产连接handler/Core lease和真实member.list业务，再解绑使旧auth拒绝；原底层lease单元测试与合成upstream不能覆盖这个跨OS身份+DB seam，因此该真实部署 owner 默认 ignored，入口为 slow-tests 特性，使用合成Thread，不向真实人发送。


### 默认投影修正与失败证据

原Skill失败来自原生依赖解压路径及继承模块环境，系统Archive存在但PSModulePath含宿主Home。仅账户进程模块搜索改为系统和ProgramFiles已有模块，不安装/改系统模块。唯一合成Skill按原生.agents/skills发现，未抄日常Skill。MCP本地三帧initialize/list/call先验证，随机回执只由服务返回，记录tools/call次数；01固定标记不能证明Skill实际完成，错误判断保留。

OpenCode compaction插件是无秘密程序文件，复用原bootstrap私有输入内存传输，目标账户TEMP下重建并只替换声明plugin URL；宿主原私有文件不grant/repair。投影映射只保留本次source→账户临时路径，用同账户token检查重建文件，不把宿主拒绝原路径当成加载证明。输入临时文件在Runtime Job归零后由原helper清理；强杀helper仍可能保留，沿原合同披露。

compaction事件触发和Hook CLI持久outbox权限尚未闭合：原ROVAI_CLI_CONTEXT指向宿主私有目录，不能因桥能拿当前context就假定该目录可写。该增强缺口不改正式BestEffort默认、不扩大主pipe/文件ACL。完整交付仍未达标，不标记全部Agent/附件支持成功。
