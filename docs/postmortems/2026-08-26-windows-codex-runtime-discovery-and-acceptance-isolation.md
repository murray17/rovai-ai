---
document_type: postmortem
incident_id: INC-2026-08-26-WINDOWS-CODEX-DISCOVERY
incident_date: 2026-08-26
status: closed
systems:
  - windows-runtime-discovery
  - codex-runtime-adapter
  - managed-runtime-process
  - windows-packaged-app
  - acceptance-tooling
last_updated: 2026-08-26
---

# Windows Codex Runtime 发现与验收隔离缺口

> **爱丽丝的小结：** 这次不是 npm 装坏了，也不是用户的 override 做错了；产品的发现地图漏了
> live PATH 与 command shim，验收清单又漏了更高优先级来源。Exact parser 安全地停住之后，
> 我们补齐已验证路径，也让产品与验收共用同一张路网。

## 摘要

2026-08-25 至 2026-08-26，在真实 Windows x64 Host 上进行 release-candidate 验证时，发现了
两类与 Codex Runtime discovery 有关的缺口。第一，既有产品模型复用 Desktop 进程继承的
`PATH`，且只准入原生 `.exe`，因此无法可靠发现 Rovai 启动后新安装的官方 Codex，或 npm/pnpm
生成的 `codex.cmd` entrypoint。第一版安全 npm 实现也只识别此前观测到的 npm shim 模板，没有
覆盖 npm 11.17.0 生成的另一种有效模板；exact-template parser 正确 fail closed，UI 因而继续
显示 Codex Missing。

第二，本地 acceptance harness 最初没有隔离产品 discovery precedence 中的每一个来源。
Codex standalone package 目录中的原生 binary 会让所谓 clean baseline 仍然 available。之后，
预先存在的用户级 `ROVAI_CODEX_BIN` 又指向暂时移走的官方 executable。该 Adapter override
有意作为 terminal candidate set，因此正确地抑制了自动 npm/PATH discovery，却让已修复构建
看起来仍然失效。Harness 保留了 override，却没有把清除与恢复它纳入测试边界。

产品修正现在会在每次 rescan 时，依据 inherited、HKCU User、HKLM Machine 与 known-location
path 重建不可变 Windows search environment；只准入封闭的 `.exe/.cmd/.bat` entrypoint 集合；
并把经过窄验证的 npm/pnpm Codex locator 解析为真实原生 `codex.exe`。Parser 同时接受 legacy
与 npm 11.17.0 的精确 shim 形态，并继续验证 package containment、metadata、interpreter、
locator content 与 native-target identity。Generic command shim 仍保留显式 managed-process
identity，不会被误述为原生 executable。

Acceptance harness 同时隔离 standalone binary 与 `ROVAI_CODEX_BIN` 后，运行中的打包 Rovai
构建到达真实 Missing baseline。npm 11.17.0 随后安装 `@openai/codex` 0.149.1；在不重启 Rovai
的情况下点击 Rescan，系统解析出 platform package 的原生 Windows executable，报告
`codex-cli 0.149.1` 并到达 `ready`。原先的官方与 standalone 0.148.0 安装及用户 override 均
恢复；临时 npm 安装被移除。修复通过
[PR #64](https://github.com/murray17/rovai-ai/pull/64) 合并。

这是一次阻断发布的本地验证事故与 near miss，并非生产 outage。没有删除 Codex 认证/配置、
Rovai 数据库数据或用户工作。复盘不归咎个人：问题来自不完整的跨平台 discovery 与 acceptance
不变量，不来自用户操作、npm 或有效的 override fail-closed 行为。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户在验证修复后的 Windows package 时，通过官方 installer 与 npm 移除并重新安装 Codex |
| 受影响路径 | Windows Runtime Search Environment capture、Codex `.cmd` locator 检查、Settings rescan 与本地 acceptance preparation/restore |
| 产品触发条件 | Codex 在 Desktop 启动后安装，或由旧 discovery model 不准入的 Windows command shim 暴露 |
| 验收中发现的残余触发 | npm 11.17.0 生成了 exact-template allowlist 未包含的有效 shim 形态 |
| 验收触发条件 | Harness 声称已建立 clean automatic-discovery baseline 时，standalone executable 或旧 terminal `ROVAI_CODEX_BIN` 仍然活跃 |
| 用户可见症状 | 所谓 Missing baseline 仍然 available，或有效官方/npm 安装在 Rescan 后仍显示 Missing |
| 直接测量范围 | 一台使用打包 App、官方 installer 与 npm global package 的 Windows x64 验收 Host |
| 数据完整性 | 隔离过程未修改 Rovai 数据与 `%USERPROFILE%\.codex` auth/config；所有保留的安装和 override 状态均恢复 |
| 安全影响 | 未执行任意 shim；未知 shim content fail closed，未发现凭据披露 |
| 解决方案 | Windows discovery 与 managed command-shim 变更以 [`faadd804`](https://github.com/murray17/rovai-ai/commit/faadd804bcf0c70fefd19a587a61ba0725940a61) 合并 |
| 事故持续时间 | 未计算；并非所有发现与恢复里程碑都保留了结构化时间戳 |

## 影响

直接影响是 Windows 发布验证延迟，且验收结果彼此矛盾。Operator 无法相信界面上的 Missing 或
Available 是否代表预期 candidate source。重启有时看似会改变结果，因为新进程继承更新后的
User PATH；但重启不能替代要求中的 Rescan 语义。

修复前，已经运行的 Rovai 实例可能发现不了新安装的官方 Codex；package manager 通过
`codex.cmd` 暴露 Codex 的用户，即使新 Terminal 能解析命令，也可能仍显示 Missing。最终验收
期间，旧显式 override 一度掩盖产品修复；这影响的是测试结论，而不是要求产品增加 fallback，
因为显式 override 失败后本来就应保持 terminal。

没有生产/客户 outage 或未授权进程启动的证据。Parser 拒绝了新观测到的 npm 形态，没有执行
或猜测其内容。恢复时没有移除 Camp、Conversation、AgentRun、Runtime binding、Codex Home、
认证文件或用户配置。验收 workflow 对 executable source 使用可恢复备份，并恢复测试前安装状态。

## 发现与响应

事故由真实 Host 序列发现，而非 unit test：准备 Missing baseline，从官方渠道安装，rescan
运行中的 App，恢复 Missing，再通过 npm 安装并再次 rescan。第一次 preparation 还遇到 Codex
Desktop 拥有的无关 `codex.exe` 进程；随后缩小 harness，使单凭进程名不能定义 Rovai Runtime
candidate。

npm 安装完成但 Rescan 仍为 Missing 时，生成的 `codex.cmd` 被拿来与 Core 中精确模板比较。
npm 11.17.0 把 `PATHEXT` 更新放入 conditional branch，并生成不同于 legacy 模板的最后一行。
目标 package、metadata 与 native executable 其余部分均有效。修复选择增加第二个精确模板，
而不是放宽 parsing 或执行 script。

重建并安装该变更后，另一次 Missing 结果沿完整 candidate precedence 追踪到用户级
`ROVAI_CODEX_BIN`：它仍选择旧官方路径。Acceptance 边界先 snapshot 该变量供恢复，再清除它，
自动 npm discovery 才得以执行。随后已运行的 App 在 Rescan 上成功，证明无需重启 Rovai。

响应过程把 `%USERPROFILE%\.codex` 排除在隔离边界外，只把已知 executable source 移到可恢复
备份，记录选中的 shim 与 native target，并在验证后恢复原始官方安装、standalone package 与
environment override。

## 时间线

所有时间均为 Asia/Hong_Kong。未保留为结构化证据的时间保持不精确。

| 时间 | 事件 |
|---|---|
| 2026-08-25 18:01 | Commit [`a0186adb`](https://github.com/murray17/rovai-ai/commit/a0186adbed5896aaa309325175a9beb6e8b0e5bf) 增加官方 Windows Codex known location。 |
| 2026-08-25 18:59 | Commit [`263ec840`](https://github.com/murray17/rovai-ai/commit/263ec840481e071fd5594d73b1b1241a412f7453) 增加 Registry PATH hydration 与初始 npm Codex discovery。 |
| 2026-08-25 22:31 | Commit [`9548fffb`](https://github.com/murray17/rovai-ai/commit/9548fffb19c146bb6c9ad960c9b2a9bec35fb25c) 完成封闭 Windows command-shim identity 与 managed launch 支持。 |
| 2026-08-26 00:32 | Acceptance harness 捕获可恢复状态，并开始在 Windows Host 上建立 clean Missing baseline。 |
| 2026-08-26，准备后 | 遗留的 standalone Codex executable 让 baseline 仍为 available。Harness 被缩小到隔离该 executable source，且不枚举或移动 Codex auth/config。 |
| 2026-08-26，npm 验收期间 | npm 11.17.0 成功安装 `@openai/codex` 0.149.1，但 exact-template parser 不识别当前 npm shim，Rescan 仍为 Missing。 |
| 2026-08-26 01:13 | Commit [`f5393f31`](https://github.com/murray17/rovai-ai/commit/f5393f31827043029613743d32636ade72eea2c3) 在保留精确验证的同时增加当前 npm 模板。 |
| 2026-08-26，重建 package 安装后 | Rescan 看似仍失败。Candidate precedence 检查发现保留的用户 `ROVAI_CODEX_BIN` 选择已移走的官方路径，并有意抑制 PATH discovery。 |
| 2026-08-26，最终验收 | Harness snapshot 并清除 override。运行中的 App 先到达 Missing，再在无需重启的 Rescan 中发现 npm shim 的 native target，报告 Codex 0.149.1 ready。 |
| 2026-08-26 01:23 | Linux Clippy 暴露跨平台 lint failure 后，commit [`03f76cf5`](https://github.com/murray17/rovai-ai/commit/03f76cf555116027c2ad76f0759a4fc104e66b98) 正确 gate Windows-only helper。 |
| 2026-08-26 01:27 | 文档治理、Rust format/Clippy、fast test、database smoke 与 Windows x64 compile check 通过后，PR #64 合并。 |
| 2026-08-26，验证后 | 临时 npm 安装被移除；原始官方与 standalone Codex 0.148.0 安装及用户 override 恢复；验收状态移入 Recycle Bin。 |

## 技术根因

产品与验收失败具有相关但不同的系统性原因。

### 产品 discovery model 不完整支持 Windows

此前 search environment 实际在 Desktop 启动时冻结：

```text
Desktop 继承 PATH
  -> 只搜索原生 executable name
  -> cache discovery result
```

官方 Windows installer 会为未来进程更新 User PATH，却不会追溯修改已经运行的 Rovai 进程所
继承的环境。npm/pnpm 通常通过 `codex.cmd` 暴露 package，而不是顶层同目录 `codex.exe`。
因此，旧 model 会因不同原因错过这两条受支持安装路径。

产品的系统性根因，是把 executable discovery 当成近似 Unix 的 PATH lookup，而不是包含显式
Windows entrypoint identity 的 Host-specific、不可变 search-environment capture。仅增加 PATHEXT
行为会扩大 discovery，却无法保留启动所需的 executable、interpreter、argv 与 process ownership
保证。

第一版安全 npm 实现有意只允许已知 shim 的精确字节，并在解析 native target 前验证 package
containment 与 metadata。Fixture 表示 legacy npm 模板，而 npm 11.17.0 生成了第二种有效模板，
其中 `PATHEXT` 的 control-flow 位置不同。Compatibility set 不完整，因此 parser 将 shim 分类为
unverified 并 fail closed。这是覆盖缺口，不是放松验证的理由。

### Acceptance 没有隔离同一 precedence model

预期验收状态为：

```text
explicit/manual source absent
Adapter override absent
official 与 standalone source absent
npm/pnpm source absent
PATH/known-location winner absent
  -> Codex Missing
```

第一版 harness 集中于官方与 package-manager 安装，没有完整证明 standalone executable source
缺失。它还保留 `ROVAI_CODEX_BIN`，却让变量在 automatic-discovery 测试期间继续活跃。由于
Adapter override 是 terminal candidate set，旧 override 正确阻止 fallback 到新安装的 npm candidate。

验收的系统性根因，是维护了一套与产品分离且不完整的 discovery precedence 心智模型，而
不是从产品的封闭 candidate set 派生 baseline checklist。Harness 因此可能报告 filesystem
preparation 完成，但运行中的产品仍有更高优先级 source。

## 促成因素

### Unit fixture 只覆盖旧 npm generator 形态

Parser 针对一个已观测 npm 模板测试，却没有真实 package-manager install gate 在 packaged-App
验收前，将当前生成的 Windows shim 与封闭 allowlist 比较。

### 最初把进程名当作过宽证据

Codex Desktop 也运行名为 `codex.exe` 的进程。即使进程路径与 Rovai Runtime candidate 或待
移动 executable source 无关，把任何同名进程都当 blocker 仍会延迟 preparation。

### 显式 override 状态容易遗漏

`ROVAI_CODEX_BIN` 是持久用户环境，而可见的 install/uninstall 操作发生在 filesystem 与 package
manager。该变量不会出现在 npm 成功输出中，却比新安装 package 有更高 discovery precedence。

### 可见状态没有解释 winning candidate set

Settings 只显示 Missing/Available，没有直观说明 terminal Adapter override 阻止了自动 candidate。
诊断必须检查 environment 与结构化 discovery evidence。

### 重启可能意外掩盖原始缺口

Installer 改变 User PATH 后重启 Rovai，会让新进程继承的 PATH 看似正确。这会掩盖 Rescan 本身
应捕获当前 Registry PATH 的要求，也无法验证预期的无需重启行为。

## 既有防护为何没有阻止事故

- 既有 discovery test 对 native executable 很强，却没有建模完整 Windows installer 与 command-shim ecosystem。
- Exact-template validation 安全失败，但 compatibility fixture 未在真实 Host 验收前同步当前 npm generator 模板。
- Acceptance script 按预期保留 Codex auth/config，却使用了比产品 discovery 更窄的 executable-source allowlist。
- Harness 检查 install path 与 package manager 前，没有先中和所有更高优先级显式 source。
- CI 可以验证 compile 与 deterministic fixture，却没有在真实 Windows Host 安装当前 npm package，并在已运行打包 App 中执行 Rescan。
- UI state 无法区分“没有 automatic candidate”和“失败的显式 override 抑制了 automatic candidate”。

## 不属于根因的事项

- npm 安装没有损坏；它成功安装 `@openai/codex` 0.149.1 及 Windows x64 platform package。
- 当前 npm shim 并非恶意或 malformed；它只是封闭 compatibility set 未包含的有效 generator variant。
- `ROVAI_CODEX_BIN` 的 terminal 行为不是产品 bug。显式 override 失败后 fallback 会静默替换用户选中的安装。
- 最终修复与正确验收隔离完成后，无需重启 Rovai；live Rescan 找到了 npm 安装。
- 无关 Codex Desktop 进程不提供 Runtime candidate，也无需为 discovery validation 终止。
- `%USERPROFILE%\.codex` 下的 Codex auth/config、Rovai database content 与旧 UI snapshot 没有导致 parser mismatch。
- 较早的官方 installer 下载延迟没有导致 npm discovery failure。

## 解决与恢复

合并变更建立了一条 Windows-specific discovery 与 launch chain：

1. 每次 startup/rescan 都把 inherited PATH、当前 HKCU User PATH、当前 HKLM Machine PATH 与
   known location 捕获为新的不可变 search environment，且不修改 Registry 或 Core 全局环境。
2. Candidate extension 封闭为 `.exe`、`.cmd` 与 `.bat`，使用稳定 precedence，不进行
   PowerShell/PATHEXT 扩展。
3. 只在有界大小内读取已知 Codex npm/pnpm `codex.cmd`，并与受支持精确模板匹配，包括两种
   已观测 npm variant。
4. Package entrypoint、platform dependency metadata、containment、固定 vendor path、interpreter、
   locator content 与 native target identity 必须全部通过，Core 才把 Installation、Probe 与 launch
   绑定到原生 `codex.exe`。
5. 其他有界 `.cmd/.bat` candidate 保留不同的 `windows_command_shim` identity，只能通过 Managed
   Runtime Process serializer 与规范 System32 interpreter 启动。
6. Locator 或 target 改变会使旧 Ready evidence 失效，并要求重新 probe。

最终 packaged-App acceptance 在真实 Windows Host 证明：

```text
prepared source 与 override 已隔离 -> Codex Missing
npm 11.17.0 安装 @openai/codex 0.149.1
运行中的 Rovai：Rescan
  -> 识别 npm codex.cmd
  -> 选择 @openai/codex-win32-x64 原生 codex.exe
  -> reportedVersion = codex-cli 0.149.1
  -> pathState = valid
  -> availability = ready
```

恢复过程还原测试前用户状态，而不是保留验证配置。原始官方与 standalone 0.148.0 executable、
`ROVAI_CODEX_BIN` 值均恢复；测试 npm package 被卸载；可恢复 acceptance workspace 移入
Recycle Bin。

## 做得好的地方

- Exact-template validation 在不执行未知 script、也不猜测 native child target 的情况下拒绝未知形态。
- 测试使用打包 Windows App、真实官方 installer/npm package 与已经运行的进程，而非只依赖 fixture。
- 最终测试直接证明用户需求：Rescan 无需 App 重启即可发现新安装。
- Candidate identity evidence 保留 npm locator，并把正式执行绑定到原生 Windows target。
- Acceptance isolation 排除 Codex auth/config，并对 executable source 使用可恢复移动。
- 恢复后验证原始安装与 environment state。
- Linux Clippy 在合并前发现未正确 gate 的 Windows-only helper；修正后五项 PR check 均通过。

## 可以改进的地方

- 仓库自有 Windows acceptance 应在把 baseline 标为 Missing 前枚举每一层 discovery precedence。
- 应通过 release-candidate smoke 或 fixture 更新策略覆盖当前 npm/pnpm generator 形态，同时继续 exact parsing fail closed。
- Runtime diagnostic 应在不暴露完整用户路径或秘密的前提下，说明哪个 terminal candidate set 胜出，以及为何不考虑低优先级 candidate。
- Acceptance evidence 应记录结构化 detection、mitigation、validation、restore、App build、selected locator 与 selected native-target 时间。
- Process blocker 应绑定到正在变更的具体 executable source/ownership，而不能只看共享进程名。

## 幸运之处

- 缺陷在本地 release acceptance 中被发现，尚未进入更广 Windows 分发。
- 未识别 npm 模板 fail closed；宽松 parser 可能执行任意 command file，却声称它具有原生 Codex identity。
- 旧显式 override 产生可见 failure，而没有静默选择非预期 fallback 安装。
- Host 同时保留官方与 npm 安装选项，使 discovery precedence 与无需重启行为可在一个 Session 复现。
- Acceptance workflow 有可恢复备份，因此无需重建凭据或配置即可恢复用户原始安装与 override。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。任何开放事项开始前，责任角色都必须映射到具体维护者。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| WCD-01 | 每次 Windows search capture 都 hydrate 当前 HKCU/HKLM PATH，并增加官方 Codex known location | Runtime Platform | P0 | 已完成 | `runtime_discovery.rs`；PR #64；V1.28-D11 |
| WCD-02 | 只准入 `.exe/.cmd/.bat`，并在 managed launch 中保留 native、resolved-locator 与 generic command-shim identity | Runtime Platform | P0 | 已完成 | `runtime_discovery_windows.rs`；`windows_runtime_entrypoint.rs`；Managed Runtime Process v1 |
| WCD-03 | 在不放松 exact-template、package-containment、metadata 或 target 检查的情况下接受 npm 11.17.0 Codex shim | Codex Runtime | P0 | 已完成 | Commit `f5393f31`；`npm_cmd_shim_resolves_to_real_codex_executable` 覆盖两种 npm variant |
| WCD-04 | Gate Windows-only discovery helper，使非 Windows Clippy 保持 clean | Runtime Platform | P0 | 已完成 | Commit `03f76cf5`；PR CI |
| WCD-05 | 在真实打包 Windows 构建上证明 Missing -> npm install -> live Rescan -> Ready -> restore | Release Engineering | P0 | 已完成 | 上文汇总的 npm 11.17.0 / Codex 0.149.1 acceptance record |
| WCD-06 | 增加仓库自有 Windows discovery acceptance procedure，snapshot、isolate、attest 并 restore 每个 candidate set，包括 standalone package 与 Adapter override | Release Engineering | P1 | 已计划 | 目标：下一版 Windows Runtime acceptance |
| WCD-07 | 在 Windows release-candidate smoke 中测试当前生成的官方 npm/pnpm shim，并保留 exact-template review | Runtime Platform | P1 | 已计划 | 目标：Windows Runtime release gate |
| WCD-08 | 暴露脱敏 discovery winner/rejection 解释，尤其说明 terminal explicit-override suppression | Core Observability | P2 | 已计划 | 目标：diagnostics 规划 |
| WCD-09 | 为阻断发布的本地 acceptance failure 记录结构化事故与恢复时间 | Release Engineering | P2 | 已计划 | 目标：更新 incident/acceptance 模板 |

## 复发判据

在受支持 Windows Host 出现以下任一情况，即视为本事故复发：

- Rovai 启动后新加入的官方 Codex 安装无法通过 Rescan 发现；
- 受支持 npm/pnpm Codex shim 符合封闭 compatibility contract，却无法解析到已验证原生 Windows target；
- 未知或已变化的 shim 被执行、猜测解析，或被表示为原生 Codex identity；
- Locator content 或解析 target 改变后，旧 Ready evidence 没有撤销；
- manual path 或 Adapter override 失败后，automatic discovery 仍执行 fallback；
- Acceptance 未证明 explicit/manual、Adapter override、official、standalone、npm/pnpm、Registry PATH 与 known-location source 均不存在，就把 baseline 标为 Missing；或
- Acceptance restore 使 installation、environment override、auth 或 config state 与记录的测试前状态不同。

## 经验

Runtime discovery 不只是 PATH lookup。在 Windows 上，它是版本化安全边界，组合 process
environment、Registry state、file type、script generator shape、package metadata、interpreter
identity 与 native launch ownership。安全支持 package-manager entrypoint，意味着把 shim 当作
经过验证的 locator evidence，而不是执行任意 script 的许可，也不是把 Node 伪装为 Runtime。

Acceptance 必须实现与产品相同的 precedence model。Clean baseline 是每个 candidate set 都经
证明缺失，而不只是 installer directory 为空。最后，无需重启的 Rescan 必须从已经运行的打包
App 测试；若先重启，恰好会抹掉该功能需要处理的环境差异。

## 参考资料

- [PR #64：Windows Codex 默认 discovery](https://github.com/murray17/rovai-ai/pull/64)
- [Merge commit `faadd804`](https://github.com/murray17/rovai-ai/commit/faadd804bcf0c70fefd19a587a61ba0725940a61)
- [V1.28-D11：Windows Runtime discovery](../versions/v1.28/decisions.md#v1-28-d11)
- [Windows Desktop Platform 架构](../architecture/windows-desktop-platform.md)
- [Runtime catalog 与 Installation 不变量](../architecture/foundational-invariants.md#runtime-catalog-installation)
- [Runtime process verification 不变量](../architecture/foundational-invariants.md#runtime-process-verification)
- [Runtime platform security 不变量](../architecture/foundational-invariants.md#runtime-platform-security)
- [Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md)
- [Windows Runtime discovery 实现](../../crates/rovai-core/src/runtime_discovery_windows.rs)
- [跨平台 Runtime discovery 实现](../../crates/rovai-core/src/runtime_discovery.rs)
- [Windows Runtime entrypoint identity](../../crates/rovai-core/src/windows_runtime_entrypoint.rs)
- [官方 Codex CLI 安装文档](https://learn.chatgpt.com/docs/codex/cli)
