<div align="center">

# Rovai AI

### 组建一支会一起成长的 Agent 队伍。

面向长期智能体团队的协作工作台。<br>
把已有的编程智能体带进共同会话，分工、执行、检查文件变化，<br>
并保留下一次工作仍用得上的经验。

<p>
  <a href="https://github.com/murray17/rovai-ai/releases"><img src="https://img.shields.io/badge/macOS-arm64%20%2B%20x64-111111?logo=apple&logoColor=white" alt="macOS arm64 + x64"></a>
  <a href="https://github.com/murray17/rovai-ai/releases"><img src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows11&logoColor=white" alt="Windows x64"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4b8f77" alt="MIT License"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.85%2B-000000?logo=rust&logoColor=white" alt="Rust 1.85+"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white" alt="Node.js 24+"></a>
  <a href="https://linux.do/"><img src="https://img.shields.io/badge/LINUX%20DO-Community-1f6feb" alt="LINUX DO Community"></a>
</p>

<p>
  <a href="https://rovai.dev/zh/"><strong>官网</strong></a>
  · <a href="https://rovai.dev/zh/download/"><strong>下载</strong></a>
  · <a href="https://rovai.dev/zh/docs/"><strong>使用文档</strong></a>
  · <a href="https://github.com/murray17/rovai-ai/releases"><strong>更新日志</strong></a>
</p>

<p><a href="README.md">English</a> | <strong>简体中文</strong></p>

</div>

<p align="center"><a href="docs/assets/readme/workspace-team-ready.png"><img src="docs/assets/readme/workspace-team-ready.png" alt="同时 @ 四位队员，Gugu 与 Bunny 已回复，Dingding 与 Cheese 仍在运行，右侧展示 Overview" width="100%"></a></p>

## 从第一条请求，一起做到下一次任务

先让一位队员开始工作，需要第二种视角时再请另一位加入。队员的职责、会话、未完成任务和有用的约定都保留下来，方便下次继续。

| 核心能力 | 你可以做什么 |
| --- | --- |
| **[长期队员](https://rovai.dev/zh/docs/members.html)** | 为队员设置名字、角色、职责与工作准则，再分别配置智能体、模型和权限。 |
| **[会话协作](https://rovai.dev/zh/docs/collaboration.html)** | 指定合适的接收者，交流发现、交接工作；需要专门讨论时，打开与队员的独立单聊。 |
| **[可见执行](https://rovai.dev/zh/docs/execution.html)** | 查看工具调用、处理审批，并在会话旁预览文件、检查修改。 |
| **[持续推进](https://rovai.dev/zh/docs/missions.html)** | 用使命板跟进较大的目标，用定时任务安排重复工作，用协作记忆保存长期约定。 |
| **[Skills 与工具](https://rovai.dev/zh/docs/skills.html)** | 使用原生 Skills，配置 Rovai 协作工具箱，并接入所用智能体支持的 MCP 服务。 |
| **[远程连接](https://rovai.dev/zh/docs/remote.html)** | 从浏览器回到工作台，也能为桌面端队员接入外部消息渠道。 |

## 熟悉的队员，灵活的运行配置

队员的长期身份可以延续到不同项目。实现队员与审查队员可以承担不同职责，使用不同智能体，也保留各自的工作方式。

接入你已经安装的 **Codex CLI、Claude Code、Pi Coding Agent、DeepSeek Harness、OpenCode** 等编程智能体。模型、权限、Skills 和 MCP 的具体能力，以所用智能体与主机平台为准。

<p align="center"><a href="docs/assets/readme/teammates-agents.png"><img src="docs/assets/readme/teammates-agents.png" alt="四位英文演示队员分别使用 Codex CLI、Claude Code、Pi Coding Agent 和 DeepSeek Harness，右侧展示 Dingding 的资料与权限配置" width="100%"></a></p>

[队员与配置](https://rovai.dev/zh/docs/members.html) · [智能体与模型](https://rovai.dev/zh/docs/agents.html) · [平台兼容性](https://rovai.dev/zh/docs/compatibility.html)

## 让持续的工作有处可循

完善下载体验、准备一个版本发布，或持续检查某个项目，都可以放到使命板里。选好项目与队伍，在对应会话中推进，再查看累计文件变化与交付。

任务记录责任，执行记录反映实际做了什么。一次执行结束、使命完成、代码合入，分别由对应操作推进。

<p align="center"><a href="docs/assets/readme/missions.png"><img src="docs/assets/readme/missions.png" alt="已填写目标、项目和队伍的 Orbit 使命创建窗口" width="100%"></a></p>

[使命板](https://rovai.dev/zh/docs/missions.html) · [任务与责任](https://rovai.dev/zh/docs/tasks.html) · [定时任务](https://rovai.dev/zh/docs/automations.html) · [协作记忆](https://rovai.dev/zh/docs/memory.html)

## 换一台设备，继续工作

在 Rovai Desktop 中开启 Web 访问，或在自己的主机上独立运行 Rovai Server。通过浏览器进入工作台，继续会话、查看进展。智能体和项目文件位于你连接的主机，不同实例各自保存数据。

Rovai Desktop 也能接入**飞书与钉钉**，让你从常用渠道发起请求、接收结果。配置方法与可用范围见渠道教程。

<p align="center"><a href="docs/assets/readme/remote-access.png"><img src="docs/assets/readme/remote-access.png" alt="Rovai 移动端会话与桌面渠道设置的界面参考组合" width="100%"></a></p>

[部署与远程访问](https://rovai.dev/zh/docs/remote.html) · [渠道接入](https://rovai.dev/zh/docs/channels.html)

## 开始使用

| 使用方式 | 从这里开始 |
| --- | --- |
| **在桌面电脑上使用** | [下载 Rovai Desktop](https://rovai.dev/zh/download/)，选择 macOS Apple 芯片、macOS Intel 或 Windows x64。按对应版本的说明安装或升级。 |
| **在自己的服务主机上运行** | [安装 Rovai Server](https://rovai.dev/zh/docs/server-install.html)。安装包、主机要求、版本限制与启动方式单独说明。 |

1. **准备一种智能体。** 在主机上安装并登录支持的编程智能体，再到“设置 → 智能体”检查状态。
2. **选择一位队员。** 配置智能体、模型和权限；开始时，一位队员就够了。
3. **交给他一个小任务。** 为项目打开会话，让队员先解释项目结构；查看执行记录后，再安排修改。

[完整快速开始](https://rovai.dev/zh/docs/quickstart.html) · [尝试两位队员协作](https://rovai.dev/zh/docs/collaboration.html)

## 工作如何连接起来

Rovai 保存队伍的协作状态并协调执行。编程智能体使用各自的工具、认证和已配置的模型服务完成工作。

<p align="center"><a href="docs/assets/readme/architecture-overview.svg"><img src="docs/assets/readme/architecture-overview.svg" alt="Desktop 与浏览器连接同一个 Rovai Host 和 Core 实例；该实例保存团队状态，并协调主机上的智能体访问项目文件和已配置模型服务" width="100%"></a></p>

Desktop 与独立 Server 复用 Host 实现，各自拥有数据和运行环境。通过浏览器连接不会迁移或同步两个实例；渠道接入由 Desktop 提供。

[工作机制](https://rovai.dev/zh/docs/mechanism.html) · [工程架构](https://github.com/murray17/rovai-ai/blob/main/docs/architecture/README.md)

## 文档与开发

| 你想做什么 | 对应入口 |
| --- | --- |
| 学习使用 Rovai | [中文文档](https://rovai.dev/zh/docs/) · [English documentation](https://rovai.dev/docs/) |
| 配置智能体与工具 | [智能体](https://rovai.dev/zh/docs/agents.html) · [Skills](https://rovai.dev/zh/docs/skills.html) · [MCP](https://rovai.dev/zh/docs/mcp.html) |
| 从另一台设备访问 | [Desktop Web](https://rovai.dev/zh/docs/desktop-web.html) · [Server 安装](https://rovai.dev/zh/docs/server-install.html) · [连接方式](https://rovai.dev/zh/docs/remote.html) |
| 从源码运行或参与开发 | [开发者指南](https://github.com/murray17/rovai-ai/blob/main/docs/development/README.md) · [系统架构](https://github.com/murray17/rovai-ai/blob/main/docs/architecture/README.md) · [兼容性实测](https://github.com/murray17/rovai-ai/blob/main/docs/runtime-compatibility.md) |

先按开发者指南准备环境与隔离的开发数据，再运行：

```sh
git clone https://github.com/murray17/rovai-ai.git
cd rovai-ai
pnpm install --frozen-lockfile
pnpm dev
```

## 参与贡献

欢迎提交 [Issue](https://github.com/murray17/rovai-ai/issues) 或 [Pull Request](https://github.com/murray17/rovai-ai/pulls)。反馈问题时，请附上 Rovai 版本、主机平台和复现步骤。

## 许可证

[MIT](https://github.com/murray17/rovai-ai/blob/main/LICENSE) — 允许自由使用、修改、分发和商业使用。

## 社区

欢迎加入微信群，交流使用方式、分享工作流，一起讨论 Rovai。

<p align="center">
  <a href="docs/assets/readme/wechat-group.png"><img src="docs/assets/readme/wechat-group.png" alt="Rovai 交流微信群二维码" width="320"></a><br>
  <sub>微信扫码加入 · 点击图片查看原图</sub>
</p>
