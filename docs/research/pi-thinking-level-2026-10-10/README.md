---
document_type: runtime-research
runtime: pi
authority: research-evidence-only
status: verified-with-native-limitations
observed_version: 0.84.4
observed_platform: macos-arm64
last_updated: 2026-10-10
---

# Pi 思考强度：原生对照与实现验收

Pi 0.84.4 的真实 RPC 验证了同模型重复选模会把恢复后的 high 改为全局 medium；跳过重复选模保留 high。
显式 off/low/high 均原样回读；清除 override 后不设置仍保持 off；真正切模且无 override 得到原生 medium。
max 在本次模型上被原生收窄为 high，Rovai 必须按不一致拒绝。当前实现边界由
[Runtime Launch v55](../../contracts/runtime-launch-and-verification-v55.md)拥有。

## 原生证据与边界

[可重放脚本](fixture.mjs)使用临时 PI_CODING_AGENT_DIR、工作区、Session 目录和无效测试 Key。
通过安装的官方 SessionManager 创建合成历史，使用原生内建 Provider；不复制、读取或改写用户 Provider/认证配置。
没有 Prompt 或生成请求，没有真实模型质量、实际凭据有效性、Provider 完整性或 Windows 验收声明。
脚本实现原生命令对照；生产 PiHost 的命令顺序与错误分类由 Rust fixture 验证，二者不可混称真实端到端生成。

本轮模型为 `anthropic / claude-haiku-4-5` 与 `anthropic / claude-haiku-4-5-20251001`。
同一进程覆盖恢复、不覆盖、显式 off/low/high、清除、真正切模、新 Session 和 warm exact resume；第二个进程覆盖
cold exact resume。共 2 个 RPC Host，0 次生成。首次 get_state 约 233 ms，已启动 Host 的目录 RPC 小于 1 ms，
返回 13 个条目；这些是单次本地合成配置测量，不是全量 Provider 或性能承诺。缓存命中零启动由 Core fixture 证明。
另以相同隔离配置通过已有 `pi::host::tests::real_pi_machine_ready_smoke`，验证生产 managed extension、
新建/恢复与临时探测目录回收；该 smoke 同样无 Prompt。

隔离目录中实际创建空 auth.json、models-store.json，Session JSONL 记录原生模型/强度变化；settings.json 未变化。
不宣称原生初始化完全不落盘。目录与 RPC 命令的脱敏记录见 [evidence.json](evidence.json)。

重放：`node docs/research/pi-thinking-level-2026-10-10/fixture.mjs`，默认使用 `/opt/homebrew/bin/pi`；
可用 `ROVAI_REAL_PI_EXECUTABLE` 指定相同 npm 包布局的安装，输出保存在本轮临时目录。
`ROVAI_PI_THINKING_EVIDENCE` 可指定证据路径。重放不要求可用的真实凭据，不发送生成请求。

## 错误可见性

生产接口具有 `extension_error` + `event: register_provider` 的结构化通道：
[原生事件产生处](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/src/core/extensions/runner.ts)、
[RPC 转发处](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/src/modes/rpc/rpc-mode.ts)。
临时 Host 观察到该事件时，即使合法数组随后成功返回，也保留旧目录/成功时间。
纯内部 `getError()` 不通过 get_available_models 返回；这类未暴露错误的 fixture 只有正常 RPC 数组，没有虚构完整性字段。
任意 stderr 不作为目录错误。两种分支由真实 stdio fixture 验证，本轮未构造真实 Provider 组合失败或额外扫描 Provider。

## 自动化范围与基线失败

新增 Rust owner 只有两个：`activation_preserves_same_model_thinking_and_strictly_verifies_overrides` 拥有
Session 激活与有副作用的 RPC 顺序，原纯验证器不能证明该边界；
`pi_catalog_observations_are_independent_of_health_and_fenced_by_identity` 拥有无健康 bootstrap、调度、SQL
提交/读取及安装/环境/程序竞态。原 Codex owner 有 Ready 门禁与完整检查回退，不能替代 Pi 的相反约束。
两者分别使用最小 Host 和现有隔离 Core fixture；能力矩阵、保存、历史和请求强度继续扩展既有 owner。

`cargo test --workspace -j 2` 默认层、定向 8 项 Rust 回归、37 项前端测试、生产组件 Electron 两入口交互、
typecheck、桌面构建和文档门禁通过；兼容性记录的绑定摘要同步更新。
新建 Session、恢复 high、显式 override、默认切模、Provider+ID 比较、clamp 拒绝、目录初次读写、并发共用、
旧环境/安装/程序结果拒绝、已观察错误保留、旧格式升级、unknown 不循环、保存未知字符串、历史冻结均有覆盖。
界面验证保留了 Pi 缺席模型与旧值，不发逐模型请求；旧健康失败不会显示为目录失败，Core 独立失效会丢弃
旧本地目录响应。其他 Runtime 继续使用原过滤规则。

扩展模块筛选另命中两项既有失败，均在 `fe93dee855ba2e9b487b7f91dfce8dd7e3da8069` 的独立源码/target
重新构建复现：`acp_runtime_classification_covers_every_acp_backed_adapter` 的 Cline/Command 顺序断言，
以及 `pending_picker_upgrade_keeps_history_rolls_back_failure_and_reuses_the_old_card` 的旧迁移 fixture
缺少 last_delivery_sequence。未修改或跳过这些测试，也不把扩展全套报告为通过。

最小 Rust 重放：

```sh
cargo test -p rovai-core --features slow-tests --lib -j 2 -- --test-threads=2 activation_preserves_same_model_thinking pi_catalog_observations pi_model_identity runtime_check_activity model_metadata_uses_frozen_options discovered_entry_configures_and_freezes_without_health_evidence machine_ready_probe_never_sends_a_prompt
```
