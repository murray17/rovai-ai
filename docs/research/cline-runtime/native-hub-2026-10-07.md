---
document_type: runtime-research
runtime: cline-cli
authority: research-evidence-only
status: native-hub-stage-b-verified
observed_version: 3.0.3
observed_platform: macos-arm64
last_updated: 2026-10-07
---

# 用户实际安装的 Cline Native Hub 验证

User 消息 76（`537efdf5-963f-4def-9f88-9c088eb1f4ee`）要求先用实际安装验证独立
Hub 和原生压缩，再接共享 Runtime 合同。基线为 `ca58d8d3`，分支 `rovai/mission/052`。

**A 通过，B 的 basic 阈值及同 Session 原生 cold 路径通过；C 产品 Adapter 尚未实现。**
这次运行的是 Rovai 正常发现的 Homebrew Cline 3.0.3，不是之前 3.0.68 的源码/SDK 实验。
生产仍使用 ACP；没有改最低版本、用户安装、用户设置或旧 Session 的后端。

机器可读结果见[证据](native-hub-2026-10-07.evidence.json)。数值、摘要、原生 Session 和
进程 ID 可交叉核对；公开文件不包含凭据、完整 System、模型历史或 Hub token。

| 诊断事实 | 结果 |
| --- | --- |
| 用户安装启动的独立 Hub 可认证连接 | Verified；loopback、独立 discovery、随机 token、进程来源一致 |
| 原生会话配置已交付 | Verified；实际模型回包报告相同 provider/model 和 272000 窗口 |
| 原生自动阈值压缩 | Verified/basic；原生持久历史缩减，随后真实请求成功，同 Session 身份/早期记忆保持 |
| overflow recovery + native retry | 未验证；不借用旧 ACP 或源码实验结果 |
| 同一 Session 的 cold 执行恢复 | attach 单独失败；按当前 CLI 自身的完整原生恢复序列补测通过 |
| 完整产品合同 / Hub Adapter | 尚未通过 / NotImplemented；ACP 入口保留 |

## 实际安装与阶段 A

隔离 Rovai Core 的 `runtime.startup.get` 返回 revision 0、未指定程序路径；正常
`runtime.startup.inspect` 选择 `inherited_path`：

```text
/opt/homebrew/Cellar/cline/3.0.3/libexec/lib/node_modules/cline/bin/cline
  → 同安装 node_modules/@cline/cli-darwin-arm64/bin/cline
  → --cline-hub-daemon --cwd <owned workspace> --host 127.0.0.1 --port 0 --pathname /hub
```

wrapper 摘要 `2f1a6cc26501d5cdc6121935b64638c3b9359251be5e65724c4fc069d007c329`；
实际 Mach-O 摘要 `1be9d0ad68b753b5efaf573b58dd7d48dc98db7475cc17d415dab9bd1071f574`。
这些摘要仅用于本次来源和前后保护核验，不是生产白名单。实际 daemon 的 `ps comm`、加载映像、
discovery、`/health` 相互一致。CLI 版本 3.0.3，Hub build ID 0.0.41，协议 v1；三者分别记录。

既有产品最低版本 3.0.65 仍令检查结果为 `light_failed/runtime_version_below_minimum`。
本轮在产品外运行研究客户端，没有保存 Ready、绕过 AgentRun 门禁，或把 3.0.65 宣称为 Hub 最低版本。
没有安装、下载或执行另一份 Cline/Core/SDK。

### 隔离与认证

仅由选中的 wrapper 执行原生启动命令：

```text
cline hub --host 127.0.0.1 --port 0 --cwd <owned workspace> start
```

| 路径或输入 | 隔离语义 |
| --- | --- |
| `HOME=<root>/native-home` | 私有 Home；不继承真实 Home 下的默认发现 |
| `CLINE_DIR=<root>/persistent/config` | 私有原生扩展/配置根 |
| `CLINE_DATA_DIR=<root>/persistent/data` | 原生数据库、Session、历史与日志；独立于临时 Host |
| `CLINE_PROVIDER_SETTINGS_PATH` / `CLINE_GLOBAL_SETTINGS_PATH` | 私有设置投影路径；无全局写回 |
| `CLINE_MCP_SETTINGS_PATH=<root>/mcp.json` | 本轮空 MCP 对照；不继承用户服务执行 |
| `TMPDIR=<root>/host-temp` | 临时 Host 文件 |
| `CLINE_HUB_DISCOVERY_PATH=<root>/host-temp/hub-owner.json` | 独立 ownership/discovery；不是用户默认 owner 记录 |

所有目录检查真实目标位于私有根，根权限 0700，凭据文件和 discovery 0600。
会话数据在两次 Hub 重启后仍可读，最终删除 `host-temp` 后 8 个原生 Session 的历史摘要不变。
研究根位于系统临时区，保留用于审计；这不是已经实现的产品持久目录策略。

原生 CLI 的 ensure/start 有探测和替换旧 Hub 的逻辑，因此使用独立 discovery 和 **CLI 参数
`--port 0`**。不能用默认端口，也不能以 `CLINE_HUB_PORT=0` 代替；该环境值在本安装会落回默认端口。

- 仅监听 `127.0.0.1`，由 `lsof` 核对。
- WebSocket 使用 `Sec-WebSocket-Protocol: cline-hub-auth.<token>`；缺失/错误 token 均拒绝。
- `/shutdown` 缺失/错误 Bearer 返回 401；只对自有、来源复核后的 Hub 使用有效 token，返回 202。
- `/health` 可公开读身份；它不能替代连接认证。token 未放进 URL、命令参数或证据。
- 自有 Hub PID 4924 → 22154 → 27277 → 33180，每次旧进程退出后才启动新进程，token 轮换。
- 用户已有 Hub PID 68550 始终存活，原 owner 记录字节不变；未向它发送管理或 Session 命令。

这些检查在首次启动和最终自有进程上分别执行。[认证探针](fixtures/native_hub_auth_probe.mjs)
只连接已经建立来源证据的私有 Hub，不能单凭任意 SDK 的 import 成功认定来源。

## 原生配置语义与阶段 B

当前用户真实 Home 的默认 provider 是 `cline`。本轮真实模型验收继续使用此前获准的
Cline sub2api BYOK 设置：来自隔离验收目录的 **Cline 自己的** providers/models 文件，
不是从其他 Runtime 取认证。私有投影字节不变，原文件前后摘要不变。
Provider 为 `openai-compatible`，模型 `gpt-6-sol`，原有模型目录窗口 272000。
这不是对用户当前 `cline` 默认订阅通道的验收，也没有替用户更改默认 provider。

实际 `settings.get` 返回 `not_implemented`。只读检查本安装的 help 与二进制内可读实现表明：
原生 `--compaction-mode` 默认 **basic**，basic/agentic 映射到启用对应策略，off 映射到关闭。
本安装没有观察到新版本的 `compactionEnabled` 全局设置读取路径；不能照搬 3.0.68 的默认 agentic。
本轮没有提供该启动参数或修改全局设置，而是在独立 Session 中显式测试原生配置值。
这些是当前安装的研究映射，不是已完成跨版本偏好解析器。

客户端只交付原生参数：

```text
session.create.payload.sessionConfig
  providerId / modelId / apiKey / baseUrl
  knownModels = 原生 models.json 对应 provider 的 models
  cwd / workspaceRoot / systemPrompt
  compaction = omitted | { enabled: true, strategy: "basic" } | { enabled: false }
```

当前安装的 Hub 将 `sessionConfig` 展开传入原生 `startSession`，原生 prepare-turn pipeline
检查 `compaction.enabled`。本轮直接通过 Hub 运行证实其效果，没有拦截 `Core.start()`，没有
注册 message builder、客户端 compaction contribution、压缩算法或重试器。
测试关闭 tools/spawn/team 以先验证最小 B，因此不能将结果用于工具、权限、MCP 或团队资格。

### 相同输入的三组真实对照

[压缩探针](fixtures/native_hub_compaction_probe.mjs)依次创建三个独立原生 Session。
每组先存身份/记忆，再发送 30 个相同的确定性数据块，最后询问身份与早期记忆；每组 32 次请求。
三组逐轮 Prompt 摘要、System 摘要、Provider/模型/窗口、配置源摘要相同，只有 compaction 参数不同。
96 次正式对照均为原生 `finishReason=completed`，真实模型回包均报告
`openai-compatible / gpt-6-sol / contextWindow=272000`，客户端重发数为零。

| 组 | 原生 Session | 持久历史行为 | 最后一次真实 input | 最终身份/记忆 |
| --- | --- | --- | --- | --- |
| 不提供 compaction | `1791373034721_30pa9` | 连续增长至 64 条，未见压缩 | 630724 | 两者保持 |
| 原生 basic 启用 | `1791372829439_l963j` | block 24：48→38；block 25：38→27；最终 27 条 | 483341 | 两者保持 |
| 原生 off | `1791373169821_j3bn5` | 连续增长至 64 条，未见压缩 | 630724 | 两者保持 |

basic 第 24 块发生原生历史缩减后，第 25–30 块及最终询问仍成功；Session ID 未变，原生持久
System 摘要每轮相同，最早用户消息仍含记忆标记。客户端没有写入、裁剪或替换历史文件。
成功判断同时使用原生持久状态、对照差异和后续真实请求；不是仅凭 token 降低、配置 ACK 或模型自述。

本安装原生 basic **直接重写 `.messages.json`**，没有本轮可见的 `.compaction.json` sidecar。
不能将 3.0.68 实验的 append-only canonical + sidecar 结构套用到这份旧 Core。
压缩次数不从消息数变化推算；当前普通 Hub 事件转换没有转发原生 compaction status-notice，
因此此处使用可信持久状态，不宣称收到了 started/completed 生命周期事件。

272000 是原生模型目录/回包元数据，不能当作本次 Provider 的真实拒绝上限。
这份原生 compactor 按字符估算触发，而 Provider 在随机数据上报告更多 tokens；没有人工降低窗口。
**没有发生并验收真实 overflow recovery。**

保留两个限制：off 第 26 块虽然请求成功，模型回复了 `BLOCK_25_ACK`，不是预期 26；这不影响
原生终态/压缩对照，但不能声称所有块的语义断言通过。最初另跑的三组 96 请求未传 `knownModels`，
回包无窗口值，不计入 272000 验收；实际代码有 200000 fallback，仅作为源码推断。
修正后重启了同一安装的自有 Hub，完整重跑上述正式三组，没有删除初测记录。

## 阶段 C 的实际边界

### Cold：保留 attach 负例，验证官方恢复序列

[冷恢复探针](fixtures/native_hub_cold_probe.mjs)在正式 basic 组完成后停止自有 Hub，再用同一
安装、数据和设置启动。新 Hub 对同一 Session：

1. `session.attach` → `ok:true`，ID 相同。
2. `session.messages` → `ok:true`，返回压缩后 27 条历史。
3. `run.start` → 先发 `run.started`，随后 `run.failed`，回复
   `command_failed: session not found: 1791372829439_l963j`。

只提交一次 cold 输入；没有重发、切 ACP、复制历史或改 ID。前后消息文件摘要相同。
失败证实 **attach/read 成功不足以证明恢复执行**，也证实该版本的 `run.started` 不能单独作为
输入已被执行内核接纳的证据。

对实际安装只读复核：`session.attach` 注册 participant 并读取存储，不重建执行 Session；
`run.start` 查活跃 Session map。`session.restore` 是指定 `checkpointRunCount` 的检查点恢复路径，
不能不经验收当成 exact cold resume。`session.create` 加相同 ID 也不能自动视为加载既有历史。
不能由 attach 负例就断言 Hub 不支持 cold。

进一步只读检查**用户安装内** CLI 的 interactive session manager：官方 resume 实际先调用
`readMessages(sessionId)`，再 `start({config: {...config, sessionId}, initialMessages})`。
原生 Hub runtime host 对应 `session.messages` → `session.create`，保持同一个 ID；
这与单独注册 participant 的 `attach` 是两条不同路径。

[原生恢复探针](fixtures/native_hub_resume_probe.mjs)在新的自有 Hub PID 33180 上复现该序列：

1. 精确 `session.get` 返回原 ID；System SHA、provider/model 与冻结的 basic 对照一致。
2. 使用 **Hub 自己返回**的 27 条消息作为原生启动的 initialMessages，客户端不编辑消息。
   原生读取接口会去掉 `<user_input mode="act">` 包装；首轮严格字节 guard 因此拒绝、未提交输入。
   复核后确认差异仅为本安装的原生包装去除，再采用原生返回值完整交回原生启动。
3. `session.create` 返回同一 Session ID；提交新 Prompt 前，持久消息字节、原生协议历史、System
   均与重建前一致。没有创建新 ID、迁移 ACP 历史、手工写文件或重放旧 Prompt。
4. 新真实请求 `completed`，input 483393，模型仍报告 272000 窗口，身份和早期记忆正确；
   原生历史从 27 增长为 29 条。客户端只提交一次新输入，重试零。

这证明当前 basic 测试 Session 的**同后端原生 cold 连续性**；不是 Rovai 重启、旧 ACP 跨入口
迁移或所有压缩策略的恢复资格。保留 attach-only 失败和最初 guard 负例，未用新结果覆盖它们。

### 原生只读观测有入口

普通 Hub 事件 envelope 有 eventId/Session ID，但未带原生 Run ID。继续测试了原生
`kind:"hook"` 贡献，**没有**注册 `kind:"compaction"`：

- [只读 hook 探针](fixtures/native_hub_hook_probe.mjs)仅记录哈希/计数/原生标识，所有响应都是空对象。
- 原生 Session `1791373561713_34be2`、Run `run_ZAu3GwbR` 的 beforeRun/beforeModel/afterModel/
  afterRun/onEvent 可关联；真实请求完成，beforeModel 的 System SHA 与预期一致。
- 这证明 Run 归属有可用原生观测入口，不能据普通事件缺字段便宣布原生 Run ID 不存在。
- 文件式[只读 Plugin](fixtures/native_hub_witness.mjs)在本轮未产出记录；不把 hook 贡献的通过
  冒称现有 Plugin/managed System Rule 已验收。未对安装做补丁来解决 Plugin 加载。

共享 Adapter 仍须处理 client/capability ownership、断线未决请求、迟到事件、Binding generation
以及原生 Run 与 AgentRun 的对应；这次没有 Rovai Binding/AgentRun，证据字段明确为空。

### 实施前 Parity Matrix

最接近的生产实现是现有 Cline ACP Adapter/Fleet。Hub 是不同的原生传输；不把它包成 ACP。

| 合同轴 | 本次实际证据 | 后续 Adapter 接入要求 / 当前状态 |
| --- | --- | --- |
| Auth / Provider / Model | 用户安装和既有 Cline BYOK；模型/窗口回包一致；settings.get 未实现 | 原生偏好读取、启动参数优先级和升级后重探未实现 |
| Host / Fleet / LRU | 自有 Hub 来源、认证、退出及用户 Hub 共存通过 | 纳入共享进程所有权/Fleet，成员配置差异 fence；NotImplemented |
| Native Session | warm 同 ID；官方 readMessages/start 序列 cold 通过，attach-only 失败 | 共享 Binding/generation、租约、升级重探与旧 ACP 隔离仍未实现 |
| Bootstrap / System Rule | 合成 System 持久不变、只读 hook 一次真实请求可核对 | 现有 managed Rule、冻结身份、A/B/A、每轮交付未验收 |
| Compaction | 原生 basic 阈值/持久状态/后续请求通过 | agentic、overflow+retry、压缩取消未验收 |
| Skills / MCP | 此最小模型对照未启用工具 | 原生发现、Assignment、更新撤销、压缩后真实调用未验收 |
| Tool / Action / 文件 | 未验证 | 原生工具 ID、真实成功/失败及文件证据级别映射未实现 |
| Narration / Final / CLI send | 原生完整 reply 有 completed 终态 | AgentRun、Missing-Send、每 Run CLI lease 和发送归属未实现 |
| Permission / Approval | 未验证 | 原生审批、超时、过期响应、断线 fail closed 待验收 |
| Usage | 原生逐回复 assistant metrics 与 model.info 已记录 | Run/Session/估算/实值分层及恢复后的去重未接线 |
| Cancel / Queue / Retry | 无客户端重发；只对空闲自有 Hub 做关闭 | 原生 Run 取消、子进程收敛、压缩中取消和不确定执行恢复未验收 |
| 多 Session / 重启 | 独立 Session 顺序对照；数据跨 Hub 重启保留且 basic 冷恢复真实请求成功 | 未做交错执行、审批断线或 Rovai 重启；不冒称共享配置安全 |
| Ready / Version / Platform | 实际 3.0.3/macOS arm64；既有 3.0.65 产品门槛未改 | 无新的版本锁；Hub 能力探测和产品资格未实现，其他平台未验收 |

因此本轮交付最小原生协议客户端及研究探针，**没有接入生产 Adapter 或切换入口**。
当前 Core 的 Cline 浅检仍按既有 `cline::supported_version` 检查，实际 3.0.3 为 light_failed；
这条产品门槛本轮没有绕过或删除，也不能直接搬成新的 Hub 最低版本要求。它需要与 Hub 后端的
能力准入单独复核。研究层的 Session/压缩/cold 通过之后，仍需实现上述合同及产品后端选择，
不能将研究启动器直接切进 AgentRun，也不能静默迁移旧 ACP Binding。

## 可复核文件与运行边界

[最小客户端](fixtures/native_hub_client.mjs)仅依赖 Node 内建 WebSocket/文件/crypto API，
不导入 Cline SDK。支持认证、注册、订阅、命令 requestId 配对、明确的超时/断线不确定结果，
默认不重试；关闭连接不冒称取消原生 Run。研究协议只支持已理解的 v1，不按 CLI 版本白名单启动。

复测时必须先重复 Rovai 的正常发现并取得新来源证据，再用所选可执行文件创建独立根及自有 Hub。
`discovery.json` 是正常发现报告，`stage-a.json` 是实际 daemon 核验报告；cold 探针只读取这些
本轮生成的所有权信息，不依赖固定安装 SHA 或实验源码。凭据须来自授权的 Cline 原生配置，
不能把历史临时路径设为产品 Runtime 或认证来源。

```text
node fixtures/native_hub_auth_probe.mjs <owned-root> <verified-daemon-path>
node fixtures/native_hub_compaction_probe.mjs <owned-root> default 30
node fixtures/native_hub_compaction_probe.mjs <owned-root> basic 30
node fixtures/native_hub_compaction_probe.mjs <owned-root> off 30
node fixtures/native_hub_cold_probe.mjs <owned-root>
node fixtures/native_hub_hook_probe.mjs <owned-root>
node fixtures/native_hub_resume_probe.mjs <owned-root>
```

压缩探针拒绝覆盖已有 case 目录；不会自动启动另一份 Runtime。上面的执行顺序不构成失败后自动
fallback，cold 探针会停止并重启本轮独占的 Hub，不能用于用户已有或仍有活跃 Run 的服务。

安装的 9 个路径和原生 providers/MCP/default-instance 的摘要与权限前后一致；原先缺失的
global-settings/models 仍缺失。私有 Provider 副本已删除，原授权配置/模型文件摘要不变；
四个自有 Hub 均退出，两次测试投影的 Provider 副本均已删除，私有 Host 临时文件及资格 Core 的 Runtime Files Root 已清理，
8 个原生 Session 数据保留。用户 Hub 仍存活且 discovery 未变。

验证包括 7 个 JS 文件语法、来源/三组输入一致性/96 次真实终态/原生 cold 正反例的证据断言、
公开文件凭据匹配检查、`docs:test` 10 项、`docs:check` 及以 `ca58d8d3` 为 base 的
`docs:check:ci`。本轮没有 Rust/Renderer 生产改动，没有把旧 ACP 全量测试记作 Hub 已通过。

参考官方 [Hub/Spoke 说明](https://docs.cline.bot/sdk/architecture/hub-spoke)和
[SDK 架构](https://github.com/cline/cline/blob/main/sdk/ARCHITECTURE.md)理解候选协议；
本报告的版本行为与通过结论以实际安装和上述真实探针为准。3.0.68 的
[源码 shim 实验](acp-compaction-shim-2026-10-07.md)没有用于替代本轮 Runtime 或 cold 验收。
