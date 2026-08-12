---
document_type: development-workflow
authority: local-coding-agent-tooling-and-ui-document-routing
last_updated: 2026-08-13
tested_impeccable_ref: ae388ac58fb33aade50fc47e2be07c3192dcaabd
tested_impeccable_skill_version: 4.0.4
---

# Coding Agent 执行指南：Impeccable 本地安装与 RovAI UI 文档重构

> 建议仓库路径：`docs/development/coding-agent-impeccable-ui-workflow.md`
>
> 本文面向在 `murray17/rovai-ai` 仓库中工作的任何 Coding Agent，包括但不限于
> Codex、Claude Code、Cursor、GitHub Copilot、Gemini CLI、OpenCode 和 Grok Build。
> 它定义共享的仓库执行合同、按 Provider 本地安装 Impeccable、Git 跟踪边界、
> UI 文件分类、旧 UI 文档迁移和验收流程。
>
> 仓库规则不得依赖某个 Agent 的专有 Slash Command、Hook、Plugin 或配置目录。
> 本文不授权 commit、push、创建 PR，也不授权修改 Renderer 产品行为。

## 1. 本次任务目标

完成以下五件事：

1. 为当前实际使用的一个或多个 Coding Agent 安装完整的 Impeccable Provider
   payload；不得默认当前 Agent 是 Codex。
2. 所有第三方 Skill、Provider companion agent 和本地状态仅作为本机工具，使用精确
   `.gitignore` 规则，不进入 Git。
3. 将跨 Agent 的共同开发规则保存在 `AGENTS.md` 和仓库文档中；Provider 原生配置只做
   最薄的接入，不复制产品、架构或 UI 规则。
4. 按“产品事实、全局设计系统、主题、复杂组件、页面局部策略、领域合同、
   版本历史”重新分类 RovAI UI 文档。
5. 迁移仍然有效的内容后，**直接删除**
   `docs/ui/arctic-dawn.md`。不得建立兼容跳转页、空壳文件、软链接或同名别名。

这不是重新设计 RovAI，也不是主题改色任务。除非另有明确授权，保持当前
Porcelain Day、Steel Night、现有组件树、业务状态、IPC、Core Read Side 和交互行为不变。

### 1.1 Agent-neutral 原则

- `AGENTS.md` 是共享 Coding Agent 入口，不以 Codex、Claude、Cursor 等任一产品命名。
- Impeccable 的 Provider 路径只是本地装载位置，不是仓库设计真源。
- 原生 Skill 发现或 `/impeccable` 命令不可用时，Agent 必须能够通过直接阅读
  `SKILL.md`、对应 `reference/*.md` 和运行 `scripts/` 完成同一流程。
- 未安装 Impeccable 不得阻塞普通仓库开发；`DESIGN.md`、UI 文档、ADR、Contract、
  代码和测试必须独立可读。
- 同一任务换用另一种 Coding Agent 时，不得重新解释或改变仓库规则。

## 2. 不可协商的约束

### 2.1 必须做

- 执行前识别当前 Coding Agent 以及它实际支持的 Skill 装载位置。
- 安装完整 Provider payload：
  - `SKILL.md`
  - `reference/`
  - `scripts/`
  - Provider 要求的内嵌或 companion agents
- 只安装当前确实会使用的 Provider，不预装所有 Agent 目录。
- 对每个已安装 Provider 路径使用精确 `.gitignore` 规则。
- 共享规则必须保持 Provider-neutral，不要求某个专有命令才能理解。
- 迁移当前有效内容后执行：
  ```bash
  git rm docs/ui/arctic-dawn.md
  ```
- 更新所有指向该文件的当前文档路由。
- 运行仓库现有文档治理门禁。
- 对文档与代码不一致的地方明确报告漂移，不得静默选边。

### 2.2 禁止做

- 不得假定 `.agents/skills/impeccable/` 是唯一安装位置。
- 不得只复制 `SKILL.md`；这会形成无法加载 references、scripts 或 companion agents
  的残缺 Skill。
- 不得默认执行：
  ```bash
  npx impeccable install
  npx impeccable update
  ```
  上游安装器可能同时写入 Provider-native Hook manifest。
- 未经用户明确授权，不得创建或修改 Impeccable Hook，例如：
  - `.codex/hooks.json`
  - `.claude/settings.json`
  - `.claude/settings.local.json`
  - `.cursor/hooks.json`
  - `.github/hooks/impeccable.json`
  - `.grok/hooks/impeccable.json`
- 未经用户明确授权，不得安装 Claude Marketplace Plugin、Grok Plugin 或类似插件。
- 不得为了“以后可能用到”而复制全部 Provider 输出。
- 不得让 Provider 原生配置覆盖仓库中已有且与 Impeccable 无关的设置。
- 不得把完整仓库规则复制到多个 Provider 配置文件中；适配器只能链接共享入口并补充
  必要的装载说明。
- 不得将整个 `/.agents/`、`/.claude/`、`/.cursor/`、`/.github/`、
  `/.gemini/`、`/.opencode/`、`/.grok/` 或 `/.impeccable/` 加入 `.gitignore`。
- 不得为了保留旧链接而继续创建 `docs/ui/arctic-dawn.md`。
- 不得把历史版本内容提升为当前规则。
- 不得把 Impeccable 的通用审美偏好凌驾于已确认的 RovAI 视觉系统之上。
- 不得改写无关工作树内容，不得使用 `git add .`、`git add -A` 或自动提交。

## 3. 权威边界

Impeccable 是工作流工具，不是 RovAI 的产品或架构真源。

| 问题类型 | 权威来源 |
|---|---|
| 长期领域、安全、持久化、Runtime 边界 | 有效 ADR、当前 Architecture、当前 Contract |
| 当前版本范围、进度和验收 | `docs/versions/README.md` 指向的当前版本文档 |
| 仓库实际实现 | 代码、Migration、测试和可复现验收证据 |
| 稳定产品事实、用户、用途、术语 | 根目录 `PRODUCT.md`，但不得复制架构和版本状态 |
| 跨页面、跨主题的视觉系统 | 根目录 `DESIGN.md` |
| 每套主题的完整视觉与 Token 合同 | `docs/ui/themes/` |
| RovAI 特有复杂组件的视觉和交互呈现 | `docs/ui/components/` |
| Renderer 页面或源码目标的局部设计策略 | `apps/desktop/.impeccable/surfaces/` |
| UI 验收矩阵和无障碍规则 | `docs/ui/qa/` |
| 本地设计工作方法 | 当前 Coding Agent 的 Impeccable 原生 Skill 路径；可选工具，不具有仓库权威 |

当 `DESIGN.md`、主题文档和生产 CSS 不一致时，不得用“文档优先”或“代码优先”
掩盖问题。应报告：

1. 哪些 Token、组件规则或页面状态不一致；
2. 哪一边代表已确认设计，哪一边代表当前实现；
3. 是否缺少版本授权或实现证据；
4. 本次任务是否有权限修复。

## 4. 本次迁移的起始基线

执行同类任务前重新检查 `main`，不要把本节当作当前仓库状态。本次迁移开始时：

- `docs/ui/` 只有 `README.md`、`arctic-dawn.md` 和 `examples/`；
- `docs/ui/README.md` 仍把 `arctic-dawn.md` 当作当前 UI 详规入口；
- `docs/README.md` 的 Renderer UI 路由仍直接链接该文件；
- `AGENTS.md` 只要求 UI 工作读取 `docs/ui/README.md`；
- 根目录尚未建立 `PRODUCT.md` 和 `DESIGN.md`；
- `.gitignore` 尚未包含 `.agents` 或 `.impeccable` 的精确规则；
- Renderer 当前通过同一组件树和 CSS Variables 实现 Day/Night 两套主题。

先记录工作树和旧引用：

```bash
git status --short
git branch --show-current

rg -n --hidden \
  --glob '!.git/**' \
  --glob '!docs/development/coding-agent-impeccable-ui-workflow.md' \
  'docs/ui/arctic-dawn\.md|ui/arctic-dawn\.md|\]\(arctic-dawn\.md\)' \
  .

rg -n --hidden \
  --glob '!.git/**' \
  --glob '!docs/development/coding-agent-impeccable-ui-workflow.md' \
  'arctic-dawn' \
  docs AGENTS.md CONTEXT.md
```

第一条搜索用于清除必须失效的精确路径；第二条用于判断哪些 “Arctic Dawn”
只是合理的历史说明，哪些仍被错误当作当前权威。

## 5. 面向多种 Coding Agent 的本地安装

### 5.1 安装模型

使用本文 front matter 中经过检查的 commit：

```text
ae388ac58fb33aade50fc47e2be07c3192dcaabd
```

安装采用“**一个固定上游版本，按需生成一个或多个 Provider 本地投影**”的模型：

```text
Pinned Impeccable source
        │
        ├── Codex / Agent Skills projection
        ├── Claude Code projection
        ├── Cursor projection
        ├── GitHub Copilot projection
        ├── Gemini CLI projection
        └── Other selected provider projection
```

要求：

- 所有 Provider 投影来自同一个固定 commit；
- 只安装当前会使用的 Provider；
- Provider 投影是可删除、可重建的本地工具；
- 不通过 Provider 路径保存 RovAI 产品或设计事实；
- 不依赖 `/impeccable` Slash Command 才能执行工作流；
- 更新版本必须是独立、显式的维护任务，先检查上游变化，再更新
  `tested_impeccable_ref` 和 `tested_impeccable_skill_version`；
- 普通 UI 任务不得自动跟随上游 `main`。

### 5.2 取得固定上游源码

在 RovAI 仓库根目录执行：

```bash
set -euo pipefail

IMPECCABLE_REF="ae388ac58fb33aade50fc47e2be07c3192dcaabd"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

git init -q "$TMP_DIR/impeccable"
git -C "$TMP_DIR/impeccable" remote add origin \
  https://github.com/pbakaus/impeccable.git
git -C "$TMP_DIR/impeccable" fetch --depth=1 origin "$IMPECCABLE_REF"
git -C "$TMP_DIR/impeccable" checkout --detach FETCH_HEAD

export IMPECCABLE_SOURCE="$TMP_DIR/impeccable"
```

不得将这个临时 checkout 作为第二份仓库真源提交到 RovAI。第 5.2 节与第 5.4 节的命令应在同一个 shell 会话中连续执行；离开该 shell 后，`trap` 会清理临时目录。

### 5.3 常用 Provider 路径

以下路径以固定 commit 中的 Provider 输出为准。每次升级上游版本都要重新检查路径，
不能把本表当作永久 API。

| Coding Agent | Skill 源路径与目标路径 | Companion agents | 明确排除 |
|---|---|---|---|
| Codex / 支持 `.agents` 的 Agent | `.agents/skills/impeccable/` | 已内嵌在 Skill 的 `agents/` | `.codex/hooks.json` |
| Claude Code | `.claude/skills/impeccable/` | `.claude/agents/impeccable-*` | `.claude/settings*.json`、Plugin |
| Cursor | `.cursor/skills/impeccable/` | `.cursor/agents/impeccable-*` | `.cursor/hooks.json` |
| GitHub Copilot | `.github/skills/impeccable/` | `.github/agents/impeccable-*` | `.github/hooks/` |
| Gemini CLI | `.gemini/skills/impeccable/` | 以该版本输出为准 | Provider 设置文件 |
| OpenCode | `.opencode/skills/impeccable/` | 以该版本输出为准 | Provider 设置文件 |
| Grok Build | `.grok/skills/impeccable/` | `.grok/agents/impeccable-*` | `.grok/hooks/`、Plugin |
| 其他 Provider | 检查固定 checkout 中对应的 Provider 目录 | 只复制 Impeccable 专属文件 | Hook、Plugin、无关设置 |

不要把某个 Provider 的 payload 复制给另一 Provider。不同输出可能具有不同 front matter、
agent 描述格式或目录约定。

### 5.4 按需安装一个或多个 Provider

先显式选择 Provider；不得设置隐式的 Codex 默认值。例如：

```bash
IMPECCABLE_PROVIDERS="cursor,claude"
```

然后在 **`/bin/bash`** 中执行。下面使用 Bash array 与 process substitution；不要交给仓库默认的
zsh 解释：

```bash
set -euo pipefail

: "${IMPECCABLE_SOURCE:?Run the pinned source checkout step first}"
: "${IMPECCABLE_PROVIDERS:?Set providers, e.g. cursor,claude}"

install_skill() {
  local source_path="$1"
  local target_path="$2"

  test -d "$IMPECCABLE_SOURCE/$source_path"
  if test -e "$target_path"; then
    echo "Target already exists; inspect it before an explicit update: $target_path" >&2
    return 2
  fi
  mkdir -p "$(dirname "$target_path")"
  cp -R "$IMPECCABLE_SOURCE/$source_path" "$target_path"
}

install_companion_agents() {
  local source_dir="$1"
  local target_dir="$2"
  local source_file
  local target_file

  test -d "$IMPECCABLE_SOURCE/$source_dir"
  mkdir -p "$target_dir"

  while IFS= read -r source_file; do
    target_file="$target_dir/$(basename "$source_file")"
    if test -e "$target_file"; then
      echo "Companion already exists; inspect it before an explicit update: $target_file" >&2
      return 2
    fi
    cp "$source_file" "$target_file"
  done < <(find "$IMPECCABLE_SOURCE/$source_dir" \
    -maxdepth 1 -type f -name 'impeccable-*' -print)
}

IFS=',' read -r -a providers <<< "$IMPECCABLE_PROVIDERS"
for provider in "${providers[@]}"; do
  provider="${provider//[[:space:]]/}"
  case "$provider" in
    codex|agents)
      install_skill \
        ".agents/skills/impeccable" \
        ".agents/skills/impeccable"
      ;;

    claude|claude-code)
      install_skill \
        ".claude/skills/impeccable" \
        ".claude/skills/impeccable"
      install_companion_agents ".claude/agents" ".claude/agents"
      ;;

    cursor)
      install_skill \
        ".cursor/skills/impeccable" \
        ".cursor/skills/impeccable"
      install_companion_agents ".cursor/agents" ".cursor/agents"
      ;;

    github|copilot|github-copilot)
      install_skill \
        ".github/skills/impeccable" \
        ".github/skills/impeccable"
      install_companion_agents ".github/agents" ".github/agents"
      ;;

    gemini|gemini-cli)
      install_skill \
        ".gemini/skills/impeccable" \
        ".gemini/skills/impeccable"
      ;;

    opencode)
      install_skill \
        ".opencode/skills/impeccable" \
        ".opencode/skills/impeccable"
      ;;

    grok|grok-build)
      install_skill \
        ".grok/skills/impeccable" \
        ".grok/skills/impeccable"
      install_companion_agents ".grok/agents" ".grok/agents"
      ;;

    *)
      echo "Unsupported provider selector: $provider" >&2
      echo "Inspect the pinned checkout; do not guess a destination." >&2
      exit 1
      ;;
  esac
done
```

该脚本只复制 Skill 和 Impeccable companion agents，不复制 Hook、Plugin、Provider
settings 或其他上游仓库文件。

脚本遇到任何已有目标都会中止。升级或重装是独立维护任务：先把当前 payload 与新的固定
checkout 做递归 diff，确认本地修改和上游变化，再显式替换目标并重新运行完整性、ignore 与
Hook/Plugin 检查；不得把无条件 `rm -rf` 加回普通安装流程。

### 5.5 原生模式与手动模式

#### 原生 Skill 模式

当前 Agent 能发现其 Provider 原生 Skill 时，可以使用它提供的命令入口，例如
`/impeccable document`。命令名称只是便利入口，不属于 RovAI 仓库合同。

#### 手动 Skill 模式

当前 Agent 不支持 Skill 自动发现、Slash Command 或 companion agent 时：

1. 定位当前安装的 `impeccable/SKILL.md`；
2. 阅读 `SKILL.md`；
3. 根据任务阅读对应 `reference/*.md`；
4. 直接运行 `scripts/` 中需要的脚本；
5. 按相同输入、输出、边界和验收要求完成任务。

对于本文的 UI 文档迁移，最低手动读取集是：

```text
SKILL.md
reference/document.md
reference/critique.md       # 仅在需要审查迁移结果时
```

不允许因为原生命令不存在而跳过仓库文档治理、代码核对或验收。

### 5.6 完整性验证

为当前 Provider 设置 Skill 根目录，例如：

```bash
IMPECCABLE_SKILL_ROOT=".cursor/skills/impeccable"
```

然后验证：

```bash
test -f "$IMPECCABLE_SKILL_ROOT/SKILL.md"
test -d "$IMPECCABLE_SKILL_ROOT/reference"
test -d "$IMPECCABLE_SKILL_ROOT/scripts"

grep -q '^version: 4\.0\.4$' \
  "$IMPECCABLE_SKILL_ROOT/SKILL.md"
```

Codex / `.agents` 输出还应验证内嵌 agents：

```bash
test -d .agents/skills/impeccable/agents
```

Claude Code、Cursor、GitHub Copilot 或 Grok Build 若安装了 companion agents，应验证
相应目录中至少存在一个 `impeccable-*` 文件。

### 5.7 确认未安装 Hook 或 Plugin

不得删除仓库中原本存在且与 Impeccable 无关的 Provider 配置；只确认本次改动没有新增
Impeccable Hook：

```bash
rg -n \
  'skills/impeccable/scripts/hook|hooks/impeccable' \
  .codex/hooks.json \
  .claude/settings.json \
  .claude/settings.local.json \
  .cursor/hooks.json \
  .github/hooks \
  .grok/hooks \
  2>/dev/null || true
```

把结果与任务开始时的基线比较。预期本次没有新增 Impeccable Hook 或 Plugin。

## 6. Git 忽略规则

只为实际安装的 Provider 添加精确规则。以下是可选目录清单，不得无脑全部复制：

```gitignore
# Local third-party Impeccable skill payloads — keep only installed providers
/.agents/skills/impeccable/
/.claude/skills/impeccable/
/.claude/agents/impeccable-*
/.cursor/skills/impeccable/
/.cursor/agents/impeccable-*
/.github/skills/impeccable/
/.github/agents/impeccable-*
/.gemini/skills/impeccable/
/.opencode/skills/impeccable/
/.grok/skills/impeccable/
/.grok/agents/impeccable-*

# Local Impeccable developer state for the Renderer project root
/apps/desktop/.impeccable/config.local.json

# Unselected/generated Impeccable decision comps
/apps/desktop/.impeccable/mocks/decision/
```

例如当前只使用 Cursor，则只保留 Cursor 两条、Impeccable 本地状态和临时稿规则。

验证每个已安装 Skill 确实被忽略且未被跟踪：

```bash
git check-ignore -v .cursor/skills/impeccable/SKILL.md
test -z "$(git ls-files .cursor/skills/impeccable)"
```

对其他 Provider 将路径替换为对应 Skill 根目录。Companion agents 也必须分别验证：

```bash
git check-ignore -v .cursor/agents/impeccable-documenter.md
```

实际文件名以固定上游版本为准。

禁止使用：

```gitignore
/.agents/
/.claude/
/.cursor/
/.github/
/.gemini/
/.opencode/
/.grok/
/.impeccable/
```

原因：

- Provider 目录可能包含 RovAI 自己需要提交的共享指令、Agent、Skill、Workflow 或设置；
- `apps/desktop/.impeccable/surfaces/`、共享配置和可选 sidecar 可能是需要团队共享的设计上下文；
- 只应忽略已确认的第三方本地 payload 和瞬时产物；
- 某个 Provider 不再使用时，应删除其本地 payload 和对应精确 ignore 条目，而不是积累
  永久废弃配置。

## 7. 文件分类与 Git 策略

### 7.1 必须提交的共享仓库事实

| 路径 | 分类 | 规则 |
|---|---|---|
| `AGENTS.md` | Coding Agent 共享入口 | Provider-neutral；只定义仓库规则和阅读路由，不依赖 Slash Command |
| `docs/development/coding-agent-impeccable-ui-workflow.md` | 本地工具与 UI 文档治理 | 本文；允许列出 Provider 接入差异，但共同规则只有一份 |
| `DESIGN.md` | 全局设计系统 | 本次迁移应创建；使用稳定章节；禁止放版本流水账 |
| `docs/ui/README.md` | UI 路由索引 | 必须简短；只负责入口、权威边界和阅读顺序 |
| `docs/ui/themes/README.md` | 主题注册与运行策略 | 说明 `system` 是解析策略，不是第三套主题 |
| `docs/ui/themes/porcelain-day.md` | Day 完整主题合同 | 保存完整语义 Token、用途、限制和验收 |
| `docs/ui/themes/steel-night.md` | Night 完整主题合同 | 保存完整语义 Token、用途、限制和验收 |
| `docs/ui/themes/_template.md` | 新主题模板 | 规定未来新增主题的文档字段和验收矩阵 |
| `docs/ui/components/README.md` | 复杂组件索引 | 只收纳 RovAI 特有且具有持久合同的组件 |
| `docs/ui/qa/theme-matrix.md` | 主题覆盖矩阵 | 两套主题必须覆盖同一页面、功能和状态 |
| `docs/ui/qa/accessibility.md` | UI 无障碍基线 | 对比度、键盘、焦点、Reduced Motion 等 |
| `apps/desktop/.impeccable/surfaces/*.md` | Renderer 页面局部 brief | 只有经过审查、仍然有效且目标明确的 brief 才提交 |

### 7.2 条件提交

| 路径 | 何时提交 |
|---|---|
| `PRODUCT.md` | 用户明确授权产品上下文整理后创建；不得在纯文档搬迁中凭空发明事实 |
| Provider-native instruction adapter | 只有当前 Agent 不读取 `AGENTS.md` 时；内容必须是指针和必要接入说明，不能复制共同规则 |
| `apps/desktop/.impeccable/config.json` | 团队正式采用共享 detector 规则、扩展名或窄范围豁免时 |
| `apps/desktop/.impeccable/design.json` | 团队实际使用 Impeccable Live/sidecar，并承诺与 `DESIGN.md` 同步时 |
| 选中的设计图或交互稿 | 从 `apps/desktop/.impeccable/mocks/` 提升到 `docs/prototypes/` 后，以正式名称提交 |

### 7.3 本地且不得提交

| 路径 | 原因 |
|---|---|
| 当前 Provider 的 `*/skills/impeccable/` | 第三方本地工具，可由本文固定 commit 重装 |
| `*/agents/impeccable-*` companion files | Provider-native 第三方 agent，可重装 |
| `apps/desktop/.impeccable/config.local.json` | 开发者个人 consent 和本地例外 |
| `apps/desktop/.impeccable/mocks/decision/` | 未选中的生成式方向稿和临时比较素材 |
| Impeccable Hook manifest | 本任务明确禁止安装 |
| Impeccable Plugin | 本任务明确禁止安装 |
| 未使用 Provider 的 payload | 不应预装，也不应提交 |

### 7.4 Provider 适配器原则

若某个 Coding Agent 不自动读取 `AGENTS.md`，可以建立该 Provider 支持的最小适配器。
适配器只能：

- 指向 `AGENTS.md`；
- 指向 `docs/README.md`；
- 说明如何加载当前 Provider 的本地 Impeccable Skill；
- 补充该 Provider 必需但不具有产品语义的执行机械规则。

适配器不得复制：

- ADR、Contract 或版本范围；
- `DESIGN.md` 或主题 Token；
- UI 文件分类规则；
- 测试命令全集；
- 本文完整内容。

这样切换 Coding Agent 时，共同规则不会产生多份漂移副本。

## 8. 目标文件结构

本次迁移完成后，目标结构为：

```text
rovai-ai/
├── AGENTS.md                           # 所有 Coding Agent 的共享入口
├── CONTEXT.md
├── DESIGN.md
├── PRODUCT.md                          # 条件创建，不得凭空生成
│
├── <provider-native-root>/             # 零个、一个或多个本地 Provider 投影
│   ├── skills/impeccable/              # 本地存在，Git 精确忽略
│   │   ├── SKILL.md
│   │   ├── reference/
│   │   ├── scripts/
│   │   └── agents/                     # 仅部分 Provider 内嵌
│   └── agents/impeccable-*             # 仅部分 Provider 使用 companion agents
│
├── apps/desktop/.impeccable/           # Renderer target 的 project root 下
│   ├── surfaces/                       # 经审查后提交
│   ├── config.json                     # 条件提交
│   ├── config.local.json               # 本地忽略
│   └── design.json                     # 条件提交
│
└── docs/
    ├── README.md
    ├── development/
    │   ├── README.md
    │   └── coding-agent-impeccable-ui-workflow.md
    │
    ├── ui/
    │   ├── README.md
    │   ├── themes/
    │   │   ├── README.md
    │   │   ├── porcelain-day.md
    │   │   ├── steel-night.md
    │   │   └── _template.md
    │   ├── components/
    │   │   ├── README.md
    │   │   └── <仅创建确有长期价值的复杂组件文档>
    │   └── qa/
    │       ├── theme-matrix.md
    │       └── accessibility.md
    │
    ├── contracts/
    ├── architecture/
    ├── adr/
    ├── prototypes/
    └── versions/
```

常见 `<provider-native-root>` 包括 `.agents/`、`.claude/`、`.cursor/`、
`.github/`、`.gemini/`、`.opencode/` 和 `.grok/`。它们只是装载位置。

**不得创建空占位组件文档。** 只有当旧文档中确实存在仍然有效、跨版本且无法由
`DESIGN.md` 简洁表达的复杂组件合同，才新增对应文件。

## 9. `DESIGN.md` 规则

`DESIGN.md` 是供人和 AI 共用的跨页面视觉系统，采用固定章节顺序：

1. `## Overview`
2. `## Colors`
3. `## Typography`
4. `## Layout`
5. `## Elevation & Depth`
6. `## Shapes`
7. `## Components`
8. `## Do's and Don'ts`

要求：

- 以当前生产 Renderer、CSS Variables、组件和测试为提取依据；
- 把 Porcelain Day 与 Steel Night 表述为同一产品视觉世界下的两套主题实现；
- `System` 是偏好/解析策略，不是主题目录；
- 说明品牌色、语义状态色、身份色和证据色互不替代；
- 组件只消费语义 Token，不包含主题专属条件分支；
- 不复制完整 Token 表；完整主题值放在 `docs/ui/themes/*.md`；
- 不放 v0.xx 版本日志；
- 不放 Task、AgentRun、A2A、Recovery 等领域状态机；
- 不把某个页面的局部构图提升为全局设计原则。

YAML front matter 只放实际复用、稳定、适合机器读取的代表性 Token。不要为了覆盖所有
CSS 变量而制造一份与生产代码难以同步的第二套全集。

建议使用明确的 Named Rules：

```md
**The Token-Only Theme Rule.**
组件只消费语义 Token，不得包含主题专属十六进制颜色或
`theme === "night"` 颜色分支。

**The Same Surface Rule.**
所有正式主题覆盖同一组件、业务能力和状态矩阵。

**The Identity Is Not Status Rule.**
队员、Skill 和 MCP 的身份色不得被 Steel 品牌色或语义状态色替代。

**The Quiet Structure Rule.**
优先通过表面层级和结构线表达关系，不使用层层嵌套 Card 制造层级。
```

## 10. 主题文档规则

### 10.1 `docs/ui/themes/README.md`

负责：

- 当前主题注册：
  - `porcelain-day`
  - `steel-night`
- 当前运行时映射：
  - `system`
  - `day`
  - `night`
- 首次渲染、防闪烁、`data-theme`、`color-scheme` 和 Main/Renderer 权威边界；
- 新主题增加流程；
- 主题与组件的依赖方向。

明确：

```text
Theme Token → Shared Component → Surface Composition
```

反向依赖禁止：

- 主题不得复制页面；
- 组件不得按主题 ID 分叉业务结构；
- 页面 brief 不得重新定义主题 Token。

### 10.2 每个主题文件

每个主题文件至少包含：

```md
# <Theme Display Name>

## Identity
## Mode
## Design intent
## Surface hierarchy
## Complete semantic token assignments
## Brand, semantic, identity, and evidence color rules
## Contrast requirements
## Prohibited substitutions
## Implementation source
## Visual verification
```

### 10.3 新主题模板

`_template.md` 必须要求：

- 稳定 `theme_id`；
- 显示名称；
- `light` / `dark` 模式；
- 与现有 RovAI 视觉世界的关系；
- 完整语义 Token；
- 八组身份色；
- 状态色和证据色；
- 对比度结果；
- 同一页面/状态矩阵验收；
- 生产 Token 来源和测试入口。

第三套主题进入生产前，另行评估当前
`ThemePreference = system | day | night` 是否需要从明暗模式和具体主题 ID 中解耦。
本文档迁移不得顺带修改该运行时合同。

## 11. 组件文档规则

`docs/ui/components/` 只保存 RovAI 特有、复杂、跨页面复用的稳定呈现合同，例如：

- Composer 与发送/停止/Approval Dock 的布局关系；
- 用户与 Agent 的开放式 Message Surface；
- Agent Process Drawer；
- Mention Popover；
- Task Card 与 Inspector 的责任分层。

普通 Button、Input、Chip、Dialog、Popover 的共同视觉语法优先写在
`DESIGN.md → Components`，不要为每个基础原子创建文件。

组件文档允许写：

- 结构和信息层级；
- 状态矩阵；
- 键盘、焦点和无障碍行为；
- 使用哪些语义 Token；
- 与领域合同的链接；
- 视觉验收条件。

组件文档禁止写：

- 主题专属十六进制颜色；
- 完整领域状态机；
- 某一版本的实施流水账；
- 假数据、原型事件处理器或演示行为。

## 12. Surface Brief 规则

`apps/desktop/.impeccable/surfaces/*.md` 只记录 Renderer 中某个具体页面、路由或源码目标的
局部策略。`context.mjs --target apps/desktop/src/renderer/...` 会把 project root 解析为
`apps/desktop`；把 brief 放在仓库根 `.impeccable/surfaces/` 时不会被该目标发现：

- 用户在此表面要完成什么；
- 信息优先级；
- 首屏结构；
- 局部交互；
- 必须继承哪些全局规则；
- 哪些业务和安全边界不得改变；
- `primary_target` 与 `related_targets`。

不要一次性为所有页面建立 brief。只有当旧文档中存在当前仍有价值、但明显属于单一页面的
决策时才迁移。

示例：

```yaml
---
version: 1
slug: "appearance-settings"
primary_target: "apps/desktop/src/renderer/src/appearance/AppearanceSettings.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/theme.ts"
  - "apps/desktop/src/renderer/src/styles.css"
---
```

Surface brief 不得覆盖 `DESIGN.md`、主题合同、ADR、Contract 或当前版本范围。

## 13. 删除 `docs/ui/arctic-dawn.md`

### 13.1 删除原则

该文件不再需要兼容。迁移完成后必须删除：

```bash
git rm docs/ui/arctic-dawn.md
```

禁止：

- 留一个兼容跳转页；
- 留一个只含链接的空壳；
- 建立软链接；
- 在别处复制一份同名文件；
- 将旧路径加入文档检查器白名单；
- 为旧链接新增特殊重写规则。

### 13.2 内容迁移矩阵

先按以下规则处理旧文件中的内容：

| 旧内容 | 新位置或动作 |
|---|---|
| 当前视觉世界、共同设计原则 | `DESIGN.md` |
| Day 完整 Token 与视觉意图 | `docs/ui/themes/porcelain-day.md` |
| Night 完整 Token 与视觉意图 | `docs/ui/themes/steel-night.md` |
| System/Day/Night 解析和首次渲染 | `docs/ui/themes/README.md` |
| Typography、Layout、Depth、Shapes | `DESIGN.md` |
| 通用基础组件视觉语法 | `DESIGN.md → Components` |
| RovAI 特有复杂组件合同 | `docs/ui/components/*.md` |
| 单一 Renderer 页面或源码目标的局部构图 | `apps/desktop/.impeccable/surfaces/*.md` |
| Task、AgentRun、A2A、Recovery 等领域语义 | 引用现有 Contract/ADR；缺失时报告，不在 UI 文档重写 |
| v0.xx 范围、实施、验收和历史说明 | 对应 `docs/versions/v0.xx/`；已存在则删除重复内容 |
| 已被后续版本替代的 UI 决定 | 删除，不迁移 |
| 假数据、演示动作、原型 DOM | 删除或保留在明确的历史 prototype 中，不进入当前规范 |
| 仅为解释旧文件名而存在的文字 | 删除 |

迁移不是逐段复制。每段内容必须回答：

1. 它现在仍然有效吗？
2. 它属于全局视觉、主题、组件、页面、领域合同还是版本历史？
3. 新位置是否已经存在同等或更高权威的内容？
4. 若重复，是否应该直接删除而不是再次保存？

### 13.3 处理 `docs/ui/examples/`

检查 `docs/ui/examples/arctic-dawn-conversation-events.html`：

- 若它只代表旧 Arctic Dawn 视觉稿，直接删除，或在确有历史研究价值时移动到
  `docs/prototypes/archive/arctic-dawn/`；
- 若其中仍有当前交互证据，迁移到语义化名称，例如
  `docs/prototypes/conversation-events.html`，并明确它不是生产真源；
- 不得仅为兼容旧文件名而保留；
- 当前 UI 索引不得把它作为设计权威。

## 14. 必须更新的路由文件

### 14.1 `docs/ui/README.md`

重写为简短索引，不再保存几十个版本的 UI 变更记录。至少链接：

- 根目录 `DESIGN.md`；
- `themes/README.md`；
- Porcelain Day；
- Steel Night；
- 复杂组件索引；
- QA；
- 历史版本入口。

建议结构：

```md
# RovAI UI 规范

## 当前视觉系统
## 主题
## 复杂组件
## 页面局部 Brief
## QA 与验收
## 权威边界
## 历史设计
```

版本变更留在 `docs/versions/`，领域行为留在 ADR/Contract。

### 14.2 `docs/README.md`

将 Renderer UI 任务路由从：

```text
docs/ui/README.md → docs/ui/arctic-dawn.md
```

改为：

```text
DESIGN.md → docs/ui/README.md → 对应主题/组件/Surface Brief
```

不得保留对被删除文件的链接。

### 14.3 `AGENTS.md`

将前端设计规则更新为：

```md
## Frontend design

- For any UI/UX or renderer-facing change, read [`DESIGN.md`](DESIGN.md) and
  [`docs/ui/README.md`](docs/ui/README.md) first.
- Read `PRODUCT.md`, when it exists, only when the task depends on
  users, product purpose, positioning, terminology, or durable brand
  commitments.
- When a matching `apps/desktop/.impeccable/surfaces/*.md` brief exists for a Renderer target, use
  it as local surface strategy. It cannot override ADRs, Contracts, current
  version scope, `DESIGN.md`, or theme contracts.
- Impeccable is optional provider-local tooling. It may be installed under the
  current coding agent's native skill directory; do not assume
  `.agents/skills/impeccable`, a slash command, or a specific provider.
- When native skill discovery is unavailable, read the installed
  `impeccable/SKILL.md` and its referenced files directly. The skill is not a
  repository authority.
- Do not install or enable Impeccable hooks or plugins without explicit user
  approval.
- Incremental work preserves the established RovAI visual world. Do not enter a
  replacement-world flow unless the user explicitly requests a redesign.
```

该片段故意把尚不存在的 `PRODUCT.md` 写成代码文本而不是 Markdown 链接，避免文档门禁出现
悬空链接；不得为了满足路由而创建空文件。

### 14.4 `docs/development/README.md`

在“按任务阅读”表格增加：

```md
| 为 Coding Agent 安装本地 Impeccable、更新设计上下文或维护 UI 文档分类 |
[Coding Agent Impeccable 与 UI 文档工作流](coding-agent-impeccable-ui-workflow.md) |
```

### 14.5 Provider-native 指令适配器

检查仓库是否已有当前 Coding Agent 的原生指令文件。若它不自动读取 `AGENTS.md`，
只建立一个最小适配器，内容指向：

- `AGENTS.md`；
- `docs/README.md`；
- 本文；
- 当前 Provider 的本地 Impeccable Skill 根目录。

不得把完整 UI 规范、测试命令或架构规则复制进适配器。若 Provider 约定已经变化，先查阅
该 Provider 当前官方文档，不得凭记忆猜测路径。

### 14.6 其他文件

更新：

- 当前版本文档中的现行 UI 路由；
- 任何 Contract/Architecture/ADR 中作为“当前详规”使用的旧链接；
- 文档测试 fixture 或导航快照；
- 代码注释中明确指向旧文档路径的内容。

历史文档可以保留 “Arctic Dawn” 作为当时设计名称，但不得把已删除路径作为当前约束。

## 15. 使用 Impeccable 的边界

安装后，针对本次迁移：

1. 先选择当前 Provider 的 Skill 根目录，不得默认使用 `.agents`：
   ```bash
   IMPECCABLE_SKILL_ROOT=".cursor/skills/impeccable"
   test -f "$IMPECCABLE_SKILL_ROOT/SKILL.md"
   ```
2. 运行一次上下文读取：
   ```bash
   node "$IMPECCABLE_SKILL_ROOT/scripts/context.mjs" \
     --target apps/desktop/src/renderer/src/styles.css
   ```
3. 原生 Skill 命令可用时，可以读取 `document` 流程；不可用时，直接阅读：
   ```text
   $IMPECCABLE_SKILL_ROOT/SKILL.md
   $IMPECCABLE_SKILL_ROOT/reference/document.md
   ```
   然后以 **scan/extraction reference** 从当前代码提取 `DESIGN.md`。本仓库的
   Porcelain Day / Steel Night、克制 Steel 与反卡片墙方向已经由
   现有生产实现和 accepted 文档冻结；本次迁移不重复 `document.md` 面向未定项目的两轮创意访谈。
   只有用户另行要求 rebrand/redesign 时，才重新运行该定性决策流程。
4. 这是 established-world documentation，不是 new visual work；`document.md` 的通用步骤不能覆盖
   已确认的仓库方向或本任务的自动执行授权。
5. 不运行或不采用以下改变视觉方向的流程：
   - `new-work`
   - `bolder`
   - `quieter`
   - `colorize`
   - `overdrive`
   - `delight`
6. 不在本次任务中启用 Hook 或 Plugin。
7. 不因 detector 的通用偏好修改 SF Pro/system font、现有密度或其他已确认 RovAI
   设计决定。
8. 不自动创建 `PRODUCT.md`。只有用户明确授权产品上下文整理时，才使用 `init`，并且不得
   把 `CONTEXT.md`、ADR 或版本计划整段复制进去。
9. 不生成 `apps/desktop/.impeccable/design.json`，除非团队另行采用 Impeccable Live/sidecar 并
   承诺与 `DESIGN.md` 同步。`DESIGN.md` 的缺失不等于自动授权 sidecar。
10. 若已有 `DESIGN.md`，不得静默覆盖；先分析 merge/refresh 范围。
11. 若当前 Agent 无法运行 Impeccable 脚本，继续依据仓库代码和文档完成迁移，并在最终
    报告中明确说明缺少了哪项可选工具验证；不得把工具不可用误报为仓库任务不可执行。

本次是文档重构，默认不执行 `extract` 的代码迁移步骤。只有另行授权组件/Token
重构时，才修改生产 CSS 或 React 组件。

## 16. 建议执行顺序

### 阶段 A：建立基线

1. 阅读：
   - `AGENTS.md`
   - `docs/README.md`
   - `docs/ui/README.md`
   - 当前版本 README 和 implementation plan
   - 与迁移内容相关的 Contract/ADR
2. 检查工作树，保留用户已有改动。
3. 搜索所有旧路径和当前权威引用。
4. 记录当前生产 Token、主题代码和主题测试位置。

### 阶段 B：安装当前 Provider 的本地 Skill

1. 识别当前会使用的 Coding Agent，不得默认 Codex。
2. 从同一固定 commit 复制一个或多个 Provider payload。
3. 修改 `.gitignore`，只忽略实际安装的精确路径。
4. 验证 `SKILL.md`、`reference/`、`scripts/` 和 Provider 所需 agents。
5. 验证没有 Hook、Plugin 或无关 Provider 设置变更。
6. 确认原生发现不可用时仍能以手动模式读取 Skill。

### 阶段 C：建立新设计文档

1. 从生产代码提取 `DESIGN.md`。
2. 创建 `docs/ui/themes/` 并拆分 Day/Night。
3. 创建主题模板和 QA 矩阵。
4. 只为确有需要的复杂组件创建文档。
5. 只为当前仍有效的页面局部决策创建 Surface Brief。
6. 重写 `docs/ui/README.md` 为索引。

### 阶段 D：清理旧文档

1. 将旧内容逐项分类；
2. 删除重复、失效和已被版本文档覆盖的内容；
3. 执行 `git rm docs/ui/arctic-dawn.md`；
4. 处理旧 HTML example；
5. 更新 `docs/README.md`、`AGENTS.md` 和其他路由；
6. 不创建任何兼容文件。

### 阶段 E：验证

1. 搜索旧路径；
2. 验证本地 Skill 未被 Git 跟踪；
3. 验证无 Hook diff；
4. 运行文档门禁；
5. 审查最终 diff；
6. 报告迁移、删除和未决漂移。

## 17. 验收命令

### 17.1 旧文件和旧链接必须消失

```bash
test ! -e docs/ui/arctic-dawn.md
test ! -L docs/ui/arctic-dawn.md

if rg -n --hidden \
  --glob '!.git/**' \
  --glob '!docs/development/coding-agent-impeccable-ui-workflow.md' \
  'docs/ui/arctic-dawn\.md|ui/arctic-dawn\.md|\]\(arctic-dawn\.md\)' \
  .; then
  echo "Found stale arctic-dawn.md references" >&2
  exit 1
fi
```

除本文这份迁移指南外，任何当前或历史 Markdown 都不得继续链接已删除路径。历史版本或 prototype 可以保留文字 `Arctic Dawn`，但必须是明确历史语境，且不能形成旧文件链接。

### 17.2 每个已安装 Skill 必须完整且不被跟踪

根据实际安装调整数组；不要为未安装的 Provider 填路径：

```bash
IMPECCABLE_SKILL_ROOTS=(
  ".cursor/skills/impeccable"
  ".claude/skills/impeccable"
)

test "${#IMPECCABLE_SKILL_ROOTS[@]}" -gt 0

for root in "${IMPECCABLE_SKILL_ROOTS[@]}"; do
  test -f "$root/SKILL.md"
  test -d "$root/reference"
  test -d "$root/scripts"
  git check-ignore -q "$root/SKILL.md"
  test -z "$(git ls-files "$root")"
done
```

对使用 companion agents 的 Provider，分别验证其 Impeccable 文件存在、被精确忽略且
未进入 Git。不得要求所有 Provider 使用相同目录结构。

### 17.3 共享规则必须与 Provider 解耦

```bash
rg -n \
  'Codex only|only Codex|必须使用 /impeccable|只能从 \.agents/skills' \
  AGENTS.md \
  docs/README.md \
  docs/development/README.md \
  docs/ui \
  || true
```

人工检查每个命中；本文对 Provider 安装差异的说明可以出现 Agent 名称，但仓库共同规则
不得绑定单一 Agent。

### 17.4 不得引入 Hook 或 Plugin

比较任务开始时的基线，重点检查：

```bash
git diff -- \
  .codex/hooks.json \
  .claude/settings.json \
  .claude/settings.local.json \
  .cursor/hooks.json \
  .github/hooks \
  .grok/hooks
```

若这些位置原本已有用户改动，不得覆盖；只确认本次没有增加 Impeccable Hook、Plugin 或
自动信任配置。

### 17.5 文档和格式门禁

```bash
git diff --check

pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支-base-SHA> pnpm docs:check:ci
pnpm docs:adr:generate -- --check
```

如果只修改文档和 `.gitignore`，以上为最低验证。若同时修改 Renderer 代码，继续按
`docs/development/README.md`、`testing.md` 和 `ui-acceptance.md` 运行相应
typecheck、测试、构建与截图验收。

## 18. 完成标准

只有全部满足时才算完成：

- [ ] 共享指南不再把 Codex 当作唯一 Coding Agent；
- [ ] 已明确当前实际使用的 Provider；
- [ ] 每个已选 Provider 都安装了完整 Skill payload；
- [ ] Provider payload 被精确 Git ignore，Provider 根目录未被整体忽略；
- [ ] 原生 Skill 不可用时存在明确的手动读取路径；
- [ ] 未安装或修改 Impeccable Hook/Plugin；
- [ ] `AGENTS.md` 保持 Provider-neutral；
- [ ] Provider-native 适配器没有复制共同规则；
- [ ] `DESIGN.md` 成为跨页面视觉系统入口；
- [ ] Day 与 Night 拆成独立主题文档；
- [ ] 组件规则与主题色值分离；
- [ ] `System` 被记录为解析策略，而不是第三个主题；
- [ ] `docs/ui/README.md` 已收敛为导航；
- [ ] `docs/ui/arctic-dawn.md` 已物理删除；
- [ ] 没有兼容跳转、空壳、软链接或检查器例外；
- [ ] 所有当前文档路由已更新；
- [ ] 历史内容只保留在明确的历史位置；
- [ ] 文档门禁通过；
- [ ] 最终报告明确说明 Provider、迁移、删除、验证和未决漂移；
- [ ] 未 commit、未 push，除非用户另行授权。

## 19. Coding Agent 最终报告格式

完成后按以下格式回复：

```md
## 完成内容

- 当前 Coding Agent / Provider：
- 本地 Skill：
- UI 文档重构：
- 删除内容：
- 路由更新：

## 文件分类结果

- 新增：
- 修改：
- 删除：
- 本地忽略：

## 验证

- `git diff --check`：
- `pnpm docs:test`：
- `pnpm docs:check`：
- `pnpm docs:check:ci`：
- `pnpm docs:adr:generate -- --check`：
- 其他：

## 漂移或未决问题

- 文档—实现漂移：
- 未迁移内容及原因：
- 需要另行授权的代码调整：

## Git 状态

- 未 commit
- 未 push
```

不要只说“已整理”。必须列出旧文档中哪些内容被迁移、哪些因重复或失效被删除，以及
除本文迁移指南中的说明外，`arctic-dawn.md` 的精确路径引用已经归零。
