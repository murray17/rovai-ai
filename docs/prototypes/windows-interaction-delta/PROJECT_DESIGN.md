---
document_type: prototype-design-brief
prototype: windows-interaction-delta
status: accepted-for-review
source_version: v1.05
last_updated: 2026-08-18
---

# Windows Interaction Delta prototype design

## Intent

让工程、产品与设计在进入 Windows 产品代码前，对“同一 Rovai AI、不同宿主交互”形成可点击的共同理解。重点不是
做一套 Windows 皮肤，而是把 native frame、快捷键/文案、Runtime 平台准入、历史配置、文件系统失败与安装升级的
交互边界放在同一评审面中。

## Established world

- 直接复用生产 Porcelain Day / Steel Night 语义 Token、系统字体链、270px rail 与 50px App 顶行关系；
- Quick Chat 复现当前全幅空状态；Settings 用 270px 设置侧栏替换主侧栏；Members 保持 270px 主侧栏、236px 队员
  列表和 980px 详情轨道，不重新解释信息架构；
- Runtime 目录沿用生产 68px 行、40px Logo 容器、真实产品 Logo、十项 Catalog 和紧凑状态/动作列；
- 保留 quiet open surfaces、Steel selection、开放留白和既有设置/队员信息层级；
- Window caption 区刻意保持中性并标为“系统拥有的示意”，不尝试设计自定义标题栏；
- Runtime 资格、机器状态和说明性数据明确分层，不用绿色/红色替代文本事实。

## Review controls

评审控制是右下角默认收起的浮层，明确标注“不属于产品”，不占用 App 布局，也不把产品缩进舞台或窗口卡片。
`macOS 原页 / Windows 差异` 在同一 DOM 结构上切换，用于直接检查 Windows 是否只增加批准的平台投影；Day、Night、
Runtime 说明态、路径结果和实现 seam 也在此切换。控制浮层收起后，除一个可再次打开的把手外，不在画面中插入
评审标题、说明列或尺寸标签。

## Fidelity guardrails

- 禁止用“评审实验室”布局、外层卡片、额外阴影和缩小的假 App 代替生产视口；
- 禁止为 Windows 重画侧栏、成员详情、设置页或 Runtime 目录；原型差异必须能在 macOS 对照模式中消失；
- 产品内出现的文案、尺寸与 Logo 优先取自当前 Renderer 代码和打包 App 截图，说明性状态必须在原型控制中标明；
- Installer 是唯一允许脱离现有 App Shell 的页面，因为它本来就是独立系统流程。

## Hard boundaries

- HTML 不复制产品 command、持久化或安全判断；所有“保存/选择/升级”只更新页面内说明性状态；
- 当前十个 Adapter 的 Windows 基线仍为 `not_qualified`；假设的 qualified/unsupported 只在明确的比较模式出现；
- Installer 是独立系统流程，不嵌进模拟 App Shell；
- caption、Snap、DPI、NVDA、IME、Explorer、SmartScreen 与真实 Installer 必须由客户端 Windows 验收。
