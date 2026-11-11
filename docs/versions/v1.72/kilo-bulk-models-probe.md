---
document_type: implementation-record
version: v1.72
authority: non-normative-runtime-evidence
status: implemented-preview
last_updated: 2026-11-11
---

# Kilo 官方 CLI 批量模型与 effort 实测

User sequence 71 要求先试 `kilo models --verbose`，该阶段只增加原生探针和研究证据。
User sequence 75 随后明确要求替换生产目录，当前接线见[生产切换](#user-sequence-75生产切换)。
基线为主线 `3568dc1f8831eafadf937159f4cc61e146fe621d`，
独立分支 `rovai/kilo-models-bulk-probe`，worktree 为 `../rovai-ai-kilo-models-bulk-probe`。
没有生产模型输入变更，治理路径为 `none`；不创建 Version Decision、不提升平台资格。

**批量能力实测可用，CLI 与 ACP 的目录语义有差异。** 同一配置下可以一次取得所有模型
的 `variants` 键名，且在本机全部被原生 effort setter 接受；开启原生隐藏选项后，两边模型集合确实不同。
该原生阶段没有证明混合入口的端到端收益；后续生产切换采用 CLI 唯一目录来源，明确接受集合差异。

## 实际运行与一致性

官方 Kilo **7.8.27、macOS arm64**，每个用例使用独立 HOME、XDG config/data/cache/state 和 Git workspace。
同一用例的 CLI 与 ACP 使用相同二进制、环境、目录和配置。Sub2API 配置只读后复制至临时私有文件，
关闭原生进程后删除副本；没有修改本机原配置。没有启动 Rovai App/Core 或提交 `session/prompt`。

探针解析官方的“ID 行 + 格式化 JSON”输出，只保留模型 ID、`variants` 键名和校验数值；
完整模型元数据和原生 stderr 不落盘。ACP 创建一次性 Session，先遍历模型读取 effort，再对每个
advertised 档位调用原生 setter，核对返回的模型和 `effort.currentValue`，最后恢复初始选择。

| 用例 | CLI 模型数 | ACP 模型数 | ACP 可见模型的档位比较 | setter 接受的模型/档位组合数 |
| --- | ---: | ---: | --- | ---: |
| 受控小目录 | 3 | 3 | 全部一致 | 4 |
| 受控多模型目录 | 64 | 64 | 全部一致 | 126 |
| 本机 Sub2API 原生配置副本 | 325 | 325 | 全部一致 | 806 |
| 同一原生配置，开启 `hide_prompt_training_models` | 325 | 307 | 全部一致 | 766 |

受控目录覆盖不同模型的不同档位、无档位、原生禁用的 variant、带斜杠/中文的模型 ID，以及名称中的
引号和花括号。受控 Provider 收到 **0 个请求**。初次三用例和补测四用例均完成；每个用例两次 CLI
读取的 ID/档位结果稳定。未自行补充 low/medium/high 等固定档位。

开启隐藏选项后，CLI 多出 **18 个模型**，ACP 没有独有条目。官方 CLI 直接遍历 `Provider.list()`；
ACP 使用的 `/config/providers` 会再应用 `filterPromptTrainingModels`。实测对应同一差异，
不是解析失败或缺少 Provider。完整差集及每个模型的两侧档位见[白名单证据](../../research/kilo-runtime/bulk-models-7.8.27-macos-arm64.json)。

## 时间与比较边界

下表取带输出时间戳的第二次运行，单位为毫秒。CLI 的“warm”指在同一用例缓存下再启动一次
命令，仍是新进程。ACP 扫描时间仅包括会话创建之后的模型切换、读取及恢复，不包括后面的 effort
setter 验证，也不是生产 Core 的端到端耗时。

| 用例 | CLI 首次完整调用 | CLI 再次完整调用 | 再次调用最后一个 stdout chunk | ACP initialize | ACP session/new | ACP 全量扫描 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 模型 | 2016 | 2072 | 1084 | 925 | 438 | 1 |
| 64 模型 | 1990 | 2147 | 1199 | 979 | 508 | 18 |
| 原生 325 模型 | 2167 | 2232 | 2003 | 930 | 1809 | 72 |
| 原生隐藏后 307 模型 | 2222 | 2126 | 1893 | 959 | 1832 | 72 |

第一次运行的原生 CLI 完整调用为 2299/2085 ms，ACP 扫描为 120 ms。第二次原生 CLI 输出约
497 KB，最后一个 stdout chunk 在 2003 ms 到达，2232 ms 退出；不能把全部耗时都归因于等待退出。
这些是本机少量运行的观测值，不是跨机器性能保证。

原生 ACP 完整元数据交换在第二次运行约为 `930 + 1809 + 72 = 2811 ms`，CLI 单独约 2232 ms。
因此不能用“2.2 秒对 0.07 秒”比较两个完整方案。CLI 单独虽然省去临时 Session，却没有提供 ACP
的过滤后列表、Session 当前 effort 等同等事实；若仍保留 ACP，只用 CLI 补 variants，就要考虑额外
进程成本。并行可能隐藏部分成本，本轮没有实现或测量生产 Core 的并行方案。

## 原生阶段接入判断及后续修正

若产品需要提前备齐所有模型档位，官方 CLI 可以作为来源候选：以 ACP 广告的模型 ID 作精确关联，
仅补充对应模型的 variants；当前选中值和运行 setter 仍遵循原生 Session。不能直接发布 CLI 多出的
模型，或自行复制原生过滤规则来声称两边等价。

原生阶段曾建议暂不增加生产 CLI 数据入口。现有 ACP 全量扫描只是目录查询，不是对每个模型生成；
本机测量未显示扫描本身是主要成本。若目标是减少查询和特殊处理，沿已有 MiniMax/DSH 的目标模型
按需查询仍是一种选择，但原生阶段没有实施替换。也未为批量目录启动原生 HTTP 服务、扫描内部端口，
或增加常驻服务器管理。

## 原生阶段复现与交付边界

[原生探针](../../../scripts/probe-kilo-models-bulk.mjs)只依赖 Node 标准库和现有隔离环境 helper。
不加到默认回归、不新增 Rust 测试或产品依赖。可以省略原生配置参数，只跑两个受控目录。

```bash
ROVAI_KILO_MODELS_PROBE_ROOT=/absolute/fresh-empty-fixture \
ROVAI_KILO_MODELS_NATIVE_CONFIG=/absolute/native/kilo.jsonc \
node scripts/probe-kilo-models-bulk.mjs /absolute/official/kilo
```

若实际安装依赖原生 `auth.json`，可显式提供 `ROVAI_KILO_MODELS_NATIVE_AUTH` 复制到相同隔离布局；
本机配置不需要该文件。实际用例工作目录为空 Git 项目，没有项目级额外配置；带项目覆盖、环境凭据、
用户插件或远程目录变化的安装需要另行对照，不能由本轮 HOME/config 副本推定完全一致。

本轮证明官方 CLI 数据形态、相同环境下的元数据对应和原生 setter 接受，不证明各 Provider 的实际
生成参数或付费调用行为。没有验收 Linux、Windows、macOS Intel 或其他 Kilo 版本；既有资格保持。
探针已关闭所有直接子进程，补测结束没有引用夹具路径的残留进程，复制的原生 config/auth 文件为零。
仓库只保存白名单证据，不依赖临时目录长期存在。

原生阶段门禁通过：`node --check scripts/probe-kilo-models-bulk.mjs`、两轮官方原生探测、
`pnpm docs:test`（10 passed）、`pnpm docs:check`、
`DOCS_BASE_REF=3568dc1f8831eafadf937159f4cc61e146fe621d pnpm docs:check:ci` 和 `git diff --cached --check`。
生产 Rust、Renderer 和 App 未改，不重复完整构建或真实模型 smoke。
原生阶段提交为 `d41a940446771d7de70e625d7633fc8d9103a48b`；后续继续复用此 worktree。

## User sequence 75：生产切换

User sequence 73 指出批量读取无需混合，sequence 75 明确要求直接替换。前一阶段把“与 ACP 目录集合
完全一致”当成前提，混合建议过于保守；当前选择官方 CLI 作为唯一目录来源，不保留双来源目录或逐模型回退。
当前合同为 [Launch v85](../../contracts/runtime-launch-and-verification-v85.md)。

`health::refresh_model_catalog_for_selection` 的 Kilo 分支一次调用 `models --verbose`，复用原环境、
受管命令、超时/回收和目录缓存。stdout 使用既有协议容量，避免把实际约 497 KB 的目录按 64 KiB
诊断预算截断。`kilo::model_catalog` 按原生 ID 行及 JSON 对象读取，标准反序列化处理 CRLF、中文、
引号、嵌套 JSON 和不同行数；只保留名称、完整 ID 和按原生顺序的 variant 键名。
未知完整元数据不落到 ModelDescriptor，不读取原生数据库或再启动 HTTP 服务。

删除原临时 Session 全量遍历、恢复原模型 RPC 和 `_meta.rovaiModelOptions` 的重复投影。
健康观察仍只记录当前模型，完整成功标志仅由 CLI 目录提交；健康成功、失败均不能覆盖已保存的完整目录。
CLI 非零、截断、空或格式错误沿原 LKG，不回退 ACP。现有目录缓存自然刷新，不迁移历史配置或冻结 Run。

可见集合采用官方 CLI 的语义。CLI 不应用的 `hide_prompt_training_models` 也不由 Rovai 重实现，
因此原生对照中多出的 18 个条目可进入产品目录；用户原生设置文件不变。实际选择和生成仍由 Kilo 决定。
CLI 不报告当前默认模型/effort，目录的 `isDefault=false`、effort `defaultValue=null`，不拿第一项猜默认。
产品继续支持跟随原生默认与已保存的显式覆盖；Run 仍走原生 ACP Session，模型/effort setter 不变。

本机 Sub2API 的配置确实预设在 `~/.config/kilo/kilo.jsonc` 的
`provider["sub2api-rovai"].models["gpt-6"]`：默认 `options.reasoningEffort=high`，
variants 为 low/medium/high/xhigh，各自映射同名 `reasoningEffort`。
这属于原生配置声明，不是 Rovai 在线询问 Sub2API 的能力接口，也不是给全部模型套固定档位。
不在报告或仓库复制 API key、地址或完整原生配置。可用的非敏感配置片段为：

```json
{
  "options": { "reasoningEffort": "high" },
  "variants": {
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high": { "reasoningEffort": "high" },
    "xhigh": { "reasoningEffort": "xhigh" }
  }
}
```

没有新增 Rust test 函数。纯格式及泄漏边界扩展既有 grouped ACP catalog owner；
Manager/DB owner 由旧的 Kilo 扫描/恢复断言改为单次 CLI、零目录 ACP、超过 64 KiB、全部模型档位、
没有默认推断，以及坏输出/空输出/非零退出保留同一 LKG 和成功时间。旧恢复断言随其生产流程退役，
其他 Runtime、正式 ACP 选择错误、取消失败对照和迟到隔离测试保持。
真实官方 Core smoke 沿原入口更新目录断言，验证实际模型/effort 设置、生成参数与既有执行回归。

官方 7.8.27、生产 Core/bundled CLI 与受控 Provider 实跑 **40 Run：37 成功、3 按用例取消**。
目录用三个原生模型验证 low/high、medium/max 与无档位，完整打开耗时 **2482 ms**，生成请求为零。
所有条目没有伪造默认值；实际选择其他模型的 max 进入原生 variant，Provider 收到对应 `temperature=0.9`，
无档位模型仍正常执行。原审批/pure/用户插件、Steer、取消 Warm、MCP cwd、文件 Diff、输出预算和
阈值/overflow 自动压缩及冷恢复均继续通过；65 个普通模型请求逐字保留原完整 Bootstrap。
[生产白名单证据](../../research/kilo-runtime/bulk-catalog-core-7.8.27-macos-arm64.json)只保存数值、选择和关联 ID。
本轮仍未做新的付费模型、开发 App 点击或跨平台重验。

最终门禁通过：`cargo test --workspace` **484 passed / 1 既有 ignored**；
grouped catalog owner 与 `extended-tests,slow-tests` 的 Manager/DB owner 各自通过；
TypeScript、Renderer **3269 passed / 2 skipped**、Node **377 passed / 2 skipped**、Desktop build、
官方 Core smoke、Cargo format、Node 语法、文档治理 10 项、普通及指定真实 base 的文档检查、Git diff 检查通过。
首轮新增异常用例误按失败 payload 断言，而该入口实际直接返回 Err；改为断言 Err 并直接核对数据库 LKG，
保留全部三种异常，未调整生产拒绝行为或删除断言。

没有修改 Bootstrap、Formatter、Manifest、Schema、UI 组件或平台准入，治理路径仍为 `none`。
工作树为 `/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-kilo-models-bulk-probe`，状态 `ready`；
沿同一分支提交/推送。官方 Core 夹具已导出并清理，没有引用其路径的残留进程。
本轮局部可逆目录来源调整不新增 Version Decision。

## 官方依据

- [CLI Command Reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference)：官方 `models --verbose` 入口。
- [models 命令](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/cli/cmd/models.ts)：逐模型输出 ID 与 JSON。
- [ACP 目录数据](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/directory.ts)、[ACP 选项](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/config-option.ts)：当前模型 variants 到 effort 的投影。
- [Provider 路由](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts)、[原生过滤](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/kilocode/provider/model-filter.ts)：ACP 可见集合的过滤来源。
