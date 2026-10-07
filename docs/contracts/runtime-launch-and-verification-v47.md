---
document_type: contract
name: Runtime Launch and Verification
version: v47
status: accepted
source_version: v1.72
last_updated: 2026-10-06
---

# Runtime Launch and Verification v47

继承 [v46](runtime-launch-and-verification-v46.md) 的权限、控制通道、ID、取消、输入去重、Session 和关闭边界。
本版替换统一 Ready/浅检/深检运行准入：安装记录拥有在哪里及如何启动，真实 Host 决定本次能否执行，诊断用于解释失败。

## 安装发现与配置

启动和 rescan 只解析入口、确认文件及平台执行条件、记录一致的 fingerprint/file identity。
保留 GUI PATH 补全、用户指定入口、command shim 与目标身份；搜索环境按既有缓存复用，普通运行在入口失效时可刷新。
不执行批量 `--version`、协议 Probe 或后台健康轮询，不创建认证、能力或 Ready 证据。
`found_uninspected` 表示已检测到可尝试运行；`AdapterInstallation.permissionOptions` 是 Adapter 静态权限词汇，不是验证结果。

版本优先来自静态元数据或真实初始化；未知版本不拒绝保存、创建 Run 或启动。明确不兼容仍须在正文发送前拒绝。
历史 `probe_status`、认证失败、过期目录和没有历史成功均不构成新 Run 的准入锁。旧快照保留诊断价值，不新增 LKG。
配置保存原子校验目标身份、权限 schema 和模型选择的语法；显式模型 ID/选项保留原值，动态可用性由本次 Host 确认。
背景发现不创建或改写成员配置，不启用已停用的 Installation，不改变账户或扩张权限。

## 真实启动与输入屏障

Core 先检查平台、工作区授权、执行目标及文件完整性，再启动承载本次任务的 Host。
在任何正文到达 Runtime 前完成协议、所需能力、显式模型/选项与权限验证；成功后同一 Host 继续执行。
默认模型不为填充 Picker 等待完整目录，sentinel 不发送给原生 Runtime。未知显式选项不得静默丢弃或替换模型。

- Codex：真实 app-server initialize、account/read 和必要的模型/选项验证先于 thread/turn input；默认模型不调用 model/list。
- ACP：真实 initialize/session 的协议、所需 Session 能力与模型配置、原生模式确认先于 session/prompt；TRAE 模式须明确吻合。
- Claude：真实控制 initialize 完成且权限响应一致后检查显式模型目录，再发送 stream-json 正文。
- Pi：真实 RPC state、extension、工作区及模型/选项确认先于 prompt；默认模型不查询完整模型目录。
- Antigravity：正文只能通过 `--print` argv 发送，缺少正文前的独立协议握手。仅该 Adapter 保留有界 `--help/models`
  检查原生 flags、登录及显式模型，不运行 `--version`；取消中止预检并在 spawn 前再次检查。
- Fast 直接传递冻结偏好，不增加资格预检或可选反馈屏障，见 [Camp Member Fast v3](camp-member-fast-v3.md)。

已有 IdleWarm、Run/epoch/lease、工作区隔离、恢复兼容与身份摘要保持；不跨任务并行共享会话。
CLI 更新允许同一逻辑 Installation 有界重新解析及原子 rebind，然后接受本次 Host 验证，不先启动独立深检 Host。
fingerprint 与轻量文件身份必须来自同次稳定内容验证，不能把新元数据登记为旧 hash 的证明。
读取现有文件身份只按 Installation、当前路径及请求的 fingerprint 绑定，不依赖健康快照是否存在或新旧。
普通可执行文件的元数据未变时继续使用现有快速路径。保存的 Windows locator 是重新解析入口的线索，
须与当前 Installation 路径匹配；健康快照缺失或文件身份失效不应隐藏它，实际 shim/解释器/目标依赖仍须重新校验。

发现及入口重绑定的文件读取、完整哈希和 locator 依赖复核统一在 `spawn_blocking` 中完成，且先于获取 Core 数据库锁。
提交只接收不可自行构造的文件验证结果，锁内保留 Installation 身份/代次处理与 SQL 写入；不重新读文件、计算哈希或启动进程。
搜索环境的既有代次和更新围栏保持，提交的元数据来自刚才完成的内容验证，不能用提交时的新元数据替换它。

## 单次状态与失败

沿用 Run `running + wait_reason=runtime_initializing` 表达正在初始化；可信 input-accepted fence 清除此阶段。
不增加全局健康状态机。启动异常进入本次失败并展示现有脱敏 RuntimeFailureView；修复后下一次正常运行重新尝试。
冻结配置失败也创建 failed Run、结算对应 Delivery，并从现有 `last_error_code` 向读模型 `terminalReasonCode` 投影封闭配置错误码：
未配置、不完整、Installation 缺失/停用、模型/权限配置无效、Adapter 不匹配或不支持。
该投影仅在原终止原因为空时补充，保留计划关闭等已有原因；界面给出具体原因，不公开原始配置 payload。
失败 Delivery 不循环领取；后续新输入正常重新准入。已有批量输入、版本、input delivery 与公开消息边界保持。
只有确认输入未发送才可重试初始化；接收未知或已接收时不自动重放正文。

## 诊断与验收

主动诊断与主动模型 Picker 可使用既有有界 Check Manager；它们不是运行授权步骤。
页面打开、切换 Runtime、普通任务及空闲不触发批量深检，不新增重试调度器或定期轮询。
合成进程矩阵验证 version 故障而实际初始化成功、首次安装/无快照、历史失败后重试、同 Host 执行、
认证/模型/权限/协议失败零正文、取消零正文、错误投影和接收未知不重放。真实 CLI/账户兼容性仍需单独记录实测证据。
