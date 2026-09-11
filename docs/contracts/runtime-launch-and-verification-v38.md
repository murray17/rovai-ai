---
document_type: contract
name: Runtime Launch and Verification
version: v38
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Runtime Launch and Verification v38

继承 [v37](runtime-launch-and-verification-v37.md)。本版只调整 Grok Build、Kimi Code 和 Kiro CLI
普通可用性／深度能力 Probe 的原生 Home 选择；以下规则替代继承合同中这三类 Probe 的临时 Home 规则。
正式 AgentRun、其他 Runtime、原生协议、能力清单、认证选择、版本门槛与平台资格不变。

## 原生环境与临时资源

- 普通 Probe 不设置、删除或重写 `HOME`、`USERPROFILE`、`GROK_HOME`、`KIMI_CODE_HOME`、`KIRO_HOME`。
  用户已设置的值原样继承，未设置的值保持未设置，由对应 Runtime 使用官方默认目录。
- Grok BYOK 和 account-auth Probe 都使用原生 Home。普通检测不再复制 `config.toml`、
  `managed_config.toml`、`requirements.toml` 或凭据文件；原有官方配置解析和进程级密钥环境注入保留。
- Kimi 的 `KIMI_MODEL_*` 子进程 overlay 继续由既有专属配置入口提供，不改变其优先级或格式。
- 一次性工作目录及其中的 attachment/run-tmp 等探测资源保留。Kiro 继续在该临时工作目录生成
  `.kiro/agents/rovai.json` 并以 `acp --agent rovai` 启动，保持 `includeMcpJson=true` 和当前 Probe 权限。
- 沿用 `RuntimeProbeProcess` 的有界启动、超时与进程清理。成功、失败和超时后只回收 Probe 所有的
  进程与临时资源，不扫描或删除用户原生 Home、配置或 Session 数据来追求零残留。

## 非生成探测

普通深度检测的主动请求仍仅为现有版本、协议、非交互认证及无消息 Session 初始化检查：

| Runtime | 初始化后的现有请求 |
| --- | --- |
| Grok Build | 非交互 `authenticate`、`session/new`、已广告的 exact `session/resume`、当前模型的 `session/set_model` |
| Kimi Code | `session/new`，读取返回的配置与能力 |
| Kiro CLI | `session/new`、当前模型的 `session/set_model` |

不发送 `session/prompt`，不新增测试回复、模型生成、compact、自动标题或工具执行请求。
Grok 的创建期 rules marker 继续只作为现有 Session 初始化参数，不据此宣称模型服从性已实测。
非交互认证选择不变，不弹出浏览器或 device login，不因普通检测扩权。

不发 Prompt 不等于零联网或零落盘：Runtime 可以按原生行为初始化必要状态。Probe Session 不写入
正式 Native Binding；临时 cwd 的结果只证明该环境下的基础连接，不能外推为任意项目配置、余额或模型生成保证。
不新增 Runtime 界面字段、状态或操作。

## 自动化验收与范围

回归、真实模型 smoke 与发布验收继续由调用方提供独立 fixture、测试 Home 和测试凭据；Probe 原样继承
该测试进程的环境，不自行恢复真实用户 Home。确定性测试不得读取用户凭据或调用真实模型。

Kiro additive agent、Kimi 的 `~/.config/rovai/kimi-code.env`（或 `ROVAI_KIMI_CONFIG`）继续作为明确的
Adapter 差异保留，分别评估；本版不删除 MCP 追加或新增官方 BYOK 配置迁移。Pi 图片投递不属于本次范围。
