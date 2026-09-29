// Website teaching content. Keep the English and Chinese halves together.
// Screens below come from an isolated packaged App with synthetic records.
(() => {
  const { topics } = window.RovaiDocs;
  const prose = (en, zh, enParagraphs, zhParagraphs) => ({ kind: 'prose', title: [en, zh], paragraphs: [enParagraphs, zhParagraphs] });
  const fields = (en, zh, rows) => ({ kind: 'fields', title: [en, zh], rows: rows.map(([enLabel, zhLabel, enText, zhText]) => ({ label: [enLabel, zhLabel], text: [enText, zhText] })) });
  const points = (en, zh, enItems, zhItems) => ({ kind: 'points', title: [en, zh], points: [enItems, zhItems] });
  const shot = (en, zh, enText, zhText, image) => ({ kind: 'shot', title: [en, zh], body: [enText, zhText], image });
  const detail = {
    installation: [
      fields('Choose the right package', '选择对应安装包', [
        ['Mac with Apple silicon', 'Apple 芯片 Mac', 'Choose the arm64 DMG. Check About This Mac if you are unsure which processor you have.', '选择 arm64 DMG；不确定芯片类型时，在“关于本机”里查看。'],
        ['Intel Mac', 'Intel Mac', 'Choose the x64 DMG. An arm64 package is not the right installer for this machine.', '选择 x64 DMG，不要下载 Apple 芯片安装包。'],
        ['Windows PC', 'Windows 电脑', 'Choose the x64 EXE and follow the per-user setup wizard.', '选择 x64 EXE，按当前用户安装向导完成安装。']
      ]),
      prose('Installing over an older copy', '覆盖安装旧版',
        ['On a Mac, quit the old App, open the downloaded DMG and drag the new App to Applications. Confirm Replace if Finder asks. Launch from Applications after copying finishes.', 'Your conversations and settings live outside the application bundle. A normal replacement does not ask you to delete them. If you have important local work, make a separate backup before changing versions.'],
        ['在 Mac 上先退出旧版，打开下载的 DMG，把新 App 拖到“应用程序”；Finder 提示时选择“替换”，复制完成后从“应用程序”启动。', '会话和设置保存在应用包之外。常规覆盖安装不要求删除它们；重要的本地工作仍建议在跨版本安装前单独备份。']),
      points('If the system blocks launch', '启动受阻时',
        ['Read the release notes for the exact version and compare its publisher or signing guidance with the system prompt.', 'Do not repeatedly download a different processor package to work around a signing warning; processor and signing are separate checks.'],
        ['查看当前版本发布说明，对照系统提示核对发布者和签名说明。', '签名提示与芯片类型是两回事，不要靠反复更换处理器安装包来处理签名提示。'])
    ],
    quickstart: [
      fields('What to prepare', '第一次任务前需要准备什么', [
        ['Agent', '智能体', 'The coding Agent is installed and signed in on the host. Rovai coordinates it; Rovai does not replace its own account or authentication.', '在主机上安装并登录编程智能体。Rovai 负责协调，不能代替该产品自身的账号认证。'],
        ['Teammate', '队员', 'The selected teammate has a saved Agent configuration and an available status.', '所选队员已保存智能体运行配置，并显示可用状态。'],
        ['Project', '项目', 'Choose the actual working directory before asking the Agent to read or edit files.', '在请智能体读取或修改文件前，选定实际工作目录。']
      ]),
      prose('A request you can check', '先给一个容易验证的请求',
        ['Start with “Read the project structure and tell me where the download page is implemented. Do not edit yet.” This separates discovery from modification.', 'After the reply, open the Run panel. Check which teammate received the request, which steps ran, and whether a later edit would touch the project you intended. Then send a second, narrowly scoped change request.'],
        ['可以先说：“阅读项目结构，指出下载页在哪里实现，暂时不要修改。”这样先确认路径和理解，再开始编辑。', '收到回复后打开执行台，核对接收队员、执行步骤和项目位置。确认无误后，再发送范围明确的修改请求。']),
      points('When the first run does not start', '第一次执行没有启动时',
        ['Check Settings → Agents for installation and authentication, then open the teammate’s Agent configuration for model and permissions.', 'Do not treat a message in the conversation as proof that a tool ran; look for the run state and its steps.'],
        ['先到“设置 → 智能体”检查安装与认证，再到队员的“智能体配置”查看模型和权限。', '会话里出现消息不一定代表工具真正运行过，请以执行状态和步骤为准。'])
    ],
    tour: [
      fields('Where to go', '主要入口各做什么', [
        ['Left navigation', '左侧导航', 'New chat starts work; Projects and recent chats reopen the right context; Teammates opens lasting identities.', '“新对话”开始工作；项目和最近会话找回原上下文；“队员”管理长期身份。'],
        ['Conversation header', '会话顶部', 'Task, Teammates and One-on-one open views scoped to the current conversation. Run opens the execution record.', '“任务”“队员”“单聊”都针对当前会话；“执行”打开运行记录。'],
        ['Long-running pages', '持续工作入口', 'Missions tracks larger goals, Automations schedules repeatable prompts, and Memory stores reusable decisions and lessons.', '“使命板”跟进较大目标，“定时任务”处理重复请求，“记忆”保留可复用的决定和经验。'],
        ['Settings', '设置', 'General controls the interface; Agents, Skills, MCP, Channels and Remote connection control capabilities and connections.', '“通用”调整界面；智能体、Skills、MCP、渠道和远程连接管理能力与接入。']
      ]),
      prose('Keep one thread of work together', '让一项工作留在同一会话',
        ['Reopen the original project and conversation when continuing a task. The message timeline gives the discussion, while the Run panel and file preview show the evidence behind it.', 'If you need a private side question, use One-on-one inside that conversation; send any conclusion the whole team needs back to the public conversation.'],
        ['继续同一项工作时，从原项目打开原会话。消息区展示讨论，执行台和文件预览展示背后的操作证据。', '需要私下追问时，在当前会话里打开“单聊”；全队需要知道的结论，再自行发回公共会话。'])
    ],
    members: [
      shot('Identity editor', '队员资料编辑区', 'The identity section is above Agent configuration. The two Save actions commit different changes.', '资料区域位于智能体配置之上。两个“保存”按钮分别提交不同内容。', 'teammate-profile-en.png'),
      fields('Every profile field', '队员资料字段逐项说明', [
        ['Name', '名称', 'The name shown in the roster, mentions and conversation messages. It is required; give teammates distinct, recognizable names.', '显示在名册、@ 候选和会话消息中。此项必填，建议给队员使用便于区分的名字。'],
        ['Team role', '团队角色', 'A short label for the teammate’s place in the team, such as engineer, reviewer or designer. It helps people choose who to involve.', '用简短称谓说明队员在团队里的位置，例如实现、审查或设计；便于邀请时判断人选。'],
        ['Responsibilities', '专业职责', 'Describe recurring work and expected deliverables. Write a durable scope, not one temporary task from a conversation.', '说明长期负责什么、通常交付什么。这里写稳定分工，不要塞进某次会话的临时任务。'],
        ['Personality traits', '性格底色', 'Up to six short tags shape how the teammate presents and collaborates. They are not execution permissions.', '最多六个简短标签，帮助表达协作风格；它们不控制执行权限。'],
        ['Portrait', '形象', 'The avatar used to recognize the teammate in the roster, messages and run list. It has no effect on the Agent model.', '用于在名册、消息和执行列表中辨认队员，不影响智能体模型。'],
        ['Working principles', '工作准则', 'Stable rules for how this teammate approaches work, checks results and hands off work.', '写明队员处理工作、核对结果和交接时遵循的稳定原则。'],
        ['Growth focus', '成长方向', 'A longer-term capability or habit this teammate should improve through future collaboration.', '记录希望队员在后续协作中持续改进的能力或习惯。']
      ]),
      prose('Create, save and revise', '创建、保存与修改',
        ['A new teammate can be created with just a name. Add the role and responsibilities when you know what the person will do, then expand Working principles & growth focus only when you have something specific to say.', 'Save teammate profile commits identity fields. Scroll down and use the separate Agent configuration Save when you change the Agent, model or permissions. Look for the saved or unsaved state beside the relevant section.'],
        ['创建新队员时只填名称即可。明确分工后再补团队角色与专业职责；工作准则和成长方向有具体内容时再展开填写。', '“保存队员资料”提交身份字段；改变智能体、模型或权限时，要滚动到下方另点“保存智能体配置”。分别查看每一区域的已保存或未保存状态。'])
    ],
    agents: [
      shot('A teammate’s Agent configuration', '队员的智能体配置', 'This section controls future runs for this teammate and has its own Save action.', '这一区域决定队员后续执行的方式，需要单独保存。', 'teammate-agent-en.png'),
      fields('Configuration controls', '运行配置字段逐项说明', [
        ['Agent', '智能体', 'Choose the installed coding product this teammate calls. Its status reports whether the current host can use this configuration.', '选择这位队员调用的编程产品；旁边的状态反映当前主机是否能使用这份配置。'],
        ['Model', '模型', 'Default follows the Agent’s own choice. Select an explicit model only when it appears in the available catalog and you want to pin this teammate to it.', '“默认”跟随智能体自身的模型选择；只有可选列表提供且确实需要固定时，才指定具体模型。'],
        ['Model parameters', '模型参数', 'Options such as reasoning effort appear only when the chosen Agent and model support them. An unavailable option cannot be forced by a profile field.', '推理强度等选项只在所选智能体和模型支持时出现，资料字段不能强行启用不支持的参数。'],
        ['Filesystem access', '文件系统访问', 'Sets the Agent’s file access scope for runs, such as read-only or workspace-write when offered. Match it to the intended task.', '设置执行时可访问文件的范围；例如提供只读或工作区写入时，按任务需要选择。'],
        ['Approval policy', '审批策略', 'Controls when the underlying Agent asks for decisions. The available choices come from that Agent, and actual requests still need individual review.', '决定底层智能体何时向你请求决策；选项由智能体提供，实际审批仍需逐项阅读。']
      ]),
      points('Understand the status', '如何理解状态',
        ['Not installed means the product was not found on this host. Authentication required means its own sign-in is unfinished.', 'Available means this configuration passed current checks. If a saved model or parameter later becomes invalid, reselect it and save again.', 'Changing a teammate’s configuration applies to future runs; use the execution record to understand earlier runs.'],
        ['“未安装”表示主机没有找到该产品；“需要认证”表示它自己的登录尚未完成。', '“可用”表示当前配置通过检查。已保存的模型或参数以后失效时，重新选择并保存。', '修改队员配置影响后续执行；过去的执行以当时的记录为准。'])
    ],
    conversations: [
      shot('New conversation dialog', '新会话创建窗口', 'Choose the working directory, participants and lead before beginning. The name is optional but useful for finding the work later.', '开始前选择工作目录、队员和队长。名称可选，但取名后更容易找回。', 'new-chat-en.png'),
      fields('Creation choices', '创建时要决定的内容', [
        ['Workspace or project', '工作区或项目', 'The folder the Agent should work in. A project chat keeps this folder and its conversation together; Quick chat uses its managed directory.', '决定智能体工作的目录。项目会话把目录和对话关联起来；快速对话使用其受管理目录。'],
        ['Teammates', '队员', 'The people available to receive messages in this conversation. Add at least one.', '这段会话中能够接收消息的队员，至少选择一位。'],
        ['Lead', '队长', 'The default recipient when you send without an explicit @ mention. Choose the lead from the selected teammates.', '没有明确 @ 时的默认接收者，必须从已选择的队员中选。'],
        ['Chat name', '会话名称', 'A searchable title for the work. A short goal works better than a generic date.', '便于查找的标题；用简短目标比只写日期更清楚。']
      ]),
      prose('Project chats and quick chats', '项目会话与快速对话',
        ['Use a project when the task depends on a specific repository or folder. Before any file change, verify that the project path in the creation dialog is the one you intended.', 'Use Quick chat for a question that does not need a repository. When continuing work, reopen the existing conversation instead of creating a new one; its timeline, tasks and runs stay together.'],
        ['任务依赖具体仓库或目录时选择项目。涉及改文件前，核对创建窗口里的项目路径。', '不依赖仓库的问题可以用快速对话。继续原有工作时重新打开旧会话，消息、任务和执行才会留在一起。'])
    ],
    messages: [
      fields('Composer controls', '输入区各项操作', [
        ['Plain message', '普通消息', 'State the goal, constraints and what a finished result looks like. Without a selected recipient, the lead receives it.', '写清目标、限制和完成标准；未指定对象时由队长接收。'],
        ['@ mention', '@ 提及', 'Choose the teammate from the picker so the recipient is a structured mention, not merely typed text. You can address more than one teammate when supported.', '从候选框选择队员，形成可识别的提及，不要只打出一段看似 @ 的普通文字。需要时可指定多位队员。'],
        ['File or folder attachment', '文件或文件夹附件', 'Add through the attachment control, paste, or drag and drop; check that preparation finishes and the correct item appears before sending.', '通过附件按钮、粘贴或拖放加入；等准备完成，确认列表里是正确的文件或文件夹后再发送。'],
        ['Reply', '回复', 'Use a message reply when you want to point back to a particular teammate statement instead of relying on “that one.”', '要针对某条队员发言补充时使用回复，比“刚才那个”更容易定位。']
      ]),
      prose('What an attachment means', '附件的读取边界',
        ['A local attachment is a reference to a local source. If the original moves, becomes inaccessible, or changes before a later run, the Agent may not read what you expected.', 'After sending, inspect the recipient and attachment cards. If the request should not be picked up yet, use the message’s Withdraw action only while all recipients are still unclaimed.'],
        ['本地附件引用原位置。原文件移动、失去访问权限，或在后续执行前内容改变，都可能导致智能体读到的内容不符合预期。', '发送后检查接收对象与附件卡片。若要阻止尚未开始处理的请求，只有在所有接收队员都未领取时，才能从消息上撤回。'])
    ],
    execution: [
      fields('Read the execution record', '先看懂执行记录', [
        ['Teammate selector', '队员选择区', 'Switch between the overview and a teammate. Each card belongs to a particular run; do not mix one teammate’s steps with another’s reply.', '在总览与队员之间切换。每张卡对应一段执行，不要把甲队员的步骤当成乙队员回复的证据。'],
        ['Run card', '执行卡片', 'Read its state, title and duration. Expand it to see the tool steps and their results.', '查看状态、标题和用时；展开后看工具步骤与结果。'],
        ['Step detail', '步骤详情', 'A command, file read or tool result explains what happened at that step. A green step does not by itself complete the entire run.', '命令、文件读取或工具结果说明该步骤发生了什么；单步成功不代表整次执行成功。'],
        ['Origin link', '原消息入口', 'A waiting or queued item can point back to the message that caused it. Use that link before changing or withdrawing work.', '等待或排队项可定位到触发它的消息；修改或撤回工作前先回看原请求。']
      ]),
      shot('Pinned to the right', '右侧：边读会话边查步骤', 'The conversation and run record sit side by side. This is useful when comparing a reply with its command history or a file preview.', '会话与执行并排，适合一边读回复，一边核对命令过程或文件预览。', 'execution-right-en.png'),
      shot('Floating layer', '浮层：暂时展开执行详情', 'The conversation keeps its width and the Run panel floats over it. Use this to inspect a short run, then collapse the panel to return to reading.', '会话保留原宽度，执行台浮在上方；适合临时检查一段执行，看完收起继续阅读。', 'execution-floating-en.png'),
      shot('Bottom panel', '底部：查看较长的工具输出', 'The run list takes a wide lower area with a horizontal teammate strip. Drag the divider to give long commands or output more room.', '执行记录占据宽阔的下方区域，队员横向排列；长命令或输出需要更多空间时可拖动分隔线。', 'execution-bottom-en.png'),
      prose('Switching location', '切换显示位置',
        ['Open Run, then use its location button to choose Right, Floating or Bottom. The App remembers the selected layout. Changing location does not create a different run or reset the selected teammate.', 'To verify a delivery, combine the run’s final state, the teammate’s reply and any file evidence. When a run is stopped or interrupted, inspect effects already made before retrying.'],
        ['打开执行台后，用位置按钮选择“右侧”“浮层”或“底部”。应用会记住选择；切换位置不会生成新执行，也不会重置当前查看的队员。', '核对交付时结合执行终态、队员回复和文件证据。遇到停止或中断，重试前先确认已有影响。'])
    ],
    tasks: [
      shot('Create a task', '创建任务', 'Give a task one checkable outcome and a responsible teammate. The task editor keeps responsibility distinct from the public message stream.', '给任务写一个可核对的结果并指定负责人；任务编辑区把责任从消息流中单独记录。', 'task-editor-en.png'),
      fields('Task fields and states', '任务字段和状态', [
        ['Title', '标题', 'A concise result or deliverable, such as “Check platform links.”', '用简短文字写交付结果，例如“核对平台下载链接”。'],
        ['Responsibilities and requirements', '职责与要求', 'Explain the scope, constraints and what to check when finished. Keep source paths or acceptance criteria here when useful.', '说明范围、限制及完成时如何检查；必要时写上源文件路径或验收条件。'],
        ['Lead', '负责人', 'The teammate accountable for the task. Choose someone who is in the current conversation.', '负责推动此任务的队员，应在当前会话内。'],
        ['Status', '状态', 'Use Pending, In progress, Blocked, Complete or Cancelled to show what is happening. A status change records tracking; it does not prove code or files changed.', '用待处理、进行中、受阻、完成或取消表示进度。状态是跟踪信息，不能单独证明文件已修改。']
      ]),
      points('Task versus execution', '任务与执行的关系',
        ['A task is the durable responsibility inside this conversation. One or more Agent runs may contribute to it.', 'Cancelling a task does not automatically stop a run that is already active. If work must cease, open that exact run and stop it separately.', 'Use the task detail to review progress, then inspect execution and files for the actual outcome.'],
        ['任务是会话内持续跟踪的责任；一次或多次智能体执行都可能参与。', '取消任务不会自动停止已经启动的执行。需要停工时，在执行台单独停止对应运行。', '从任务详情看进展，再到执行和文件里核对真实结果。'])
    ],
    'session-members': [
      shot('The conversation team', '当前会话的队员列表', 'This panel changes who participates in this conversation. It does not edit the person’s lasting profile.', '这里调整当前会话有哪些队员参与，不修改其长期资料。', 'conversation-members-en.png'),
      fields('Actions in the team panel', '会话内队员操作', [
        ['Invite', '邀请', 'Search the roster and add a teammate to this conversation so they can receive future work here.', '从名册搜索并加入队员，让其参与这段会话的后续工作。'],
        ['Set lead', '设为队长', 'Changes the default recipient for public messages without an explicit @ mention.', '改变未指定 @ 时公共消息默认交给谁。'],
        ['View model', '查看模型', 'Shows the teammate’s current Agent/model information before you assign work.', '分配工作前查看该队员当前智能体和模型信息。'],
        ['Remove', '移出会话', 'Read the confirmation preview: active runs, tasks and queued deliveries may be affected. Keep at least one teammate and choose a new lead before removing the old lead.', '先阅读确认预览，正在执行、任务和排队投递可能受影响。会话至少保留一人；移出队长前先选继任者。']
      ]),
      prose('Roster versus conversation', '名册与会话是两层范围',
        ['A teammate in the global roster can appear in many conversations. Editing a profile changes that lasting identity; inviting or removing from one conversation changes only its participant list.', 'Before removing someone, settle their pending work or decide who will take over. Then confirm the visible preview rather than assuming the operation only hides an avatar.'],
        ['全局名册中的队员可以参加多段会话。编辑资料改变长期身份；在一段会话中邀请或移出只调整该会话的参与名单。', '移出前先处理或交接待办，再按确认预览操作，不要把“移出”理解为只隐藏头像。'])
    ],
    singlechat: [
      { kind: 'diagram', title: ['How public and one-on-one sessions relate', '公共会话与单聊的关系'] },
      prose('One conversation, separate message streams', '同一项目下，两种消息流',
        ['A one-on-one chat lives inside the current conversation and uses its project/workspace. The public transcript remains the place for team discussion.', 'Each teammate has a separate private transcript, draft, FIFO queue and Agent run. Private text and attachments do not appear on the public timeline. A private queue blocks only that teammate’s private session, not other one-on-one chats or public work.', 'Some public context may be supplied to the private Agent as context. The diagram describes visible transcripts and work queues, not an absolute knowledge barrier.'],
        ['单聊属于当前会话，沿用它的项目和工作目录；公共消息流仍是全队讨论的地方。', '每位队员各有独立的私聊记录、草稿、先进先出队列和智能体执行。单聊正文与附件不会出现在公屏；某位队员的私聊排队只阻塞该单聊，不阻塞其他单聊或公共工作。', '系统可能按范围把部分公共上下文提供给私聊智能体。图示区分的是可见记录与工作队列，不表示知识绝对隔离。']),
      shot('The one-on-one panel', '单聊面板', 'Choose the target teammate at the top, write in the private composer and check the “visible only to you” indicator before sending.', '顶部选择目标队员，在私聊输入区写消息；发送前核对“仅你可见”的提示。', 'singlechat-en.png'),
      points('Ending or sharing a conclusion', '结束单聊与分享结论',
        ['Switching the target opens that teammate’s own private thread. A message queued for Dingding does not become a message for Cheese.', 'Ending a one-on-one removes its visible transcript; a later chat with the same teammate starts blank. Read the confirmation before using End.', 'If a conclusion should affect the whole team, copy its substance into the public conversation yourself.'],
        ['切换目标时进入该队员自己的私聊；给叮叮排队的消息不会变成给另一位队员的消息。', '结束单聊会移除可见记录；以后再找同一队员会从空白开始。点击“结束”前请读确认提示。', '需要全队采用某项结论时，请自行把要点带回公共会话。'])
    ],
    approvals: [
      fields('Read before deciding', '逐项看清再决定', [
        ['Requested action', '请求的操作', 'Read the command, target or raw request. Identify the files, network destination or system action it affects.', '阅读命令、目标或原始请求，辨认涉及的文件、网络地址或系统操作。'],
        ['Context', '上下文', 'Compare the request with the task you gave and the run step that produced it.', '对照你给出的任务及触发审批的执行步骤。'],
        ['Native choices', '原生选项', 'Choose among the options supplied by that Agent; wording and scope can differ between Agents.', '从该智能体提供的选项中选择，不同智能体的措辞与授权范围可能不同。'],
        ['Multiple requests', '多项待审批', 'Use previous/next controls to inspect each request. A decision applies to the displayed request, not the whole batch.', '用上一项、下一项逐个查看。一次决策只作用于当前显示的请求。']
      ]),
      prose('Where approval appears', '审批出现在哪里',
        ['Pending approval is docked above the public composer, with an indicator in the conversation header. Private chat can also produce an approval request.', 'After deciding, return to the run. The Agent may still fail, be interrupted or produce a different outcome; the approval only resolves that request.'],
        ['待审批区域停靠在公共输入区上方，会话顶部也有入口；单聊执行也可能提出审批。', '作出决定后回到执行台继续观察。智能体之后仍可能失败、中断或产生不同结果；审批只解决这项请求。'])
    ],
    files: [
      fields('Three related views', '三种相关信息不要混淆', [
        ['File preview', '文件预览', 'Opens a file from a supported message or run link beside the conversation. Use it to read the current content.', '从受支持的消息或执行链接在会话旁打开文件，查看当前内容。'],
        ['Execution step', '执行步骤', 'Records an Agent file read, command or tool action. Reading a file is evidence of inspection, not a file change.', '记录智能体读取文件、执行命令或调用工具；读取过文件不等于修改过。'],
        ['Files Changed', '文件变更', 'Shows a cumulative diff only when reliable change evidence is available. Expand each file and compare the actual lines.', '只有存在可靠变更证据时才显示累计差异；展开每个文件，对照具体行变化。']
      ]),
      points('Review a delivery', '怎样核对一次修改',
        ['First read the teammate’s explanation and the final run state.', 'Open each relevant changed file. Check paths, removed lines, added lines and any test or build output.', 'If Files Changed is empty or unavailable, do not infer a modification from a step label alone; inspect the project directly.'],
        ['先看队员说明和执行终态。', '逐个打开相关变更文件，核对路径、删除行、新增行，以及测试或构建输出。', '“文件变更”为空或不可用时，不要仅凭步骤名称推断已修改；直接检查项目文件。'])
    ],
    recovery: [
      fields('Different interruption cases', '几种中断分别处理', [
        ['Stop this run', '停止这次执行', 'Focus the active run and use its Stop control. This targets that run, not every teammate or queued request.', '聚焦正在运行的具体记录，再使用“停止”；它只针对这次运行，不会停止所有队员或全部排队请求。'],
        ['App or host closes', '应用或主机关闭', 'Reopen the same conversation and inspect the recorded state before sending the same request again.', '重新打开原会话，先查看记录的状态，再决定是否重发相同请求。'],
        ['Agent or network fails', '智能体或网络失败', 'Read the error and last successful step. Correct authentication, connection or input before retrying.', '阅读错误和最后一个成功步骤，先修复认证、连接或输入问题。']
      ]),
      prose('Why inspection comes before retry', '为什么重试前必须检查',
        ['A stop or crash cannot undo file writes already completed. The public reply may also be missing even when earlier tool steps ran.', 'Look at the run, any files it touched and the pending queue. Then send a follow-up that says what is already done and what remains, rather than blindly repeating the entire task.'],
        ['停止或崩溃无法撤销此前已写入的文件；即使公屏没有最终回复，前面的工具步骤也可能运行过。', '先检查执行记录、相关文件和待处理队列。接着说明哪些已完成、哪些未完成，再发后续请求，避免盲目重复整项任务。'])
    ],
    'message-queue': [
      fields('Where a request waits', '请求可能停在哪一层', [
        ['Unclaimed public message', '未领取的公共消息', 'Withdraw appears on your message only before any recipient claims it. Once the first recipient claims it, withdrawal is no longer available.', '在所有接收队员尚未领取前，你的消息上才会出现“撤回”；第一位队员领取后就不能撤回。'],
        ['Waiting delivery', '等待投递', 'The message has a recipient but is waiting to be delivered. Locate the original message before changing the plan.', '消息已有接收对象，但尚在等待投递；调整计划前先定位原消息。'],
        ['Queued run', '排队执行', 'The recipient’s work waits behind current work. The execution panel shows the queue; it is not a message-withdraw control.', '接收队员的工作排在当前任务之后。执行台显示队列，但这里不是消息撤回入口。'],
        ['One-on-one queue', '单聊队列', 'A private message sent while the teammate is busy joins that private session’s FIFO. Move it back to the composer to edit or remove it from the queue.', '队员忙碌时发出的私聊消息进入该单聊的先进先出队列；可移回输入区修改，或从队列移除。']
      ]),
      prose('Choose the right correction', '按所处状态纠正请求',
        ['If the public message is still unclaimed, withdraw it from the message card and send a clearer version. If already claimed, inspect the run and send a follow-up instead.', 'For a private queue, edit or remove the queued item in the one-on-one panel. Editing a private item does not change the public timeline.'],
        ['公共消息还未领取时，从消息卡片撤回，再发送更清楚的版本；已领取时先看执行，再发送补充说明。', '私聊排队项可在单聊面板修改或移除。修改私聊队列不会改动公共消息流。'])
    ],
    automations: [
      shot('Scheduled task editor', '定时任务编辑页', 'Write a repeatable request, choose one teammate and the project where that request should run, then choose its trigger.', '写清可重复执行的请求，选定队员和运行项目，再设置触发方式。', 'automation-editor-en.png'),
      fields('What each setting controls', '各项设置决定什么', [
        ['Name and prompt', '名称与提示词', 'The name helps you find the schedule; the prompt is the actual work the teammate receives. Include the expected result and limits in the prompt.', '名称方便查找；提示词才是队员实际收到的工作。提示词应写清结果与边界。'],
        ['Teammate', '执行队员', 'One teammate receives the scheduled request. Their Agent configuration must be usable on the host at run time.', '由一位队员接收定时请求；触发时主机上的智能体配置需要可用。'],
        ['Run project', '运行项目', 'Select Quick chat for general work or a project for repository-specific work. Check the folder before granting file-changing tasks.', '一般事务可选快速对话；涉及仓库时选对应项目。允许改文件前核对目录。'],
        ['Schedule', '时间计划', 'Choose daily, weekdays, weekly, once, custom Cron or manual. Check the displayed time and next-run value after saving.', '可以选择每天、工作日、每周、仅一次、自定义 Cron 或手动；保存后看显示的时间与下次运行。'],
        ['Channel notification', '渠道通知', 'When available, a selected channel Bot can send the outcome. This is separate from whether the Agent run itself succeeded.', '可用时可选渠道 Bot 通知结果；通知是否送达与智能体执行是否成功是两件事。']
      ]),
      prose('After the schedule is saved', '保存后的管理方法',
        ['The task list shows whether a schedule is on and when it will run next. Open its detail to edit it, turn it off, run it manually or inspect history.', 'At trigger time the host and Agent must be available. A history row with a conversation opens the work that actually ran; a skipped row may have no conversation to open.'],
        ['列表展示任务是否启用及下一次时间。进入详情后可修改、关闭、手动运行或查看历史。', '触发时主机与智能体必须可用。有会话的历史记录可以打开实际执行；跳过的记录可能没有可打开的会话。'])
    ],
    missions: [
      shot('Create a mission', '创建使命', 'A mission starts with a clear goal and description, then links to a project and team.', '使命从清晰的目标与说明开始，再关联项目和队伍。', 'mission-editor-en.png'),
      fields('Mission details', '使命内容怎么填', [
        ['Name', '名称', 'State the larger outcome you want, not one command. It becomes the board card title.', '写较大的目标，而不是某条命令；会显示为看板卡片标题。'],
        ['Description', '说明', 'Explain the background, expected result and conditions for considering the mission done.', '交代背景、预期结果，以及什么情况可以认为目标完成。'],
        ['Project', '项目', 'Connect work to the correct folder or context when the mission depends on files.', '目标依赖文件时，关联正确的工作目录或项目上下文。'],
        ['Team and lead', '队员和队长', 'Choose the people who will work on the goal and who coordinates the conversation.', '确定参与目标的队员，以及负责协调会话的队长。'],
        ['Tags', '标签', 'Optional labels for filtering and finding related missions on the board.', '用于看板筛选和查找的可选标签。']
      ]),
      prose('Board status and actual progress', '看板状态与实际进展',
        ['The board groups missions by needs you, not started, in progress and completed. Open a card to read activity and jump to its working conversation; filters narrow the board when it grows.', 'Creating a mission records the goal. Starting it initiates work. Dragging a card or using its action menu changes tracking status; check the conversation and execution before marking it complete.'],
        ['看板按“需要你”“未开始”“进行中”“已完成”组织。打开卡片可看活动并进入工作会话；任务多时使用筛选。', '新建使命只是记录目标；开始使命才推动执行。拖卡片或使用菜单会改变跟踪状态；标记完成前仍要看会话与执行。'])
    ],
    memory: [
      shot('Add a memory', '新增记忆', 'The editor asks for scope, type, a self-contained main text and optional retrieval keys.', '编辑器要求选择范围、类型，填写能独立理解的正文，检索关键词可选。', 'memory-editor-en.png'),
      fields('Memory fields', '记忆字段逐项说明', [
        ['Scope', '范围', 'Shared memory is available to the team; teammate memory belongs to one teammate; between-teammates memory records a relationship. Choose the smallest scope that still fits.', '共享记忆面向团队；队员记忆属于某位队员；队员之间的记忆记录协作关系。按实际需要选择范围。'],
        ['Type', '类型', 'Preferences capture recurring choices, Agreements record decisions, and Experiences preserve lessons from work.', '偏好记录反复适用的选择，约定记录已达成的决定，经验保存工作中得到的教训。'],
        ['Main text', '正文', 'Write the decision or lesson so it makes sense without reopening the original conversation. Avoid temporary status updates.', '让读者不打开原会话也能理解决定或经验；不要只写短暂的进度状态。'],
        ['Retrieval Keys', '检索关键词', 'Up to three terms help future retrieval; they do not replace the main text.', '最多三个关键词帮助以后检索，不能代替正文。'],
        ['Source and versions', '来源与版本', 'A saved item can show where it came from and how it changed. Review this before relying on an older entry.', '保存后可查看来源和修订历史；沿用旧条目前先核对这些信息。']
      ]),
      prose('Keep the library current', '维护记忆库',
        ['Search or filter the library by scope and review status. Open an entry before using it in a new project: a previously useful fact can become outdated.', 'Revise an incorrect item instead of leaving contradictory copies. Use Stop using when it no longer applies. Items created by teammates may require review or verification before you rely on them.'],
        ['按范围和审核状态搜索、筛选记忆。新项目使用前打开条目核对，旧经验可能已经过时。', '内容有误时通过“修订”更新，避免留下互相矛盾的副本；不再适用时选“停止沿用”。队员创建的条目可能需要审核或验证。'])
    ],
    skills: [
      fields('Three ways Skills appear', 'Skills 的三个入口', [
        ['Settings → Skills', '设置 → Skills', 'Select an Agent to inspect the native Skills it exposes and read their descriptions. This page is an inventory, not a Skill editor.', '选择智能体，查看它提供的原生 Skill 及说明。此页用于查看，不是编辑器。'],
        ['Settings → Toolbox', '设置 → 工具箱', 'Read a built-in collaboration tool’s instructions and assign the teammates who should receive it.', '阅读内置协作工具的说明，指定哪些队员可使用。'],
        ['Composer / picker', '输入区 / 选择器', 'Type / in a conversation and choose an available Skill for this request. The selection appears as a structured draft token.', '在会话里输入 /，为本次请求选择可用 Skill；选择结果会作为结构化标记出现在草稿中。']
      ]),
      prose('When to use which entry', '何时使用哪个入口',
        ['Use the Skills inventory to learn what the selected Agent already knows how to do. Use Toolbox for durable teammate assignment. Use the composer picker to call attention to one Skill in a specific message.', 'After sending, inspect the execution and result. Choosing a Skill is a request to the Agent, not a guarantee that every instruction in that Skill was followed.'],
        ['想知道智能体已有能力时看 Skills 清单；需要长期给队员分配协作工具时用工具箱；某条消息需要指定 Skill 时用输入区选择器。', '发送后仍要查看执行与结果。选中 Skill 是向智能体提出使用要求，不保证其中每条指令都已经执行。'])
    ],
    mcp: [
      shot('MCP configuration editor', 'MCP 配置编辑器', 'Paste or edit the server JSON, then choose which teammates may receive this capability.', '粘贴或编辑服务端 JSON，再选择可接收此能力的队员。', 'mcp-editor-en.png'),
      fields('Before saving a server', '保存服务前核对', [
        ['Configuration JSON', '配置 JSON', 'Check the server name, launch command or endpoint and required environment values against the server’s own instructions.', '按服务自身说明核对名称、启动命令或地址，以及必要环境值。'],
        ['Teammate assignment', '队员分配', 'Choose the teammates who should be able to use the server. A server in the list is not automatically assigned to everyone.', '选择允许使用此服务的队员；列表里有配置，不代表全员都已分配。'],
        ['Import', '从本机导入', 'Review imported settings before saving. Another app’s config may rely on paths or credentials that are not valid for this Agent.', '导入后先检查再保存；别的应用的路径或凭证未必适用于当前智能体。'],
        ['Credentials', '认证信息', 'Use the server’s required credential mechanism and keep real secrets out of messages and screenshots.', '按服务要求配置凭证，真实密钥不要放进会话消息或截图。']
      ]),
      prose('Verify with a small tool call', '用小范围调用验证',
        ['Ask the assigned teammate for a safe read-only lookup. Open the Run panel and find the actual MCP tool call and result.', 'If it fails, check the server process or endpoint, credential availability, teammate assignment and Agent support. “Configured” describes intent; the run proves whether the tool was used.'],
        ['让已分配的队员先做一次安全的只读查询，再到执行台找实际 MCP 工具调用和返回。', '失败时检查服务进程或地址、凭证、队员分配及智能体支持情况。“已配置”只是目标，实际调用以执行记录为准。'])
    ],
    channels: [
      fields('Connection pieces', '渠道接入的几个环节', [
        ['Provider', '平台', 'Choose the Feishu, Lark or DingTalk path that matches the external organization. Each provider has its own app and bot requirements.', '按组织实际使用的平台选择飞书、Lark 或钉钉；各平台的应用和 Bot 要求不同。'],
        ['Account and app', '账号与应用', 'Complete the provider’s authorization and application setup shown in Rovai. The account must have the permissions needed to publish the bot.', '按 Rovai 页面提示完成平台授权和应用设置；账号需要具备发布 Bot 所需权限。'],
        ['Teammate bot', '队员 Bot', 'Connect the external bot to the intended teammate so messages reach the right Agent configuration.', '把外部 Bot 关联到目标队员，使外部消息进入正确的智能体配置。'],
        ['Publication and connection', '发布与连接', 'Finish provider publication, then check Rovai reports the bot connected. Setup in one interface alone may not make the bot usable.', '完成平台发布，再确认 Rovai 显示已连接。只在一边填完设置未必能实际收发。']
      ]),
      prose('Test the full route', '做一次完整收发测试',
        ['Send a small message from the intended external chat. Confirm which teammate received it, where the reply appeared and whether an execution record was created.', 'The connected host still runs the Agent. If messages do not arrive, check provider permissions, bot publication, connection state and the target conversation before sending bigger work.'],
        ['从准备使用的外部聊天发送一条简短消息，核对接收队员、回复位置和执行记录。', '智能体仍在连接的主机上运行。消息未到达时先查平台权限、Bot 发布、连接状态与目标会话，再安排更大的工作。'])
    ],
    remote: [
      fields('Host and browser roles', '主机与浏览器各负责什么', [
        ['Host App', '主机应用', 'Runs Rovai, keeps the project files and starts the Agent. It must stay running for remote work.', '运行 Rovai、保存项目文件并启动智能体；远程使用时需要保持运行。'],
        ['Remote service', '远程服务', 'Enabled in Settings → Remote connection. The page displays the address and connection state you should verify.', '在“设置 → 远程连接”启用；页面会显示需要核对的地址与连接状态。'],
        ['Browser', '浏览器', 'Signs in to the host’s workspace and displays conversations. Opening a browser does not copy the repository or move execution to that device.', '登录并显示主机工作台；浏览器不会自动复制仓库，也不会把执行迁到访问设备。'],
        ['Outside the local network', '跨网络访问', 'Arrange a reachable private network or HTTPS entry before using the address away from the host network.', '离开主机所在网络前，先配置可到达主机的私有网络或 HTTPS 入口。']
      ]),
      prose('A useful connection check', '怎样验证连接',
        ['Open an existing conversation from the browser, read a known reply, then return to the host to verify the same conversation. For a write task, also check the host project path.', 'If the browser connects but a run cannot start, look at the host App and Agent state; the browser being open is only one part of the route.'],
        ['浏览器打开已有会话，读一条已知回复，再回主机确认是同一会话。涉及写文件时还要核对主机项目路径。', '浏览器能连接但任务不能启动时，检查主机应用和智能体状态；浏览器打开只说明链路的一部分可用。'])
    ],
    compatibility: [
      fields('Check these separately', '分别检查这几件事', [
        ['App package', '应用安装包', 'The Download page lists the assets in the selected release. Match macOS arm64, macOS x64 or Windows x64 to the machine.', '下载页列出该版本实际提供的文件；按机器选择 macOS arm64、macOS x64 或 Windows x64。'],
        ['Agent installation', '智能体安装', 'Settings → Agents detects products available on this host. Installation and product authentication are separate steps.', '“设置 → 智能体”检测主机上的产品；安装与该产品自身的认证是两步。'],
        ['Teammate configuration', '队员配置', 'Each teammate selects an Agent, model and supported parameters. A globally available Agent is not automatically assigned to every teammate.', '每位队员分别选择智能体、模型与受支持参数；全局可用不等于已给所有队员分配。'],
        ['Run readiness', '执行就绪', 'Use a small real request and inspect its Run panel. A product may be detected but still lack account access, a supported model or permission.', '发送一条小范围真实请求并查看执行台。产品即使被检测到，也可能缺少账号权限、可用模型或文件权限。']
      ]),
      prose('When moving between computers', '换电脑时',
        ['Install the App and desired Agent on the new host, sign in to the Agent, then inspect each teammate’s configuration and project paths there.', 'Do not assume a status observed on one host applies to another host; availability is checked against the computer doing the work.'],
        ['在新主机上安装应用和所需智能体，完成智能体登录，再核对每位队员的配置与项目路径。', '一台主机上的可用状态不能直接套到另一台；实际可用性取决于运行工作的电脑。'])
    ],
    preferences: [
      shot('Language and startup', '语言与启动位置', 'The top of General controls the App language and the page opened on the next launch.', '通用页上半部控制界面语言，以及下次启动后先打开哪里。', 'general-language-en.png'),
      fields('Interface language', '界面语言', [
        ['Simplified Chinese', '简体中文', 'Switches App-owned navigation, labels and settings to Chinese immediately after the preference is saved.', '保存后立即把应用提供的导航、标签和设置切换为中文。'],
        ['English', 'English', 'Switches those App-owned controls to English. Existing messages, teammate names and project files remain in their original language.', '把应用提供的控件切为英文；历史消息、队员名字和项目文件仍保留原文。'],
        ['Save failure', '保存失败', 'If the preference cannot be saved, the switch reverts and an error appears. Retry after checking the App state.', '偏好保存失败时会回退并显示错误；检查应用状态后再重试。']
      ]),
      fields('Open on startup', '启动后打开', [
        ['Last location', '上次位置', 'Return to the last supported conversation, teammate page or memory page instead of starting from the home page.', '回到上次使用的会话、队员或记忆页面，而不是每次从首页重新找。'],
        ['Quick chat', '快速对话', 'Open the Quick chat home page at every launch. Existing project conversations remain available from navigation.', '每次启动都进入快速对话首页；原有项目会话仍可从导航打开。']
      ]),
      shot('New conversation defaults', '新对话的默认设置', 'Select teammates and a lead, save them, then decide whether creation should skip the dialog.', '先选择并保存默认队员和队长，再决定新建时是否跳过创建窗口。', 'general-new-chat-en.png'),
      fields('New conversation controls', '新对话设置逐项说明', [
        ['Default teammates', '默认队员', 'The members preselected for new conversations. This does not add them to conversations that already exist.', '新建会话时预选的队员；不会自动加入现有会话。'],
        ['Default lead', '默认队长', 'The default recipient for a new conversation. It must be one of the selected default teammates.', '新会话中的默认接收者，必须属于已选择的默认队员。'],
        ['Save defaults', '保存默认配置', 'Teammates and lead are saved together. If a saved teammate later becomes invalid, reselect and save before relying on one-click creation.', '默认队员和队长一起保存。已保存对象以后失效时，重新选择并保存，再使用一键创建。'],
        ['One-click creation', '一键创建新对话', 'After confirmation, a supported New entry creates an empty conversation with the saved team, without the creation dialog.', '确认开启后，受支持的新建入口会使用已保存队伍直接创建空白会话，不再显示创建窗口。']
      ]),
      prose('How one-click chooses the project', '一键创建如何决定项目',
        ['The selected project or entry point still determines where work lives: a project’s plus button uses that project, the Quick chat plus button uses Quick chat, and the top New chat follows the selected project. An entry that needs a workspace choice can still ask for one.', 'One-click creation does not send a message or start an Agent run. If defaults are missing or invalid, Rovai opens the normal creation dialog so you can correct them. Turn one-click off when you want to choose the team, lead or name for each new conversation.'],
        ['项目入口仍决定工作位置：项目旁的加号使用该项目，快速对话旁的加号使用快速对话，顶部“新对话”跟随当前所选项目；需要选择工作区的入口仍可能要求你选择。', '一键创建只生成空白会话，不会自动发送消息或启动智能体。默认配置缺失或失效时会回退到正常创建窗口。若每次都想改队员、队长或名称，可以关闭一键创建。']),
      points('Other General controls', '通用页其他设置',
        ['World map controls whether its view and controls appear in conversations; it does not change the conversation’s messages.', 'Window size and position are remembered automatically on desktop. Use Reset window if the saved layout becomes inconvenient.', 'Appearance is a separate Settings page. Changing presentation does not rewrite existing conversation content.'],
        ['“世界地图”决定会话中是否显示地图视图及控制项，不改变会话消息。', '桌面端会自动记住窗口大小和位置；布局不方便时可用“重置窗口”。', '外观在单独的设置页调整；显示变化不会改写已有会话内容。'])
    ],
    notifications: [
      shot('Notification categories', '通知类别', 'The master switch sits above grouped conversation, mission and task reminders.', '总开关位于会话、使命和任务三组提醒之上。', 'notifications-en.png'),
      fields('Conversation reminders', '会话提醒逐项说明', [
        ['Pending approval', '待审批', 'Alerts when a public or private Agent run asks you to decide on a permission request.', '公共或私聊执行请求你处理权限时提醒。'],
        ['Mentioned you', '有人提及你', 'Alerts when a teammate explicitly mentions you in a public conversation.', '队员在公共会话里明确提及你时提醒。'],
        ['This round completed', '本轮完成', 'A single reminder after all collaboration caused by that message is complete.', '由某条消息触发的协作全部完成后提醒一次。'],
        ['One-on-one reply', '单聊回复', 'Alerts when the selected teammate replies in a private chat.', '队员在单聊中回复时提醒。'],
        ['Execution not completed', '执行未完成', 'Alerts when a public or private run fails or remains incomplete.', '公共或单聊执行失败、未完成时提醒。']
      ]),
      fields('Mission and task reminders', '使命与任务提醒', [
        ['Mission requires you', '使命需要你', 'A mission enters the state that calls for your attention.', '使命进入需要你处理的状态时提醒。'],
        ['Mission status change', '使命状态变更', 'Choose which mission states trigger an alert, such as completion.', '可指定哪些使命状态变化要提醒，例如完成。'],
        ['Task status change', '任务状态变更', 'Choose task states such as Complete, Blocked or Cancelled according to what you need to follow.', '按需要选择任务完成、受阻或取消等状态。']
      ]),
      prose('Master switch and old events', '总开关与历史事件',
        ['Turning App notifications off quiets current-conversation reminders, including its missions and tasks. Re-enabling notifications does not replay old messages as new alerts.', 'Open the underlying conversation or approval before acting: the notification is a short pointer, not the full request or execution evidence.'],
        ['关闭应用通知会让当前会话及其使命、任务提醒保持安静；重新开启不会把旧消息重新弹出。', '行动前应打开关联会话或审批原文；通知只是简短入口，不包含完整请求和执行证据。'])
    ],
    usage: [
      shot('Agent usage view', '智能体用量页面', 'The page filters reported usage by time range, Agent, provider, model and cost grouping. Missing source data remains unknown.', '页面可按时间、智能体、提供商、模型和成本层级查看已报告的用量；缺失值仍是未知。', 'usage-en.png'),
      fields('Filters and measures', '筛选项与数据', [
        ['Time range', '时间范围', 'Switch among the past 24 hours, 7 days and 30 days to compare similar periods.', '可选过去 24 小时、7 天或 30 天；比较时保持时间范围一致。'],
        ['Agent / provider / model', '智能体 / 提供商 / 模型', 'Narrow the table to the source you want to investigate. Model names and availability depend on the source Agent.', '将记录缩小到要分析的来源；模型名称与可用性取决于来源智能体。'],
        ['Tokens and cache', 'Token 与缓存', 'These numbers come from what the Agent reports for a run. A source that omits a field does not imply zero use.', '来自智能体对执行的报告；来源未提供某字段，不代表用量为零。'],
        ['Cost grouping', '成本层级', 'View by model call, turn, run or session when the source provides enough attribution.', '来源具备足够归因数据时，可按模型调用、轮次、执行或会话查看。'],
        ['Export', '导出', 'Use JSON export when you need to inspect or compare the reported raw entries outside the App.', '需要在应用外检查或比较已报告记录时，可导出 JSON。']
      ]),
      prose('Read the number with its coverage', '看数字时同时看覆盖范围',
        ['A missing value is unknown, not zero. A cost estimate shown in Rovai may differ from the provider’s final bill or account usage page.', 'When a run appears absent, check its time range and Agent filter, then compare with the execution record. Use Refresh for newly completed work.'],
        ['缺失值是未知，不是零。Rovai 中显示的成本估算可能与服务商最终账单或账号用量页不同。', '某次执行没出现时，先核对时间范围和智能体筛选，再对照执行记录；新完成的工作可点击刷新。'])
    ]
  };

  // The overview screenshot is intentionally limited to the first-task guide.
  for (const id of ['tour', 'members', 'conversations', 'execution', 'automations', 'missions', 'compatibility']) delete topics[id].sections[0].image;
  for (const [id, sections] of Object.entries(detail)) topics[id].sections.splice(1, 0, ...sections);
})();
