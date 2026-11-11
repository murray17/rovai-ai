---
document_type: research-record
version: v1.72
authority: non-normative-runtime-evidence
status: investigated
last_updated: 2026-11-11
---

# Kilo 官方 CLI 批量模型与 effort 实测

User sequence 71 要求先试 `kilo models --verbose`。本轮只增加可复现原生探针和研究证据，
未替换生产目录采集方式。基线为主线 `3568dc1f8831eafadf937159f4cc61e146fe621d`，
独立分支 `rovai/kilo-models-bulk-probe`，worktree 为 `../rovai-ai-kilo-models-bulk-probe`。
没有生产模型输入变更，治理路径为 `none`；不创建 Version Decision、不提升平台资格。

**批量能力实测可用，但 CLI 原始列表不能直接替代 ACP 目录。** 同一配置下可以一次取得所有模型
的 `variants` 键名，且在本机全部被原生 effort setter 接受；开启原生隐藏选项后，两边模型集合确实不同。
本轮没有证明将 CLI 增加为第二个数据入口能改善 Rovai 的端到端性能，暂不切换生产实现。

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

## 接入判断

若产品需要提前备齐所有模型档位，官方 CLI 可以作为来源候选：以 ACP 广告的模型 ID 作精确关联，
仅补充对应模型的 variants；当前选中值和运行 setter 仍遵循原生 Session。不能直接发布 CLI 多出的
模型，或自行复制原生过滤规则来声称两边等价。

本轮建议暂不增加生产 CLI 数据入口。现有 ACP 全量扫描只是目录查询，不是对每个模型生成；
本机测量未显示扫描本身是主要成本。若目标是减少查询和特殊处理，沿已有 MiniMax/DSH 的目标模型
按需查询仍更直接，但本轮没有实施这项替换。也未为批量目录启动原生 HTTP 服务、扫描内部端口，
或增加常驻服务器管理。

## 复现与交付边界

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

门禁通过：`node --check scripts/probe-kilo-models-bulk.mjs`、两轮官方原生探测、
`pnpm docs:test`（10 passed）、`pnpm docs:check`、
`DOCS_BASE_REF=3568dc1f8831eafadf937159f4cc61e146fe621d pnpm docs:check:ci` 和 `git diff --cached --check`。
生产 Rust、Renderer 和 App 未改，不重复完整构建或真实模型 smoke。
worktree 交付状态为 `ready`，保留独立分支供后续判断，不自动创建 PR。

## 官方依据

- [CLI Command Reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference)：官方 `models --verbose` 入口。
- [models 命令](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/cli/cmd/models.ts)：逐模型输出 ID 与 JSON。
- [ACP 目录数据](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/directory.ts)、[ACP 选项](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/acp/config-option.ts)：当前模型 variants 到 effort 的投影。
- [Provider 路由](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts)、[原生过滤](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/opencode/src/kilocode/provider/model-filter.ts)：ACP 可见集合的过滤来源。
