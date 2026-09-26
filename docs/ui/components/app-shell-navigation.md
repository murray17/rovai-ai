---
document_type: ui-component-contract
authority: renderer-app-shell-navigation
status: accepted
last_updated: 2026-09-26
---

# App Shell 与统一侧栏

## 统一侧栏结构

所有一级页面共享默认 270px rail；普通页面可调宽，macOS 与 Web 设置页固定 270px。普通顶行为 50px，会话顶行为 38px。侧栏品牌字标为 `Rovai AI`，不带副标题或通知铃铛；
普通侧栏在“新对话”后依次提供“队员”“记忆”“使命板”“定时任务”一级入口，底部以“设置”为主入口；存在可操作 App 新版本时，其右侧可以出现独立的紧凑更新状态徽标。
徽标只深链到“关于与更新”，不改变“设置”主入口恢复最后设置分类的语义。应用内普通提醒只在新动态
到达时临时呈现，偏好位于“设置 → 提醒”。设置
分类覆盖同一个侧栏槽位，不在内容区再增加第二列导航。macOS 设置沿用进入前的折叠状态，但不提供折叠与调宽入口；折叠时只显示展开按钮，展开后隐藏该按钮。Web 设置始终展开分类，不显示折叠、后退、前进三个按钮；去掉品牌上方原生拖拽区占位，品牌靠顶部排列。离开 Web 设置后恢复普通页面原来的宽度与折叠状态。Windows Desktop 继续使用普通布局操作。

### 调宽与完全折叠

- 右边缘提供 8px 隐形命中区；悬停和拖拽时整条边界使用 `--resize-line` 浅黑色，始终为 1px。
- 展开范围 200–420px，上限随窗口宽度收敛，为内容列尽量保留 600px。200px 保留品牌、常用入口和项目操作，长标题省略。
- 拖至小于 200px 直接收起到 0px；整个导航隐藏且 inert，不保留图标栏或空白列。导航组件与页面保持挂载，列表状态与草稿保留。
- 收起后窗口左边缘保留不占布局宽度的命中区，向右拖至 200px 可展开；同一次手势可反向拖回。
- 以下调宽与折叠入口只用于普通页面和 Windows Desktop 设置；macOS 与 Web 设置不显示分隔手柄、调宽菜单或折叠入口。
- 顶部使用无填色的圆角小窗图标；折叠时内侧短竖线贴近左边缘，不使用箭头。macOS 位于红黄绿右侧，Windows 位于 File 左侧，均为 `no-drag`。
- macOS 完全收起后为系统按钮和展开按钮保留顶部空间；Windows 的按钮属于独立菜单行，不进入 File/Edit/View/Window 的方向键循环。
- 展开宽度与折叠状态保存为本机布局偏好。按钮恢复上次展开宽度；拖拽触发折叠时保留手势开始前的宽度。视口收缩只限制显示宽度。
- 双击恢复 270px；方向键每次 10px、Shift 加速到 40px；Home/End 到最窄/最宽；Enter 折叠。向左越过最小宽度也会完全收起。
- 右键或空格提供紧凑、默认、宽侧栏和折叠菜单，保留单次点击替代拖拽。Escape、指针取消、窗口失焦或窗口尺寸变化取消手势并恢复开始时的布局。
- 启动框架复用相同布局偏好；尚未允许交互或正在关闭时禁用按钮与分隔线。

回归命令为 `pnpm test:navigation-shell`，使用隔离 Electron Renderer fixture，覆盖原生拖拽、折叠恢复、键盘、
偏好持久化、内容挂载与草稿保留；`ROVAI_KEEP_NAVIGATION_FIXTURE=1` 保留截图，不连接 Core、Runtime 或日常 userData。

普通侧栏依次显示置顶内容和 Project。每个 Project 行负责展开/折叠，不显示独立折叠图标；
右侧仅保留项目级 `＋` 与三点菜单。标题与“查看更多 / 收起”不显示 Camp 数量。当前 Project
使用中性文字与既有选择底色。选中 Camp 保留 `--surface-selected`，移除左侧竖线；侧栏 `--rail` 底色不变。
完成且有新回复的提示点使用 `--conversation-unread`，仍只表达未读回复，打开会话后按既有规则清除。
Hover 不能是发现行操作的唯一方式。

Sidecar Project 行在升级后保持稳定位置。合法旧偏好第一次进入时按用户当时看到的 Project 顺序冻结；
之后现有 Project 保持原相对顺序，新发现或重新恢复的 Project 追加到末尾，已消失或从本机移除的
Project 可以清理。老 Project 收到新消息、开始或结束 Run、更新活动时间或未读状态时都不能移动行。
这些活动继续刷新状态反馈；只有已发布的用户消息推进该 Project 内 Camp 的排序与活动时间。刚选择且尚无 Camp 的空 Project
同样追加到现有 Project 末尾。

Camp（包括快速对话）按最近一条已发布用户消息排序，桌面用户与飞书、钉钉等渠道的用户同等计入。
队员公开消息、A2A 消息、工具输出和 Run 状态变化不改变 Camp 的排序时间；运行中与完成未读提示仍正常更新。
没有用户消息的 Camp 使用创建时间作为稳定初始位置，未发送草稿的编辑或附件准备不推进排序。
置顶项和已保存的 Project 顺序继续由本机偏好拥有。

Camp 行显示稳定标题和必要状态。三点菜单是置顶/取消置顶、重命名、复制会话 ID 和删除的唯一
入口；复制只写稳定 Camp ID 原文。Camp 顶栏不得重复这些操作。
Desktop 与宽屏 WebUI 的置顶 Camp 在标题左侧显示 17px 对话图标；置顶项目标题、置顶项目内 Camp、
普通项目内 Camp 与独立置顶 Camp 共用文字轴。Project 子 Camp 只用层级缩进，不渲染空图标或左侧状态占位。
每个 Camp 行右侧始终保留 12×12px 状态槽：正在打开或运行时显示 loading，否则有新回复时显示 7px
`--conversation-unread` 蓝点，无状态时留空；loading 与未读同时成立时只显示 loading，未读事实及可访问名称继续保留。
状态变化不得移动标题或改变长标题的可用宽度。MobileUI 使用同一状态 DOM，蓝点为 6px，并沿用 20px
列表会话图标、44px 会话行与 48px Project 行；手机入口由统一左侧抽屉承载，不再显示底栏。
会话图标统一采用 24×24 画布、1.7 描边的横向圆角气泡与短尾，单线条、无填充、无阴影；其他导航图标不变。

自动生成的 Camp 标题不把开头连续的真实队员 Mention / 所有队员 Mention 当作标题内容；只保留
首段正文开始后的文字，正文中后部的 Mention 和手写 `@文字` 继续作为普通标题文字。Camp 行不把
任何 `@文字` 渲染为身份 Token、人物卡入口或独立点击目标，整行仍只负责打开会话。

渠道 Camp 复用同一自动命名，来源只按 Core 的 `channelSource` 添加 `【飞书私聊】`、`【飞书群聊】`、
`【飞书话题】`、`【钉钉私聊】` 或 `【钉钉群聊】` 前缀。侧栏/置顶、搜索、最近会话、顶部标题和临时提醒
统一展示，搜索也可匹配渠道类型。重命名输入框只呈现并提交原始 `camp.title`，前缀不会被写入名称；
旧 Camp 不批量改名，`/new` 后关闭的旧绑定仍保留来源。字段与命名事务见
[Channel Camp Naming v1](../../contracts/channel-camp-naming-v1.md)。既有长标题截断和完整可访问名称保持不变。

删除对话确认只显示标题“删除对话？”，说明保存的附件会一并删除、原始工作区文件和外部引用文件不受影响，并提供
“取消 / 删除”按钮；提交时短暂显示“正在删除…”。Core 返回 `accepted` 后立即关闭 Dialog、离开当前 Camp 并从全部正常导航分组移除；本窗口派生
tombstone 必须过滤受理前已经发出的迟到 Navigation snapshot，导航刷新或预览释放失败不能恢复该行或推翻受理。
正常完成不显示阶段、进度、“永久删除完成”或任务区。

后台自动恢复耗尽且确实需要用户介入时，只使用现有局部持久通知“删除未完成，请重试。”和一个“重试”动作；
重试继续原 operation，Camp 不重新进入列表。同一 `operationId + attentionRevision` 在一个窗口会话只提醒一次，重启后
未解决事项仍可再次提醒。不使用全局大红条，不向 Renderer 暴露 Runtime stop、数据库删除或资源 cleanup 阶段。

Project 三点菜单依次提供“置顶项目 / 取消置顶项目”“重命名”“移除项目”；刚选择且尚无 Camp 的目录也可重命名。
“重命名项目”沿用通用单字段 Dialog：项目名称、只读工作目录、“取消 / 保存名称”。打开时聚焦并全选原名称；
名称规范化后非空且最多 80 个 Unicode scalar，同名允许。已有自定义名称时提供“使用目录名”，填回目录名后仍需保存。
恢复操作清除本机别名，保留原目录名的连续空格和长度，不受自定义名称的 80 字符限制；继续编辑输入则重新按自定义名称校验。
保存中锁定输入、重复提交和关闭；失败保留草稿与旧显示名称，并在表单内提示重试。取消不写入，输入法组合回车不提交。

名称只作用于此设备的展示，侧栏/置顶、顶部、搜索、新对话和定时任务的项目选择一致更新；重新检查工作目录、
刷新、重启或移除后恢复不能把名称覆盖回目录名。文件夹路径、会话上下文、Native Session、运行中执行和活动排序保持不变。
本机持久化与权威边界见 [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md#local-project-display-names)。

Project 的“移除项目”菜单使用红字，确认标题为“从侧栏移除‘项目名’？”，正文为
“文件、会话记录和正在进行的执行都会保留。重新选择同一目录即可恢复显示。”；
按钮为“取消 / 移除”，确认按钮使用淡红底红字，提交时显示“正在移除…”。
该操作只从此设备的导航移除并取消相关置顶，不删除工作目录、Camp 或历史。
重新选择相同目录可恢复。Core 的访问 ledger 与运行中清理边界由架构/ADR 决定，Renderer 不用
隐藏行状态推断目录已经删除。

## 前进与后退

每个 Desktop 窗口在稳定 App 容器内维护一份内存历史，聊天、设置、记忆、队员与定时任务共享。
现有文件预览 Tabs 不是独立应用页签，不为它们建立全局导航栈，也不新增多页签系统。
`NavigationTarget` 只包含页面种类、Camp/队员/记忆 ID、设置栏目及必要筛选参数，不包含正文、组件或页面快照。
当前生产页面由 App 状态渲染；唯一协调器执行 `push / replace / back / forward`，不监听路由反推另一份历史，
不调用 Chromium 的前进后退。

- 当前实际有效的启动页面是唯一初始记录；恢复上次 Camp 也只恢复这一个起点。
- 每栈最多 50 条，包含当前页。push 先截断前进分支，再追加；超限删除最早端并同步调整游标。
- 只忽略当前目的地的重复跳转，A → B → A 保留三个步骤。
- 会话切换、新建后真正进入空白 Camp、一级页面、设置独立栏目、记忆详情选择和搜索/通知/应用内链接打开另一资源使用 push。
- 默认选择、删除后的有效页回退、同一会话临时标识正式化使用 replace。当前 Pending Camp 在激活前后沿用相同 Core ID，发送不追加记录。
- 记忆筛选、搜索、排序等原地操作使用 replace；消息收发、配置修改、内容保存、滚动、菜单、详情浮层不追加记录。
- back/forward 只移动游标，首尾无操作。后退只改变显示位置，不撤销业务数据。
- Camp 草稿与附件、队员 Runtime 草稿、Automation 自动保存继续使用已有离开保护；拒绝或失败时保留原页面与游标。
  连续请求以最新目标为准，快速后退按每次输入计算；旧读取完成不能把页面切回去，不加固定时间防抖。
  同一 Camp 的重叠离开准备共享保存与交互锁，最后一个使用者才完成释放；取代旧请求后不等待旧读取结束才解锁。
  从未实际展示的过期目标不写入历史，重新选择当前页取消尚未完成的离开并保留前进分支。
  待完成的 push 不拥有已提交历史数组；加载期间前后退沿已展示条目移动，连续游标操作继续累计。
- 页面默认选择、筛选和搜索更新只修正其所属的已展示记录，不取消较新的用户跳转；离开、重访或记录更新后，旧页面回调失效。
  待完成跳转提交时保留等待期间已经生效的页面修正。资源清理后的自动回退同样只修正当前显示，不能取消正在打开的新页面；旧预览的迟到内容不能恢复已清理资源。
- 一键新建在创建请求开始时保留导航意图；较新的用户导航使旧意图失效。迟到的创建结果只刷新导航列表，不自动进入新 Camp；
  迟到失败不重新打开创建弹窗。已创建 Camp 保留 Core 生命周期，空白 Pending Camp 仍不因刷新而变成可见列表项。
- 队员历史回放统一退出新增队员和个人资料的显示模式，显示记录指定的队员与栏目；切换显示不丢弃新队员草稿。

普通展开侧栏的窗口左上角依次为侧栏按钮、后退、前进。macOS 沿用红黄绿位置和侧栏按钮
x=82/y=5，后退 x=120、前进 x=152；按钮 30px，图标 17px，短箭头尖端为 5×5。
标题和右侧会话入口保留现有 38px 顶栏布局，中心 y=19；窗口导航按钮中心 y=20。
按钮可用性由游标派生，禁用保留位置，提供可访问名称、悬停快捷键提示和键盘焦点。
普通页面和 Desktop 设置折叠后，窗口左侧只显示展开按钮，不显示历史箭头或新增新对话图标。
macOS 与 Web 设置展开后不显示上述三个按钮，也不提供调宽操作；原侧栏中的新对话业务入口保留。

快捷键复用 `shouldHandlePrimaryShortcut`：Mac 为 ⌘[ / ⌘]，Windows 为 Ctrl+[ / Ctrl+]。
冒泡到稳定容器后才处理；输入框、编辑器、终端、IME、已消费事件和模态工作面不触发全局导航。
macOS 在根层读取 mouseup 的 button=3/4；Windows 互斥使用宿主 `app-command`，忽略 Renderer 的同次侧键。
支持的原生 Mac swipe 也发送到同一接口。Main 不执行默认 Chromium 导航，所有监听随容器/窗口清理。

历史不写文件、数据库、localStorage 或 sessionStorage，不引入 schema/存储迁移。
最小化、托盘隐藏、原窗口内普通数据刷新不清空；前端重载、窗口销毁或新的 App 会话重新初始化。
现有布局和启动位置保存机制独立保留，不把它们扩展成历史恢复。
未来 WebUI 复用业务入口但连接浏览器历史，本次不实现 WebUI。

回归：`desktop-navigation.test.ts` 验证内存状态与异步提交；`window-navigation.test.ts` 验证宿主来源；
`pnpm test:navigation-shell` 验证正式组件输入、布局和刷新清空；`pnpm test:startup-presentation`
验证生产 App 的会话/设置/记忆连续导航、慢请求取消、失败恢复与冷启动边界。

## 会话搜索

`CommandOrControl K` 的普通文字输入继续在已加载会话的标题和项目名中忽略大小写过滤，最多显示 12 项。
去掉首尾空白后，只有通过共享 `isCampId` 完整校验的输入才进入 ID 精确查询；ID 保持 canonical 小写，
不补全片段、不转换大小写，也不在未命中时回退到标题搜索。

完整 ID 经短暂防抖调用 Desktop `navigation.findCamp({ campId })`；Core 再通过 `CampId` 校验，按
`camp.id` 主键等值读取，返回单个 `NavigationCampTarget`（ID、标题、渠道来源、激活状态、项目绑定类型和路径）或
`null`。该路径覆盖未进入最近五条列表的旧会话，不加载消息或聚合活动历史，不改变已读状态。
Active Camp 和有正文或附件的 Pending Camp 可被查询；空 Pending Camp 与不存在的 ID 返回无结果。

查询期间显示加载反馈，失败与未命中分别呈现；修改输入或关闭搜索后丢弃旧请求结果。方向键选择和回车
打开沿用现有会话激活入口。普通文字输入不会调用 ID 查询，标题过滤与 ID 查找互斥。

## Quick Chat 与 Project 分组

“快速对话”在 Renderer 中是 Project 列表末尾的文件夹式投影，底层仍是 `quick_chat`，不创建
Project 领域实体。它没有 Project 菜单；其 Camp 行与目录 Project 下的 Camp 使用同一行为。
产品中文固定使用“快速对话”，英文使用 `Quick Chat`，不恢复“大厅”或 `Lobby`。

Quick Chat 首页不提供 Composer。普通“新对话”先原子创建 Active Camp；一键入口先取得
Core-owned Pending Camp 并进入同一 Composer，第一条消息成功后再原子激活。界面不得用静态
演示数据伪造日期、阶段或创建结果。

无对话首页以“开始一段协作”和“选好队员，写下你想完成的事。”引导，使用浅色底“新对话”入口。
有最近对话时直接显示“最近对话”列表，并将轻量“新对话”动作放在列表标题右侧；不把所有最近对话称为未完成。
空首页没有已配置且可用的队员时显示“还没有可用的队员”，提供“前往队员 / 查看运行时”，不把队员不可用等同于未安装运行时。
首页复用会话完成未读亮蓝色标记和真实最近活动时间；不添加独立 Composer。
“最近对话”标题与每行会话名称共用左侧文字基线，完成提示点位于左侧独立占位；没有提示点的行不改变文字缩进。

“新对话”弹窗保留工作目录、队员、队长及可选名称，队员下拉菜单按两列排列。底部提供默认不勾选的
“以后使用此队伍一键新建”：仅在本次创建成功后，将所选队员与队长和开启标记一次性保存到 Main 通用偏好；
目录与名称不进入默认配置。取消或创建失败不保存；偏好保存失败仍进入已创建的对话，并提示到“设置 → 通用”重试。
用户可在通用设置关闭一键新建。

- 新对话的队员选择仅启用已保存运行时配置且状态为 `ready` / `light_ready` 的队员，两者统一显示绿色「可用」。未保存配置显示「未配置运行时」，其他不可用状态显示「运行时不可用」，均置灰禁选。全选、队长候选及一键新建共用这条规则；运行时暂不可用时打开弹窗确认，不永久作废保存的队伍。
- 一键新建说明收进选项右侧的「?」提示，支持悬停、焦点、点击与 Escape 关闭；不再显示行内说明或「本次新建成功后生效」。

## 冷启动反馈

App 启动后立即读取本机 Main Window Session，Core capability ready 后立即读取目标数据，不用提示面阻断读取。前 400ms 不显示
“正在打开”反馈；读取在门槛内完成时直接呈现目标页面。超过 400ms 时，在仍保持挂载但不可交互的目标框架之上显示
覆盖完整 Renderer 视口的不透明品牌画布：日间使用纯白 `--conversation-surface`，夜间使用 Steel Night 的实心
`--conversation-surface`，不得透出、模糊或伪造底层页面。

画布中央只显示 48px 完整 Rovai horizon 品牌标记，以 1600ms 的轻微明暗呼吸表达等待；不显示可见文案、Spinner、进度、
骨架、背景预览或步骤信息。辅助技术仍通过单一 polite busy status 获得“正在打开会话”。`prefers-reduced-motion`
下品牌标记保持静止；目标真正 ready 后，画布用 180ms 淡出再释放交互与焦点。普通已就绪页面内部的独立加载仍保留
既有骨架与目标语义。

启动错误不等待 400ms，并切换为独立的不透明恢复面：只显示“暂时无法打开会话”以及可用的“重新打开”与“导出诊断”，
不复用品牌呼吸、不渲染原始技术错误，并把焦点约束在恢复操作内。队员页与记忆页的结构、导航和已加载内容不因反馈门槛改变。

Main Window Session 必须等待本机偏好读取后冻结恢复目标，不能把窗口创建时的临时默认值当成上次位置。窗口无需等待
这些读取或 Core 就可以出现。Core 检查/迁移期间保留非权威页面框架，业务控件与快捷键暂不接受操作；没有投影不代表
项目或会话为空。400ms 从根组件首次挂载起计算，Core ready、Onboarding admission 和目标投影之间的交接不重置计时。
只有明确 `blocked` / `crashed` 才使用 [Bootstrap Shell](bootstrap-shell.md)；本机偏好读取失败立即切换到独立恢复面。

## 导航投影新鲜度

每组先展示 5 条，“查看更多”每次请求最新完整前缀并增加 10 条。读取期间保留当前行、按钮显示
“正在读取…”并禁止重复展开；成功后才展示新范围，失败保留当前数量并允许重试。收起立即回到 5 条，
再次展开仍须重读。普通项目、置顶项目与快速对话使用相同语义，不以旧分页缓存恢复 Camp 状态。
后续通知、前台安全刷新和 focus 覆盖整个已展开窗口；后台第六条变化不必提前读取，但进入可见范围前
必须重新读取。此处的展开仅指 Camp 数量，“点击项目行折叠整个分组”的既有行为不变。

Camp 运行开始、取消或终态后，侧栏通过 Core 提交后的失效提示重读完整 Navigation Snapshot；不得等用户
打开该 Camp，也不得要求重载 Renderer 才清除运行 spinner。多个 Camp 的突发事件由一个全局协调器合并，
不存在每个 Camp 各自的轮询任务。

App 前台可见时使用约 20 秒低频安全刷新修复偶发丢失事件；隐藏时暂停，重新聚焦立即刷新。Navigation
拥有独立恢复状态，队员、Runtime Installation、Memory Review 或本机 Navigation preference 读取失败不得
停止侧栏事件刷新和安全刷新。完整并发与失败语义见
[Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)。

## 设置与返回

设置侧栏分三组：

- 应用：通用、外观、提醒；
- 能力：MCP、Skills、工具箱、运行时、远程连接、渠道；Desktop 与 Web 共用此顺序，独立 Server 隐藏渠道。
- 支持：运行监控、诊断与修复、关于与更新。

手机使用同一分类定义的分组总览与独立分类页，不显示设置搜索。总览和分类区分浏览器历史条目；
返回总览恢复滚动与来源焦点。全局抽屉持续提供五个一级入口、项目/会话与底部设置，详见
[Mobile WebUI](../host-web-mobile.md)。

返回 App 后恢复原一级页面；当前 Main Window Session 内记住最后设置分类，全新安装默认“通用”。更新
徽标的临时深链不覆盖该记忆；“关于与更新”行在有可操作 release 时显示同语义、非交互的状态徽标。设置
页面的局部构图见
[`settings-workspace` surface brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)。

队员页继续显示普通全局侧栏和 Project / Camp 导航，不再用队员名册覆盖该槽位，也不提供独立的
“返回对话 / 返回 App”控件。队员名册位于内容区左侧；用户通过全局侧栏切换页面或会话，所有切换
继续遵守未保存 Runtime 草稿保护。

当前 Camp Composer 即将因普通导航卸载或被另一 Camp 替换时，App 必须先调用同一个 Camp leave guard，等待附件
准备、Draft flush 与 mutation queue 完成后再提交目标页面。保存失败保持当前 Camp、正文和可重试交互，不切换到
设置、记忆、队员、其他 Camp 或因移除当前 Project 返回快速对话。只打开新会话 Dialog、选择/展开 Project 而未
卸载 Composer 时不构成已完成 leave；创建结果真正激活另一 Camp 时复用同一 guard。组件 cleanup 不承担这次保存。

Automation 工作区即将因全局导航卸载时，App 同样等待该工作区的当前自动保存 flush；失败则保留草稿与当前页面，
成功后才提交目标页面。

正常 App 退出也复用该 guard，但由 Main quit coordinator 在 Core shutdown 前请求；App Shell 不增加退出状态或 Draft
保存实现。保存失败时 Main 放弃本次退出，当前 Camp 保持可见且 Composer 恢复交互；成功后才进入既有
`runtime.state = shutting_down` 全局等待面。

## 宿主平台交互

macOS 保留 hidden title bar 与受控 drag region；新对话、设置、队员、定时任务和记忆页使用同一个内容列全宽、
固定 50px 的透明拖拽带，位于顶部的交互控件保留明确的 `no-drag` 点击区域。Windows 隐去包含 App 图标与
`Rovai AI` 的系统标题文字层和系统 menu bar 呈现，只以 Renderer 投影 `File / Edit / View / Window` 顶层入口；
入口经受限 IPC 打开既有 Electron 原生 submenu，不重建 command 或 accelerator。顶层菜单行与 Window Controls Overlay
都使用 `--rail` 对应色并跟随 Day / Night，行高读取系统 WCO environment value 适配 DPI；侧栏顶部预留仅在 Windows
从 38px 收至 8px。Windows caption buttons、Snap Layout、Alt+Space、双击拖拽区和多屏 DPI 仍由系统拥有，Renderer
不复制 submenu、窗口按钮或第二个 App 标题，其他页面结构和内容不因平台变化。

实现统一使用 `CommandOrControl` 动作和集中式平台文案映射：macOS 可显示 `⌘K`、Windows 显示 `Ctrl+K`；
文件定位分别显示“在 Finder 中显示”和“在文件资源管理器中显示”。可访问名称始终描述动作，不能只读出快捷键
符号。普通设备文案优先使用“此设备”；仅在确需 OS 语境时分别使用“此 Mac / 此电脑”。完整差异见
[Windows Interaction Delta](../windows-interaction-delta.md)。

## 响应式与可访问性

全局 rail 默认 270px，按上文规则调宽或完全收起。队员内容区名册默认 256px，可显式收起到 76px。最小 `1040×700` 下内容区自行
重排，不能让 rail、名册、菜单或主要操作被裁切。
Project/Camp 行、菜单、临时提醒和设置返回均可键盘操作，Icon-only 控件有可访问名称；选中、展开和
未读状态不能只靠颜色。Camp 行“有新回复”只在真正打开该会话、窗口可见且拥有焦点后消除；后台
Snapshot 刷新、设置/记忆页和应用失焦均不得提前清除。

页面缩放继续使用标准 `CommandOrControl + / - / 0` 快捷键；App 拦截 Electron 的默认倍率阶梯，
与设置页统一采用 [Chrome 桌面缩放档位](../themes/README.md#外观与阅读偏好)，按方向切换相邻档位，
到达 25% 或 500% 后停止。已有非预设比例按调整方向进入相邻档位；低于 25% 的历史保存值继续
显示和恢复，放大时进入 25%，缩小时保持当前值。`CommandOrControl 0` 重置为 100%。键盘调整后，
App Shell 在不抢夺焦点的全局浮层中短暂显示实际缩放比例，并通过 polite live region 播报同一文字。
浮层使用双主题语义 Token，在首次训练和所有一级页面上保持同一位置与行为。

## References

- [Camp Workspace 不变量](../../architecture/foundational-invariants.md#camp-workspace)
- [产品与导航不变量](../../architecture/foundational-invariants.md#product-navigation)
- [Camp 生命周期不变量](../../architecture/foundational-invariants.md#camp-lifecycle)
- [v0.57 Project remove 实施计划](../../versions/v0.57/implementation-plan.md)
- [v0.58 实施计划](../../versions/v0.58/implementation-plan.md)
- [v0.61 实施计划](../../versions/v0.61/implementation-plan.md)

## Jump search and overlay closure

⌘K / Ctrl+K opens the title/project search or exact lookup by a complete Camp ID, with a small “跳转到对话” title, neutral selected result and “↑ ↓ 选择　↵ 打开　Esc 关闭” footer. Search input has no focus underline or frame; arrows and Enter retain their behavior and respect IME composition. Closing sidebar menus, rename/delete/removal dialogs or settings does not force focus back to the entry button, including after pin mutations. Shared DOM focus for keyboard input and menu navigation remains available.

## Web 导航适配

共享 BusinessApp 拥有导航目标、离开保护和页面状态切换。Desktop 的窗口内存历史与 Web 的浏览器 History API 分别通过适配接入同一协调器；Web 页面箭头、浏览器工具栏与原生鼠标历史操作经过同一页面恢复路径。拒绝离开时恢复浏览器游标，不改变已显示页面。历史仅保存 locator，不含输入正文或认证材料。Desktop 保留 50 条窗口记录上限，Web 保留本标签页实际浏览器历史，不截断浏览器仍可到达的站内条目。Web 控件从左侧 12px 开始，不预留 macOS traffic lights；浏览器操作系统仍独立决定快捷键文案。正常连接不占据侧栏状态行，连接失败及未确认命令保留明确反馈。

## 读取范围与后台状态

普通会话切换只加载目标内容、确认其已展示的新完成内容为已读并更新目标行；不读其他分组、使命列表或
技能目录。状态/改名不重排，成员/排序变化由 Core 返回相关组完整窗口和总数，删除后正确补位。置顶 Camp
按 ID 定位，查看更多只读所在组。窗口聚焦/低频完整性恢复仍可读取摘要完整快照，后台完成独立更新所属行。
接口与恢复边界见 [Navigation Read v1](../../contracts/navigation-read-v1.md)。
