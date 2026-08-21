<!--
落地前检查：
1. 首个公开 Release 发布后，按真实资产名称补充下载链接与签名说明。
2. Windows x64 只有在对应 Release 真实提供安装包并完成平台验收后，才标记为“可用”。
-->

<div align="center">

# Rovai AI

### 组建一支会一起成长的 Agent 队伍。

Rovai AI 让你像组建冒险团一样，招募个性鲜明的长期队员。<br>
他们围绕真实任务共同探索、讨论与行动，并在一次次旅程中逐渐形成<br>
属于这支队伍的默契与协作记忆。

<p>
  <img src="https://img.shields.io/badge/status-preview-7c6f64" alt="Preview">
  <img src="https://img.shields.io/badge/platform-macOS-111111?logo=apple&logoColor=white" alt="macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4b8f77" alt="MIT License"></a>
</p>

<p>
  <a href="#快速开始"><strong>快速开始</strong></a>
  ·
  <a href="#看看一支队伍如何开始协作"><strong>使用指南</strong></a>
  ·
  <a href="#设计理念"><strong>设计理念</strong></a>
</p>

<p>
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

</div>

---

## 故事往往是这样开始的

你先让 GPT 帮你做一份方案。

做到一半，它开始不说人话。你把回答交给另一个模型翻译，再找来第三个模型挑漏洞——最后，还是得由你决定该听谁的。

你不该成为这支队伍里最忙的传令兵。

每换一个 Agent，角色要重新解释，背景要重新粘贴。
讨论结束以后，也没有人记得刚才为什么这样决定。

在 Rovai 中，你是这支队伍的 Principal。

你可以从喜欢的游戏、电影和故事中寻找灵感，招募不同性格与分工的长期队员：

有人探索，有人质疑，有人推进，也有人记住这支队伍走过的路。

他们围绕同一个任务一起讨论和行动，也把重要的决定、分歧与合作方式，留给下一次旅程。

第一次见面时，他们只是几个分工不同的 Agent。

一起做过几次任务以后，才慢慢有了队伍的样子。

---

## 快速开始

### 1. 安装 Rovai AI

#### 从 GitHub Releases 安装

请只从 Rovai AI 的官方
[GitHub Releases](https://github.com/murray17/rovai-ai/releases)
下载安装包。

Releases 中实际出现的安装包，才代表该平台已经完成当前版本的发布验收。
如果没有看到对应平台的文件，就表示该版本尚未开放下载。

| 平台 | 在 Release 中选择 | 安装方式 |
|---|---|---|
| **macOS · Apple Silicon** | 文件名标记为 `arm64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications`，再从应用程序目录启动 |
| **macOS · Intel** | 文件名标记为 `x64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications`，再从应用程序目录启动 |
| **Windows · x64** | Release 中明确标记为 Windows x64 的 `.exe` 安装包 | 运行安装程序并按照向导完成安装；若该版本没有 Windows 资产，则表示尚未开放 |

首次启动前，请确认安装包来自官方 Release。若系统显示安全提示，请按照
对应 Release 中的签名、公证与首次启动说明操作，不要全局关闭系统安全机制。

#### 从源码运行

源码安装、环境准备、隔离数据目录与构建步骤见：

**[开发者指南](docs/development/README.md)**

最短开发入口：

```bash
git clone https://github.com/murray17/rovai-ai.git
cd rovai-ai

pnpm install --frozen-lockfile
pnpm dev
```

不要直接运行 `electron-vite dev` 绕过 Rovai 的开发数据隔离和启动检查。

---

### 2. 支持的 Agent Runtime

在 Rovai 中，**队员是谁**，和**队员通过什么 Runtime 行动**，是两个不同的层次。

名字、形象、职责、关系和协作记忆，决定这名队员是谁；<br>
Agent Runtime 则决定他通过什么工具与模型参与任务。

同一个 Codex 可以成为负责落地的工匠，也可以成为不断寻找反例的质疑者。
同一个 Claude Code，也可以根据队伍需要承担军师、记录者或审查者。

| Agent Runtime | 官方安装 | Rovai Adapter | External MCP | Skill 接入 | 上下文、System Prompt 与压缩 |
|---|---|---|---|---|---|
| **Claude Code** | [安装指南](https://code.claude.com/docs/en/installation) | 专用 Claude Code Print Adapter | **兼容追加**；保留 Runtime 原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.claude/skills`，已验证 | 以原生方式追加 Rovai Context Charter；支持续会话；没有结构化证据时不从模型文本推断压缩完成 |
| **Codex CLI** | [Codex CLI 文档](https://developers.openai.com/codex/cli/) | 专用 Codex App Server v2 Adapter | **兼容追加**；同名时保留 Codex 原生配置，跳过 Rovai 同名项 | `.codex/skills`，已验证 | 以原生方式追加 Rovai Context Charter；模型与推理强度按 Turn 选择；压缩和恢复以 App Server 与对应版本的实测证据为准 |
| **OpenCode** | [官方文档](https://opencode.ai/docs/) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.opencode/skills` 与 `.claude/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；仅在 Runtime 广告相应能力时使用 load / resume；不猜测压缩状态 |
| **GitHub Copilot CLI** | [安装指南](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.github/skills` 与 `.claude/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；恢复与压缩按 Runtime 广告和版本证据处理 |
| **Antigravity** | [官方安装指南](https://www.antigravity.google/docs/cli-getting-started) | 专用 Antigravity Companion CLI Adapter | 不投影 Rovai External MCP；不修改 Antigravity 的原生全局配置 | `.agent/skills`，已验证 | 通过非交互 CLI Run 传入任务上下文；支持续会话；不宣称未观测到的结构化压缩完成信号 |
| **Kiro CLI** | [CLI 文档](https://kiro.dev/docs/cli/) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，通过本次 Run 的 Agent 配置追加 Rovai MCP | `.kiro/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；load、resume 与压缩按 Kiro ACP 的实际能力处理 |
| **Qoder CLI** | [安装指南](https://docs.qoder.com/cli/installation) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.qoder/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；恢复与压缩按 Runtime 实测处理 |
| **CodeBuddy** | [安装指南](https://www.codebuddy.ai/docs/cli/installation) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.codebuddy/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；恢复与压缩按 Runtime 实测处理 |
| **Qwen Code** | [快速开始](https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.qwen/skills`，已验证 | Rovai 上下文进入首个 Prompt payload；恢复与压缩按 Runtime 实测处理 |
| **TRAE CLI CN** | [TRAE 官网](https://www.trae.cn/) | **通用 ACP v1 Adapter** | **兼容追加**；保留原生 MCP，本次 Run 的 Rovai 同名定义优先 | `.trae/skills`，已验证；可接收 Runtime 异步发布的 Skill / Command 目录 | Rovai 上下文进入首个 Prompt payload；已验证 Skill 目录刷新边界；尚未观测到可靠的结构化压缩完成信号，因此不从回复文本推断 |

#### MCP 接入边界

表格中的 MCP 指用户配置的 **External MCP**。

Rovai 不用 MCP 替换 Agent Runtime 的原生能力。对支持的 Adapter，External MCP
以单次 Run 的方式追加，并保留 Runtime 自己的配置；同名冲突按表格中的规则处理。

Rovai 自己的内置操作也不通过 MCP 冒充 Runtime 原生工具。它们由 bundled
`rovai` CLI 经私有本地 IPC 调用 Rovai Core，与用户的 External MCP 保持独立。

#### System Prompt 与压缩边界

不同 Runtime 暴露上下文、恢复和压缩能力的方式不同。

Rovai 不用一份粗暴的通用 System Prompt 覆盖所有 Runtime，而是通过各 Adapter
支持的原生追加或首个 Prompt payload，把队员身份、Camp 背景和执行合同交给 Runtime。

同样，Rovai 不会因为模型回复了“压缩完成”就把会话标记为已压缩。只有 Runtime
提供了足够稳定的结构化证据时，相关状态才会进入兼容性结论。

你不需要同时安装全部 Runtime。只需安装准备使用的 Agent，并按照对应产品的
官方流程完成登录或认证。

详细版本、能力与实测边界见：

[Agent Runtime 兼容性清单](docs/runtime-compatibility.md)

---

### 3. 使用指南

## 看看一支队伍如何开始协作

在 Rovai 中，队员不会被分散在一组互不相干的窗口里。

他们围绕同一个目标会合，共享正在面对的问题，接过彼此留下的结果，
并让讨论、执行和决定发生在同一段旅程中。

这个让队伍反复会合、共同工作的地方，叫作 **Camp**。

### Camp：让会话、行动与队伍待在同一个地方

Camp 有两种互相切换的观察方式：**会话**与**地图**。

会话视图用于推进真实工作；地图视图则把队员与工作阶段放进 Rovai 的世界中，
让你从另一种视角看见这支队伍正停留在哪里、准备走向哪里。

<p align="center">
  <img
    src="docs/assets/readme/camp-conversation.png"
    alt="Rovai AI Camp 会话视图，包含会话区、执行台、队员与任务区域"
    width="100%"
  >
</p>

在会话视图中：

- **会话区**<br>
  队员围绕当前 Camp 公开交流、回应彼此、发送结论与附件。重要讨论不会被拆散
  到多个彼此隔离的 Agent 窗口。

- **执行台**<br>
  每名正在行动的队员都有自己的 Run。你可以查看执行状态、工具调用、中间结果
  与最终交付，也可以继续追问或调整任务，而不必把执行日志混进公共对话。

- **队员**<br>
  Camp 的队员名单展示当前伙伴、角色、Runtime 与在线状态。你可以指定默认 Lead，
  也可以直接 @ 某位队员，让任务落到合适的人手中。

- **任务**<br>
  任务区集中承载与 Camp 相关的工作项及状态，让需要继续推进的事情不只停留在
  某一条聊天消息里。

<p align="center">
  <img
    src="docs/assets/readme/camp-map.png"
    alt="Rovai AI Camp 地图视图，队员分布在探索、审阅、审批、交付、记忆等工作区域"
    width="100%"
  >
</p>

地图视图把同一个 Camp 转化成一张可观察的旅程地图：

- **探索林地**对应研究和信息搜集；
- **观测台**用于远程观察与持续跟进；
- **审阅塔**承载 Review；
- **守门所**表示 Approval 与关键决策门；
- **河畔会合点**代表 A2A 交接；
- **星火工坊**对应 Build；
- **港湾城**面向 Delivery；
- **记忆馆**保存值得带到下一段旅程的经验；
- **协作公会**是队伍共同会合的 Home。

地图不是另一套任务系统，而是同一个 Camp 的视觉表达。你可以随时切回会话，
继续真正的讨论与执行。

---

### 招募你的伙伴

招募队员可以从一句很具体、也很有个人偏好的描述开始。

你可以描述他的外观、性格、专业能力、工作方式，以及你希望他在队伍中承担
什么角色。现有队员会帮助你把这个角色原型整理成一份可确认的长期队员方案。

<p align="center">
  <img
    src="docs/assets/readme/recruit-member.png"
    alt="Rovai AI 招募流程，从伙伴原型、头像附件确认到长期队员创建结果"
    width="100%"
  >
</p>

在确认之前，招募流程会把模糊想法逐步整理成：

- 队员名称与团队角色；
- 专业职责和协作边界；
- 性格与表达方式；
- 工作准则与成长课题；
- 头像和视觉要求；
- 适合绑定的 Agent Runtime。

你也可以让一位擅长图像生成的伙伴协助准备头像，再把生成结果作为 Camp 附件交回。

只有在 Principal 明确确认后，新伙伴才会正式入队。创建结果会说明队员身份、
角色、性格与 Runtime 状态；招募不会自动把新队员加入所有 Camp，也不会替你
改变现有 Lead。

你招募的不是一个新的聊天标签，而是一位准备长期相处的队员。

---

### 双人追问：把模糊想法追问成可执行决定

`grill-duo` 是 `grill-me` 的双人追问版本。

一个队员负责持续追问目标、限制与偏好，另一个队员从独立角度查证事实、
提出反例并检查风险。两个人不需要快速达成一致，他们的任务是把真正重要的
问题问出来。

<p align="center">
  <img
    src="docs/assets/readme/grill-duo.png"
    alt="Rovai AI 双人追问，两名队员独立查证、提出风险并帮助 Principal 形成决策"
    width="760"
  >
</p>

适合使用双人追问的场景包括：

- 方案只有大致方向，还没有形成验收标准；
- 几个选项各有利弊，需要先补齐事实；
- 一个 Agent 的结论听起来合理，但你希望有人独立反证；
- 决策会影响架构、成本、兼容性或长期维护；
- 你知道自己想做什么，却还说不清真正的约束。

`grill-duo` 不替 Principal 拍板。它负责把事实、分歧与关键问题摆到桌面上，
让最后的决定不再建立在一段含糊的模型回复上。

---

### 篝火会议：让整支队伍一起来讨论

当问题不适合交给一个人回答时，可以发起 `campfire`。

篝火会议会先收集每位队员的独立观点，让他们从自己的职责出发给出判断，
再整理已经形成的共识、仍然存在的分歧、证据缺口与下一步选择。

<p align="center">
  <img
    src="docs/assets/readme/campfire.png"
    alt="Rovai AI 篝火会议，多名队员提交独立观点并形成共识、分歧和下一步建议"
    width="760"
  >
</p>

在一场篝火会议中：

1. Principal 提出需要集体判断的问题；
2. 每名队员先给出独立观点，避免最先发言的人过早影响所有人；
3. 队员根据各自角色补充证据、指出风险和提出改变判断的条件；
4. Lead 整理共识与分歧；
5. Principal 决定继续行动，还是先补齐证据。

篝火会议的目标不是让所有人说出同一个答案，而是让队伍知道：

- 哪些事实已经足够可靠；
- 哪些风险仍然没有解决；
- 谁对什么问题最有发言权；
- 下一步应该行动、试验，还是继续调查。

---

## 设计理念

### 队员不等于模型

模型与 Runtime 提供能力，但名字、性格、职责、关系与共同经历，才决定
一名队员是谁。

Rovai 让同一个 Runtime 在不同队伍中承担完全不同的角色，而不是把产品简化
成一排模型切换按钮。

### 团队不是并排打开的聊天框

多个 Agent 同时存在，不代表他们已经组成团队。

真正的协作需要共享目标、明确角色、可见的交接，以及一个能够持续返回的 Camp。

### 差异不是噪音

一支队伍的价值，来自队员之间真实存在的差异。

军师、斥候、质疑者、行动者和记录者不需要给出相同答案。分歧应该被看见、
被追问，并最终帮助 Principal 作出更好的决定。

### 讨论必须能够走向行动

Rovai 不把多人讨论停留在一串看起来热闹的消息里。

队伍需要把共识转化成执行，让执行保持可见，并在中断后知道从哪里继续。

### 协作记忆从共同经历中生长

真正有价值的团队记忆，不只是把聊天记录无限堆积起来。

它来自一次次任务中的选择、分歧、结果与教训，并逐渐回答：

- 谁最适合先去探索；
- 谁能发现被忽略的风险；
- 谁能把争论推进成决定；
- 这支队伍过去是怎样一起完成任务的。

---

## 继续这段旅程

| 你想做什么 | 从这里开始 |
|---|---|
| 招募队员、配置身份、职责与 Runtime | [招募你的伙伴](#招募你的伙伴) |
| 准备本地开发环境并运行 Rovai | [开发环境与依赖](docs/development/environment.md) |
| 提交 Issue、改进代码或参与文档建设 | [GitHub Issues](https://github.com/murray17/rovai-ai/issues) |
| 阅读架构选择、约束与跨版本决策 | [当前决策导航](docs/decisions/CURRENT.md) |
| 了解项目与第三方组件的授权边界 | [MIT License](LICENSE) · [Third-Party Notices](THIRD_PARTY_NOTICES.md) |

第三方产品名称、Logo 与商标仍归各自权利人所有。Rovai 对它们的引用仅用于
说明兼容性，不代表隶属、背书或所有权。
