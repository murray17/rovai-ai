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

做到一半，它开始不说人话。你把回答交给另一个模型翻译，
再找来第三个模型挑漏洞——最后，还是得由你决定该听谁的。

每换一个 Agent，角色要重新解释，背景要重新粘贴。<br>
讨论结束以后，也没有人记得刚才为什么这样决定。

> **一支队伍不该每次出发时，都重新认识彼此。**

在 Rovai 中，你是这支队伍的 **Principal**。

你可以从喜欢的游戏、电影和故事中寻找灵感，招募不同性格与分工的长期队员：

**有人探索，有人质疑，有人推进，也有人记住这支队伍走过的路。**

他们围绕同一个任务一起讨论和行动，也把重要的决定、分歧与合作方式，
留给下一次旅程。

第一次见面时，他们只是几个分工不同的 Agent。

**一起做过几次任务以后，才慢慢有了队伍的样子。**

---

## 看看一支队伍如何开始协作

这一次，我们招募到了四位伙伴：

> **游学者叮叮**——听说狐狸就是这么叫的；<br>
> **爱反驳的芝士**——呃，一只雪豹；<br>
> **猫头鹰咕咕**——总能从别人没想到的角度看问题；<br>
> **绘画师小兔**——负责把沿途所见画下来。

他们带着不同的脾气和本事，第一次在同一个 **Camp** 中见面。

### 初次集结

队伍的第一件事，不是马上分头行动，而是先知道彼此是谁、这次要做什么，
以及谁适合先开口。

<p align="center">
  <a href="docs/assets/readme/camp-conversation.png">
    <img
      src="docs/assets/readme/camp-conversation.png"
      alt="游学者叮叮、雪豹芝士、猫头鹰咕咕和绘画师小兔第一次在 Rovai AI Camp 中会合"
      width="100%"
    >
  </a>
</p>

<p align="center">
  <sub>叮叮、芝士、咕咕和小兔第一次在 Camp 中会合。点击图片查看完整截图。</sub>
</p>

<details>
<summary><strong>🗺️ 换到地图视图，看看队伍走到了哪里</strong></summary>

<br>

地图把同一个 Camp 中的探索、审阅、审批、交接、交付与记忆，
变成旅程中的不同地点。它不是另一套任务系统，只是换一个角度观察
队伍正停留在哪里、准备走向哪里。

<p align="center">
  <a href="docs/assets/readme/camp-map.png">
    <img
      src="docs/assets/readme/camp-map.png"
      alt="Rovai AI Camp 地图视图，展示队员所在的探索、审阅、交付与记忆区域"
      width="900"
    >
  </a>
</p>

</details>

### 接下来，他们这样一起工作

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="docs/assets/readme/recruit-member.png">
        <img
          src="docs/assets/readme/recruit-member.png"
          alt="Rovai AI 队员招募流程"
          width="100%"
        >
      </a>
      <p align="center">
        <strong>招募伙伴</strong><br>
        <sub>Member Studio</sub>
      </p>
      <p>
        队员不是模型列表里的另一个名字。你先描述想遇见怎样的伙伴，
        再确认他的身份、性格、职责、头像与 Runtime。
      </p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/assets/readme/grill-duo.png">
        <img
          src="docs/assets/readme/grill-duo.png"
          alt="Rovai AI grill-duo 双人追问"
          width="100%"
        >
      </a>
      <p align="center">
        <strong>把问题问到底</strong><br>
        <sub>grill-duo</sub>
      </p>
      <p>
        一个队员负责追问，另一个负责反驳。两种视角互相较劲，
        直到模糊的想法被磨成能够行动的决定。
      </p>
    </td>
    <td width="33%" valign="top">
      <a href="docs/assets/readme/campfire.png">
        <img
          src="docs/assets/readme/campfire.png"
          alt="Rovai AI campfire 篝火会议"
          width="100%"
        >
      </a>
      <p align="center">
        <strong>围着篝火形成方向</strong><br>
        <sub>campfire</sub>
      </p>
      <p>
        遇到需要整支队伍判断的问题，伙伴们先独立表达观点，
        再把共识、分歧和证据缺口放到一起，由 Principal 决定下一步。
      </p>
    </td>
  </tr>
</table>

<p align="center">
  <sub>点击任意图片查看完整截图。</sub>
</p>

第一次集结时，他们只是性格与分工不同的伙伴。

随着一次次讨论、行动与交接，这些差异才慢慢变成队伍之间的默契。

---

## 快速开始

### 1. 安装 Rovai AI

#### 桌面安装包（推荐）

请从 [GitHub Releases](https://github.com/murray17/rovai-ai/releases)
下载与你的设备匹配的安装包。

| 平台 | 在 Release 中选择 | 安装方式 |
|---|---|---|
| **macOS · Apple Silicon** | 文件名标记为 `arm64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications`，再从应用程序目录启动 |
| **macOS · Intel** | 文件名标记为 `x64` 的 `.dmg` | 打开 DMG，将 Rovai AI 拖入 `Applications`，再从应用程序目录启动 |
| **Windows · x64** | Release 中明确标记为 Windows x64 的 `.exe` 安装包 | 运行安装程序并按照向导完成安装 |

#### 从源码运行（开发者）

源码安装、环境准备、隔离数据目录与构建步骤见：[**开发者指南**](docs/development/README.md)

最短开发入口：

```bash
git clone https://github.com/murray17/rovai-ai.git
cd rovai-ai

pnpm install --frozen-lockfile
pnpm dev
```

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
| 招募队员、配置身份、职责与 Runtime | [看看队伍如何一起工作](#接下来他们这样一起工作) |
| 准备本地开发环境并运行 Rovai | [开发环境与依赖](docs/development/environment.md) |
| 提交 Issue、改进代码或参与文档建设 | [GitHub Issues](https://github.com/murray17/rovai-ai/issues) |
| 阅读架构选择、约束与跨版本决策 | [当前决策导航](docs/decisions/CURRENT.md) |
| 了解项目与第三方组件的授权边界 | [MIT License](LICENSE) · [Third-Party Notices](THIRD_PARTY_NOTICES.md) |

第三方产品名称、Logo 与商标仍归各自权利人所有。Rovai 对它们的引用仅用于
说明兼容性，不代表隶属、背书或所有权。
