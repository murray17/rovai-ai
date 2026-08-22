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
  <img
    src="docs/assets/readme/camp-conversation.png"
    alt="Rovai AI Camp 会话视图，包含会话区、执行台、队员与任务区域"
    width="900"
  >
</p>

<details>
<summary><strong>🗺️ 换到地图视图，看看队伍走到了哪里</strong></summary>

<br>

<p align="center">
  <a href="docs/assets/readme/camp-map.png">
    <img
      src="docs/assets/readme/camp-map.png"
      alt="Rovai AI Camp 地图视图，展示队员所在的探索、审阅、交付与记忆区域"
      width="900"
    >
  </a>
</p>

<p align="center">
  <sub>
    世界地图最初只是一个偶然的灵感：既然这是一场共同历险，
    也许队伍也应该拥有一张真正可以行走的地图。
    于是，探索林地、审阅塔、星火工坊和记忆馆逐渐出现在了地图中。
    未来，这里也许会出现更多有趣的地图互动，以及一些让队员在任务之外一起放松的小游戏。
  </sub>
</p>

</details>

### 接下来，他们这样一起工作

<table align="center" width="900">
  <tr>
    <td align="center" width="33%">
      <a href="docs/assets/readme/recruit-member.png">
        <img
          src="docs/assets/readme/recruit-member.png"
          alt="Rovai AI 招募伙伴"
          width="273"
        >
      </a>
      <br>
      <strong>招募伙伴</strong>
    </td>
    <td align="center" width="33%">
      <a href="docs/assets/readme/grill-duo.png">
        <img
          src="docs/assets/readme/grill-duo.png"
          alt="Rovai AI 双人追问"
          width="273"
        >
      </a>
      <br>
      <strong>双人追问</strong>
    </td>
    <td align="center" width="33%">
      <a href="docs/assets/readme/campfire.png">
        <img
          src="docs/assets/readme/campfire.png"
          alt="Rovai AI 篝火会议"
          width="273"
        >
      </a>
      <br>
      <strong>篝火会议</strong>
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

同一个 Codex 可以成为负责落地的工匠，也可以成为不断寻找反例的质疑者。<br>
同一个 Claude Code，也可以根据队伍需要承担军师、记录者或审查者。

| Agent Runtime | MCP 支持 | Skill 支持 | 队员身份保持 |
|---|---|---|---|
| [**Claude Code**](https://code.claude.com/docs/en/installation) | 兼容追加 | 兼容追加 | 原生方式支持 |
| [**Codex CLI**](https://developers.openai.com/codex/cli/) | 兼容追加 | 兼容追加 | 原生方式支持 |
| [**OpenCode**](https://opencode.ai/docs/) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**GitHub Copilot CLI**](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**Antigravity**](https://www.antigravity.google/docs/cli-getting-started) | 支持 Runtime 原生 MCP | 兼容追加 | 基于 Runtime 能力 |
| [**Kiro CLI**](https://kiro.dev/docs/cli/) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**Qoder CLI**](https://docs.qoder.com/cli/installation) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**CodeBuddy**](https://www.codebuddy.ai/docs/cli/installation) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**Qwen Code**](https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/) | 兼容追加 | 兼容追加 | Runtime compact 事件驱动 |
| [**TRAE CLI CN**](https://www.trae.cn/) | 兼容追加 | 兼容追加 | 基于 Runtime 能力 |

具体版本、能力与实测边界见：[Agent Runtime 兼容性清单](docs/runtime-compatibility.md)。

---

## 核心能力

| 核心能力 | 在 Rovai 中意味着什么 |
|---|---|
| **长期队员** | 为队员建立持续存在的名字、形象、职责、性格和 Runtime 绑定。他们不是任务结束后就消失的临时对话，而是能够在不同 Camp 和旅程中再次归队的伙伴。 |
| **Camp 协作** | 把共享会话、长期队员、Task、附件和执行状态放在同一个目标之下。队员能够回应彼此、接过已有结果，不再需要 Principal 在多个窗口之间搬运上下文。 |
| **角色化协作** | 通过 `grill-duo`、`grill-duo-with-docs`、`review-duo`、`campfire` 等 Skill，把双人追问、文档决策、代码评审和集体讨论组织成可以反复使用的团队协作方式。 |
| **Task 与责任** | 把需要继续推进的事情从一条聊天消息提升为有标题、负责人和状态的 Task。Task 可以在会话中持续更新，并在右侧详情栏中集中查看，让队伍知道什么还没有完成、现在由谁负责。 |
| **队员间交接** | 通过 @mention、默认 Lead、直接回复、公开交付和 A2A 路由，把工作交给合适的队员，也让一名队员的结论、问题和产物成为另一名队员继续行动的起点。 |
| **文件、附件与产物** | 将图片、文件和文件夹带入当前 Camp。文件夹会被保存为只读快照，原文件不会被移动；队员可以围绕同一批输入讨论，也可以把生成的头像、报告和其他产物交回队伍。 |
| **可见执行** | 公共会话与队员的独立 Run 保持区分。执行台展示工具调用、过程状态、中间结果和最终交付，让真正发生的工作不被藏在一句“任务完成”之后。 |
| **权限、证据与恢复** | 重要操作经过明确审批，执行过程留下可以复核的证据。任务被取消、失败或中断后，可以根据已有状态判断结果并继续，而不是把整段旅程重新开始。 |
| **协作记忆** | 将值得保留的决定、经验和团队习惯带到后续任务中。记忆不是无限堆积聊天记录，而是逐渐形成“这支队伍如何一起解决问题”的认识。 |

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
