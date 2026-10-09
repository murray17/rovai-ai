// Continuous tutorials. Screenshots and outcomes are backed by review/evidence-manifest.json.
(() => {
  const {topics,groups}=window.RovaiDocs;
  const P=(en,zh,ep,zp)=>({kind:'prose',title:[en,zh],paragraphs:[ep,zp]});
  const S=(en,zh,ep,zp)=>({kind:'steps',title:[en,zh],steps:[ep,zp]});
  const F=(en,zh,rows)=>({kind:'fields',title:[en,zh],rows:rows.map(([a,b,c,d])=>({label:[a,b],text:[c,d]}))});
  const Q=(en,zh,e,z)=>({kind:'prompt',title:[en,zh],body:[e,z]});
  const I=(en,zh,e,z,file,ae,az)=>({kind:'shot',title:[en,zh],body:[e,z],image:file,alt:[ae||e,az||z],caption:[e,z]});
  const D=(en,zh,file,e,z)=>({kind:'diagram-file',title:[en,zh],file,alt:[e,z],caption:[e,z]});
  const L=(ids)=>({kind:'links',title:['Continue reading','接着阅读'],links:ids.map(id=>({id,label:topics[id].title}))});
  const T=(en,zh,e,z,sections)=>({title:[en,zh],lead:[e,z],sections});
  const prepend=(id,sections)=>{topics[id].sections=[...sections,...topics[id].sections];};
  const references=(id)=>topics[id].sections.filter(s=>['fields','diagram'].includes(s.kind));
  const related=(id,ids)=>topics[id].sections.push(L(ids));
  const implementationEn='Improve the Orbit download page. Show separate Apple Silicon, Intel and Windows x64 choices, each linked to its existing downloads/orbit-*.txt fixture. Clearly label these as tutorial files, not installers. Add matching notes, a responsive layout and visible keyboard focus. Work only in this project. Check the actual links and markup, then report changed files, checks performed and remaining limitations.';
  const implementationZh='完善 Orbit 下载页。分别展示 Apple Silicon、Intel 和 Windows x64，并指向现有 downloads/orbit-*.txt 文件。明确说明这是教程演示文件，不是安装包。补充对应说明、窄屏布局和键盘焦点样式。只修改当前项目。检查实际链接和页面结构，最后列出改动文件、实际完成的检查，以及仍未验证的部分。';
  const reviewEn='Independently review the current Orbit changes. Check platform labels, fixture links, basic HTML accessibility, keyboard focus and narrow-screen rules. Read files and run existing checks; do not edit. Report concrete findings with file locations. If there are no findings, say so. Distinguish code inspection from browser checks actually performed.';
  const reviewZh='独立审查 Orbit 当前改动。检查平台名称、演示文件链接、HTML 基础可访问性、键盘焦点和窄屏规则。读取文件并运行现有检查，暂时不要修改。问题要给出具体文件位置；没有发现问题就如实说明。区分代码检查和真正完成的浏览器检查。';

  groups[0].ids.unshift('understanding');
  groups[0].ids.splice(groups[0].ids.indexOf('tour'),0,'mechanism');
  groups[1].ids.splice(groups[1].ids.indexOf('messages')+1,0,'collaboration');
  groups[3].ids.splice(groups[3].ids.indexOf('channels')+1,0,'feishu');

  topics.understanding=T('Meet Rovai','认识 Rovai',
    'Bring your existing coding Agents into a workspace where a team can continue working together.',
    '让已有的编程智能体在同一个工作台中，围绕同一项工作持续协作。',[
    P('From one answer to an ongoing project','从一次回答，到一项持续的工作',
      ['A coding Agent can read a repository, change files and run commands. When a project continues over several days, you also need to know who owns an unfinished item, which decision was made, and where to resume. Rovai gives that work a lasting place.', 'For the Orbit download page, Dingding implements a scoped change and Cheese reviews it. Their identities stay in the roster. The conversation retains requests and replies; execution records and changed files let you inspect what actually happened.'],
      ['编程智能体能阅读仓库、修改文件、执行命令。工作跨越几天后，你还需要知道谁负责未完成事项、之前作过什么决定，以及应该从哪里继续。Rovai 为这些工作提供持续的组织方式。', '例如修改 Orbit 下载页：叮叮负责实现，芝士负责审查。两位队员的身份保留在名册里；会话留下需求和回复，执行记录与文件变化帮助你检查实际发生的操作。']),
    F('What the workspace adds','工作台具体提供什么',[
      ['Lasting teammates','长期队员','Save a name, responsibilities and working principles once, then invite that teammate into different conversations.','保存名称、职责与工作准则，随后把同一位队员邀请到不同会话。'],
      ['Shared conversation','共同会话','Keep requests, explicit recipients, reviews and handoff messages around one goal. Use a private one-on-one for a side question.','围绕目标保留请求、接收对象、审查和交接消息；旁支问题可以在单聊中追问。'],
      ['Responsibility and execution','责任与执行','A Task records an owner and responsibility; a Run records one execution. Read both when work spans several attempts.','任务记录负责人及责任，执行记录某一次实际操作。需要多次推进时，两者结合着看。'],
      ['Reusable memory','可延续的记忆','Store a durable agreement at the right scope, inspect its source and revise it later.','把长期约定保存到合适范围，查看来源，并在约定变化后修订。']]),
    P('Start with the smallest useful team','从最小的有用队伍开始',
      ['One teammate is enough for a small, clear change. Add a reviewer when another perspective can reduce a specific risk: a platform link, an authorization change, or a release checklist. More participants do not automatically make a better result.', 'Rovai coordinates the Agent products installed on the host. Those products still need their own installation, sign-in and model access. The workspace does not imply that model computation runs locally.'],
      ['范围清楚的小改动，一位队员就够。需要第二种视角检查平台链接、权限变化或交付条件时，再邀请审查队员。参与人数不会自动提高结果质量。', 'Rovai 协调主机上安装的智能体产品；它们仍需各自的安装、登录和模型访问权限。工作台在本地，不代表模型计算全部发生在本地。']),
    S('Try one complete loop','先走完一个小闭环',
      ['Configure one Agent and one teammate, then complete the Quick start.', 'Open the collaboration tutorial to extend that task with a second teammate and an explicit review request.', 'Keep the original conversation for follow-up work; save only durable agreements as memory.'],
      ['配置一种智能体和一位队员，完成快速开始中的任务。','再阅读协作教程，增加第二位队员，并主动发出审查请求。','后续工作继续使用原会话；只有长期有用的约定才整理为记忆。'])
  ]);
  topics.mechanism=T('How work moves through Rovai','工作机制',
    'Understand who decides, who executes, and where the files and results live.',
    '弄清谁作决定、谁执行，以及文件和结果在哪里。',[
    D('Responsibilities and data flow','职责与数据流','responsibilities',
      'You choose a goal and recipients. Rovai routes work through a teammate’s configured Agent. That Agent may contact its configured model service and operate on the host’s project files.',
      '你确定目标和接收队员；Rovai 按配置调用智能体。智能体可能访问配置的模型服务，并在执行主机上操作项目文件。'),
    F('Five different roles','五种不同职责',[
      ['You','用户','Set the goal, choose recipients, inspect output and decide whether to approve an operation or accept a delivery.','提出目标、选择接收对象、检查结果，决定是否批准操作或接受交付。'],
      ['Rovai','Rovai','Organize teammates and conversations, queue addressed messages, launch configured Agents and retain observable execution facts.','组织队员和会话，对明确寻址的消息排队，启动已配置智能体并保留可观察的执行事实。'],
      ['Teammate','队员','A lasting identity with responsibilities and configuration. Several teammates can use the same Agent product with different roles.','具有长期身份、职责和配置；几位队员可以使用同一种智能体产品，承担不同工作。'],
      ['Native Agent','原生智能体','Products such as Codex CLI or Claude Code interpret the request, call the configured model and use tools under their own capabilities and permissions.','Codex CLI、Claude Code 等产品解释请求，调用配置的模型，并按自身能力和权限使用工具。'],
      ['Project and services','项目与模型服务','Files are on the execution host. Model requests follow the chosen Agent/provider configuration; a local workspace is not a guarantee that all inputs stay on the computer.','项目文件位于执行主机；模型请求遵循所选智能体与服务配置。本地工作台并不意味着所有输入都不离开电脑。']]),
    S('Follow one request','沿着一条请求看',
      ['Select Dingding in the mention picker and send a scoped request in the Orbit conversation.', 'Rovai accepts the message and records a delivery for that teammate. When execution can start, it freezes the selected input and configuration into a Run.', 'The Agent reads or edits files and returns observable steps and output. Read the public answer, the Run and the actual files together.', 'To request review, select Cheese and send a new request. That creates new work; merely naming a reviewer in prose is not the same action.'],
      ['在 Orbit 会话的提及选择器中选择叮叮，发送范围明确的请求。','Rovai 接收消息并记录给这位队员的投递；具备执行条件后，选中的输入和运行配置会固定在本次执行中。','智能体读取或修改文件，返回可观察的步骤和输出。结合公屏答案、执行记录与实际文件判断结果。','需要审查时，再选择芝士并发送新请求。这会产生后续工作；正文中提到某个名字并不等于执行了这个动作。']),
    P('What is shared, and what is separate','哪些共享，哪些独立',
      ['Participants in a project conversation work against its selected workspace. A private one-on-one has separate messages and a separate queue, but it does not automatically create an isolated file copy.', 'A Git-backed Mission can have a shared managed worktree. Its teammates use that Mission execution location together; each teammate does not automatically get a worktree.', 'Permissions and actual model support come from the current Agent configuration. A profile description, a Skill or an @ mention does not grant filesystem or network access.'],
      ['同一项目会话中的队员使用选定的工作目录。单聊有独立消息和队列，但不会自动复制一份隔离文件。','Git 项目的使命可以拥有一个共同使用的受管工作树。参与该使命的队员共享其执行位置，并非每人自动分配一个工作树。','权限与模型支持取决于当前智能体配置。资料中的职责、Skill 或 @ 提及都不会自行增加文件和网络权限。'])
  ]);

  topics.collaboration=T('Collaborate and hand off work','多队员协作与交接',
    'Implement and review one download-page change, with explicit recipients and an inspectable result.',
    '围绕一次下载页修改完成实现与审查，明确接收对象，并检查真实交付。',[
    P('The example and its scope','示例与适用场景',
      ['Orbit is a separate tutorial project with index.html and three local text download fixtures. It contains no real installer. Dingding implements the page; Cheese reviews it with a read-only Agent configuration. Both use the same project files.', 'Use one teammate when the goal is small and you can inspect the result yourself. Split implementation and review when you want an independent check against stated acceptance criteria. For concurrent work, assign different files or a read-only review; avoid two writers changing the same file at once.'],
      ['Orbit 是独立教程项目，包含 index.html 和三个本地文本下载文件，没有真实安装包。叮叮负责实现，芝士使用只读智能体配置负责审查，两人面对同一组项目文件。','目标较小且你能直接验收时，用一位队员即可。需要按明确条件进行独立检查时，再拆分实现与审查。并行工作要分开文件范围，或让一位只读审查，避免两人同时写同一文件。']),
    D('The collaboration sequence','协作怎样连接起来','collaboration',
      'The user requests implementation, then explicitly requests review. A further edit is optional and depends on actual findings. Agent-to-agent handoff is a separate supported path, not what this example assumes.',
      '用户先请求实现，再主动请求审查；是否继续修改取决于真实意见。队员间主动交接是另一条支持的路径，本例不把用户操作说成自动编排。'),
    S('Prepare two participants','准备两位参与者',
      ['In Teammates, give the implementer and reviewer distinct roles and save their Agent configuration.', 'Create a conversation for the independent Orbit folder, select Dingding and Cheese and choose Dingding as lead.', 'Open Team in the conversation header to verify participation. The global roster and this conversation’s participant list are separate.', 'Agree on the scope: Dingding may edit the page and checks; Cheese reviews without editing. Keep both requests in this conversation.'],
      ['在“队员”中为实现和审查分别设置职责，并保存各自智能体配置。','为独立 Orbit 目录新建会话，选择叮叮和芝士，把叮叮设为队长。','打开会话顶部“队员”确认参与名单。长期名册与本次会话名单是两层关系。','明确范围：叮叮可以改页面与检查脚本；芝士只读审查。两次请求都留在同一会话。']),
    Q('Request the implementation','发起实现请求',implementationEn,implementationZh),
    I('Select the actual recipient','选择真正的接收对象',
      'Type @, choose Dingding from the picker, then enter the request. The selected mention is a structured recipient. Check it before sending.',
      '输入 @ 后，从候选中选中叮叮，再填写请求。被选中的提及才是结构化接收对象；发送前核对它。',
      'collaboration-request-en.jpg', 'Dingding is selected in the input as the recipient of the Orbit implementation request.', '输入区已选择 Dingding，接收 Orbit 实现请求。'),
    I('Follow the real execution','查看实际执行',
      'The Run panel records the actual implementation attempt. This capture shows the running teammate and observed steps; the message alone is not evidence of a completed change.',
      '执行台记录了真实的实现过程。此图展示运行中的队员及已观察到的步骤；出现请求消息并不代表修改已经完成。',
      'collaboration-running-en.jpg'),
    P('Read the implementation handoff','阅读实现交付',
      ['This run changed index.html and added styles.css and verify.mjs. It passed node verify.mjs, node --check verify.mjs and git diff --check. The original download text fixtures were retained.', 'The implementer reported that Chrome access was denied, so it did not claim a visual browser check. It also reported a failure from the explicit message-send command; the final response still appeared in the conversation. These limitations remain part of this run’s record.'],
      ['这次真实执行修改了 index.html，并新增 styles.css 和 verify.mjs；通过 node verify.mjs、node --check verify.mjs 和 git diff --check。原有下载文本文件保留。','实现队员说明 Chrome 访问被拒绝，因此没有声称完成浏览器视觉检查。它还报告显式消息发送命令失败，但最终回复仍出现在会话中。这些限制保留在本次记录里。']),
    Q('Ask for an independent review','主动请另一位队员审查',reviewEn,reviewZh),
    I('The user chooses the next teammate','这次交接由用户发起',
      'Choose Cheese in the @ picker. The screenshot keeps the implementation handoff above the new review request, so the scope and the next recipient are visible together.',
      '在 @ 选择器中选择芝士。图中上方是实现交付，下方是用户填写的审查请求，可以同时看见工作背景和下一位接收者。',
      'collaboration-review-request-en.jpg'),
    P('Decide from the review, then inspect files','按审查意见决定，再查看文件',
      ['Read the actual review before deciding on another edit. A confirmed defect calls for a narrow follow-up addressed to the implementer; a suggestion may need a product decision. If no defect is found, inspect the delivery rather than inventing a repair round.', 'Open Files Changed below the implementation reply and inspect the changed paths and lines. Open index.html in a browser to inspect the delivered page. A successful Run or a reviewer’s answer is not a merge or a release.'],
      ['先读真实审查意见，再决定是否继续修改。确定的缺陷可以交给实现队员作小范围修复；建议项可能需要你作产品决定。没有发现缺陷时，就继续验收交付，不为凑闭环虚构修复。','从实现回复下方的“文件变更”展开路径和差异，再用浏览器打开 index.html 查看页面。执行成功或审查队员回复都不等于代码已经合入或发布。']),
    F('Who receives the next message?','下一条消息由谁接收？',[
      ['No explicit recipient','没有显式接收对象','Normally the lead receives it. After you explicitly address one non-lead teammate, the composer may show “Send to continue” for that teammate. Check the visible routing hint; cancel continuation to return to normal routing.','通常由队长接收。但你明确发给一位非队长队员后，输入区可能显示继续发给该队员。以可见的接收提示为准；取消延续后再使用正常路由。'],
      ['One or several selected teammates','选择一位或多位队员','Each selected recipient gets work from the same message. Multiple recipients do not establish an implementation-then-review order. If order matters, wait for the first result and send the next request yourself.','同一消息会给每位选中队员建立待处理工作。多人接收不会自动形成“先实现、后审查”的顺序；有先后依赖时，等待前一结果，再发送后续请求。'],
      ['Reply to a teammate','回复队员消息','Reply adds the original message reference and, while its author is an available participant, inserts that teammate as a recipient. Check all selected mentions; existing recipients can remain. If the author is unavailable, choose a replacement.','回复会增加原消息引用；原作者仍是可参与队员时，会把它加入接收对象。检查全部已选提及，已有接收对象可能仍保留。原作者不可用时需要另选接收者。'],
      ['Reply to your own or a system message','回复用户或系统消息','The reference supplies context. It is not an Agent recipient; choose whom to ask and check the composer’s route.','引用提供上下文，用户或系统本身不是智能体接收者；需要确认你在请哪位队员处理。'],
      ['Default lead','默认队长','Provides a default recipient and has task-responsibility powers defined by the product. The title does not promise automatic planning or assignment of every request.','提供默认接收对象，并拥有产品规定的任务责任操作。这个称谓不保证自动规划和分配每条请求。'],
      ['Agent-to-agent handoff','队员之间的主动交接','An Agent can use Rovai’s explicit send capability to address another present teammate with continuing work. Check the displayed recipients and the following execution. A name in ordinary narration, a thank-you or “ready for review” alone is not proof of a handoff.','智能体可使用 Rovai 的显式发送能力，把具体后续工作交给在场队员。以消息展示的接收对象和后续执行为准；普通叙述中的名字、感谢或一句“等待审查”都不能证明已发生交接。']]),
    P('Resume this work later','下一次怎样继续',
      ['Reopen the same conversation, read the latest delivery and outstanding Task, and state what has changed since then. Use a new message to define the remaining work.', 'Save only a durable agreement as memory, such as the project’s platform naming. Temporary review instructions and this run’s completion status belong in the conversation or Task.'],
      ['重新打开原会话，先读最新交付和未完成任务，再说明此后发生了哪些变化。用新消息界定剩余工作。','只有长期约定值得整理成记忆，例如项目的平台命名。临时审查要求和本次完成状态留在会话或任务里。'])
  ]);

  prepend('members',[
    P('A pair you can adapt','可以照着改的两份资料',
      ['These are documentation profiles in an isolated example, not changes to Rovai’s default teammates. Start with stable responsibilities. Put “only edit index.html today” and this review’s acceptance criteria in the conversation request.', 'A personality tag describes collaboration style. A working principle describes a repeatable practice. Neither gives the Agent extra permissions. Save identity and Agent configuration separately.'],
      ['以下是隔离示例中的文档资料，并未修改 Rovai 默认队员。先写稳定的职责；“今天只改 index.html”和这次验收条件放进会话请求。','性格标签描述协作风格，工作准则描述可反复采用的做法；两者都不增加智能体权限。队员资料和智能体配置分别保存。']),
    F('Dingding · implementation','叮叮 · 实现示例',[
      ['Role','团队角色','Implementation','实现'],
      ['Responsibilities','专业职责','Implement focused changes and explain the delivered files.','完成范围明确的修改，并说明交付了哪些文件。'],
      ['Personality','性格底色','Practical, curious. Ask when a missing decision affects implementation.','务实、好奇；缺少会影响实现的决定时提出问题。'],
      ['Working principles','工作准则','Read existing files first. Stay within scope. Verify the outcome and state what remains untested before handing work back.','先读现有文件，遵守修改范围，交付前验证结果，并说明尚未验证的部分。'],
      ['Growth focus','成长方向','Make implementation handoffs easier to verify.','让实现交付更容易被检查。'],
      ['Agent configuration','智能体配置','This example uses Codex CLI, the Agent’s default model, workspace-write and on-request. Use the capabilities actually offered by your Agent.','本例使用 Codex CLI、智能体默认模型、workspace-write 和 on-request。实际可选项以你使用的智能体为准。']]),
    F('Cheese · review','芝士 · 审查示例',[
      ['Role','团队角色','Review','审查'],
      ['Responsibilities','专业职责','Inspect correctness, accessibility and edge cases; report findings with file locations.','检查正确性、可访问性及边界情况，问题附具体文件位置。'],
      ['Personality','性格底色','Precise, candid. Distinguish a confirmed defect from a suggestion.','细致、坦诚；区分确认的缺陷和建议。'],
      ['Working principles','工作准则','Review independently. Do not invent defects. Do not edit unless asked. State browser or environment limits.','独立检查，不编造缺陷；没有要求时不修改，说明浏览器或环境限制。'],
      ['Growth focus','成长方向','Turn each finding into a small, actionable request.','把每项发现写成具体、可执行的小请求。'],
      ['Agent configuration','智能体配置','Codex CLI with a read-only filesystem configuration and on-request approval. This limits file editing while preserving the reviewer’s identity.','Codex CLI 使用 read-only 文件权限和 on-request 审批。只读限制文件编辑，不改变队员身份。']]),
    P('Roster versus conversation team','长期名册和会话队伍',
      ['The roster keeps the teammate available for future work. A conversation chooses who participates now and which member is lead. Editing a roster profile is not the same as inviting it to a conversation.', 'A conversation’s Team panel is the place to inspect membership and run configuration for the current work. Before removing a member, review the product’s affected-work preview and reassign unfinished responsibilities.'],
      ['名册让队员能够参加后续工作；会话决定这次有哪些成员、谁是队长。修改名册资料不等于把队员加入当前会话。','当前工作从会话顶部“队员”查看参与关系和运行配置。移出成员前，阅读受影响事项预览，先交接未完成责任。'])
  ]);
  prepend('agents',[
    P('Identity, Agent and model are separate choices','身份、智能体与模型分开配置',
      ['Dingding and Cheese can both use Codex CLI while keeping different responsibilities and filesystem settings. You can also choose different available products. A model is selected within that product’s supported catalog; it is not another teammate.', 'Change a teammate’s configuration before the next request is claimed. An existing Run keeps its frozen configuration; changing the model does not retroactively switch an execution already underway. Read the model shown in the Run where the Agent can report it.'],
      ['叮叮和芝士都可以使用 Codex CLI，同时保留不同职责和文件权限；也可以选择不同的可用产品。模型属于该智能体支持的目录，并不是另一位队员。','运行配置要在下一条请求被领取前修改。已有执行保留开始时固定的配置；更改模型不会把正在运行的过程切换到新模型。智能体能够报告时，可在执行台查看实际模型。'])
  ]);

  const missionReference=references('missions');
  topics.missions.sections=[
    P('When to create a Mission','什么时候建立使命',
      ['A normal project conversation is enough for a short edit or question. Use a Mission for a goal that will remain visible on the board across several work sessions with the same team: for example, “Improve the Orbit download experience.” The Mission has one associated team conversation; opening its drawer or full view opens that same work.', 'Write a goal and boundaries, not just a title: provide clear platform choices, keep demonstration files explicit, review links and accessibility, and deliver the resulting page with checks.'],
      ['短小修改或问答用普通项目会话即可。需要让一个目标持续留在使命板上、让同一队伍多次推进时，建立“完善 Orbit 下载体验”这样的使命。一个使命关联自己的团队会话；抽屉和完整会话打开的是同一项工作。','说明目标与边界，不只填名称：平台选择清楚、演示文件标识明确、检查链接和可访问性，最后交付页面及检查结果。']),
    D('Mission, conversation, Task and Run','使命、会话、任务与执行的关系','work-records',
      'A Mission links its goal to one conversation and execution workspace. That conversation owns messages, members, Tasks and Runs; a Task can be linked to work, but not every Run must belong to a Task.',
      '使命把目标与一个会话、执行工作区关联起来。会话管理消息、队员、任务和执行；任务可关联工作，但并非每次执行都必须属于某个任务。'),
    Q('A filled goal','可照着填写的使命目标',
      'Inspect the existing Orbit download page and run node verify.mjs. Create only DELIVERY.md with the three platform labels, actual fixture file names, checks performed and remaining browser-test limitations. Do not change HTML or CSS, commit, merge, publish or contact other teammates. Reply in English.',
      '检查已交付的 Orbit 下载页并运行 node verify.mjs。只新增 DELIVERY.md，记录三个平台名称、实际演示文件名、已执行的检查，以及剩余浏览器测试限制。不修改 HTML/CSS，不提交、合入、发布或联系其他队员。'),
    S('Create, start and follow through','从创建到推进',
      ['Open Missions → New Mission. Fill the name and description, select the Orbit project, choose the team and lead, and add source attachments or labels only when useful.', 'New creates the record without immediately starting work. Start Mission requests execution; the board’s business status is managed separately.', 'Open the Mission card. Use the conversation drawer for discussion or expand to the full conversation. Inspect the start request’s actual execution and any pending intervention.', 'Create Tasks for durable responsibilities, then explicitly send work to the relevant teammate. Creating a Task alone does not start an Agent.', 'Read the final reply and cumulative changes. Check the actual delivered page before changing the Mission status or integrating the code.'],
      ['打开“使命板 → 新使命”，填写名称和描述，选择 Orbit 项目、队伍和队长；有需要时再添加来源附件或标签。','“新建”保存记录，不立即开始工作；“开始使命”发起执行，使命板上的业务状态单独管理。','打开卡片，在抽屉里讨论，或展开为完整会话。检查开始请求对应的真实执行，以及需要你介入的事项。','需要长期跟进时建立任务，再显式向相应队员发消息。只创建任务不会启动智能体。','阅读最终回复与累计变更，检查交付页面，再决定使命状态和代码整合。']),
    P('Understand the working directory','理解使命工作目录',
      ['For a Git project, the first admitted execution prepares a managed Mission worktree from the source checkout’s current local HEAD. That worktree is shared by this Mission’s participants and is normally retained for continuation. The project’s uncommitted edits are not a promise of copied Mission content.', 'For a non-Git directory, execution retains the original directory. There is no automatic branch isolation. Check the displayed workspace before assigning a write.', 'Cumulative changes compare the recorded base with the current Mission worktree, including committed, staged, unstaged and untracked changes. Refresh reloads the current view; it is not a historical snapshot. A manual branch switch does not rewrite the recorded base.', 'Cleanup is an explicit operation with a safety check. A completed status does not clean the workspace, merge code or delete the branch. Read dirty-workspace or branch-use refusals before attempting cleanup again.'],
      ['Git 项目的首次执行获准后，会从主项目当时的本地 HEAD 准备受管使命工作树。使命内队员共享这个工作树，后续通常继续使用。不要假设主项目尚未提交的修改也会被复制进去。','非 Git 目录继续使用原目录，没有自动分支隔离。交给队员写文件前，确认界面显示的工作位置。','累计变更从记录的基线对比使命工作树当前内容，包含已提交、已暂存、未暂存及未跟踪变化。刷新读取当前视图，并非历史快照；手动切换分支也不会重写原基线。','清理工作区是需要安全检查的独立操作。状态改为完成不会自动清理工作树、合入代码或删除分支。遇到目录有改动或分支被使用等拒绝提示时，先处理原因。']),
    F('Three separate completion decisions','三种“完成”分别意味着什么',[
      ['Run finished','执行结束','One attempt has reached a terminal state. It may have succeeded, failed or been stopped. Read its actual result.','某一次操作进入终态，可能成功、失败或被停止，需要阅读实际结果。'],
      ['Mission completed','使命完成','The goal’s business status changed. It does not prove that all checks passed or that code entered another branch.','目标的业务状态发生变化，不能据此证明所有检查通过或代码已进入其他分支。'],
      ['Code integrated','代码已合入','Git history or your normal review/release process confirms integration. Inspect that evidence independently.','由 Git 记录或原有审查、发布流程确认整合，需要单独查看证据。']]),
    ...missionReference
  ];
  prepend('tasks',[
    P('Use a Task to retain a responsibility','用任务留下可跟进的责任',
      ['“Review the Orbit platform links and report accessibility findings” is a useful Task when you need an owner and an outcome that survives several messages. A question that needs one short reply may not need a Task.', 'Create it from the current conversation’s Tasks view. Choose a present teammate and write the scope, requirements and expected result in the description. Creating or assigning it records responsibility; it does not send a work request. Address a message to the assignee to begin.'],
      ['“审查 Orbit 平台链接并反馈可访问性问题”适合建立任务：它有负责人，结果也需要跨多条消息跟进。只需一次简短回答的问题可以直接发消息。','从当前会话“任务”新建，选择在场队员，把范围、要求和预期结果写进描述。创建和分配只记录责任，不会自动发送执行请求；开始工作还需向负责人发消息。']),
    F('Follow the responsibility through','怎样跟进责任',[
      ['Pending / in progress','待处理 / 进行中','Confirm that a work request was actually sent. Open the assignee’s Run for progress; Task status alone is not a live execution monitor.','确认已发送实际工作请求，再到负责人的执行记录查看进展；任务状态本身不是实时执行监控。'],
      ['Blocked','受阻','Read the blocked reason and supply the missing decision, access or input in the conversation. Update the responsibility when the scope changes.','阅读受阻原因，在会话中补充决定、访问条件或输入；范围变化时相应更新责任描述。'],
      ['Completed','已完成','Read the completion summary and compare it with the files and acceptance conditions. The Task can represent work spread over several Runs.','阅读完成摘要，对照文件及验收条件；一个任务可以经过多次执行。'],
      ['Cancelled','已取消','Closes this responsibility. It is separate from stopping an active Run and does not roll back file changes.','结束这项责任，与停止正在运行的执行不同，也不会回滚文件。']]),
    P('Who can update what','谁可以调整任务',
      ['The user and current lead can create and manage non-terminal Tasks. An ordinary assignee updates their own execution status and the matching blocked or completion explanation. A different teammate is not automatically entitled to reassign the work.', 'Completed or cancelled Tasks are terminal records. Continue with a clearly scoped follow-up Task when new work appears, rather than rewriting the old outcome.'],
      ['用户和当前队长可以创建、管理非终态任务。普通负责人更新自己的执行状态，并填写对应的受阻或完成说明；其他队员不会自动获得重新分配责任的权限。','已完成或已取消的任务是终态记录。出现新工作时建立范围清楚的后续任务，保留原结果。'])
  ]);
  prepend('files',[
    P('Inspect the actual Orbit delivery','检查 Orbit 的实际交付',
      ['The implementation produces index.html, styles.css and verify.mjs. Open the reply’s Files Changed card, select a file and compare the actual removed and added lines. A file-reading step is not evidence that a file changed.', 'Open the page’s file link to inspect the saved content. Use the system/browser action when you need rendered HTML, and use the source view for markup. File preview, per-Run changes and Mission cumulative changes answer different questions.', 'If work continues while you are reading, refresh the relevant changes view before deciding. The current file can differ from the version a teammate originally described. An unavailable diff is a missing view, not proof of no changes.'],
      ['实现产出 index.html、styles.css 和 verify.mjs。从回复下方“文件变更”选择文件，检查真正删除和新增的行。读取文件的步骤不能证明该文件被修改过。','点击页面的文件链接检查保存内容；需要渲染 HTML 时使用系统或浏览器打开，查看标记结构时使用源码视图。文件预览、单次执行变更和使命累计变更回答不同问题。','阅读过程中工作继续推进时，作决定前刷新对应变更视图。当前文件可能已经不同于队员最初描述的内容。差异不可用表示缺少视图，不代表没有改动。']),
    F('Which view to use','按问题选择视图',[
      ['What does the file contain now?','文件现在是什么内容？','Open its file preview; refresh when the interface reports a newer version.','打开文件预览；界面提示存在新版本时刷新。'],
      ['What changed during this attempt?','这次执行改了什么？','Open the Files Changed card associated with that Run and inspect its available evidence.','查看对应执行的“文件变更”卡片及其可用证据。'],
      ['What has the Mission changed overall?','使命总共改了什么？','Open the Mission cumulative changes, refresh and compare with its fixed base.','打开使命累计变更，刷新后与其固定基线比较。'],
      ['Is it ready to ship?','能否交付？','Combine the actual files, relevant checks, independent review and your acceptance decision. No one view certifies all of these.','结合文件、相关检查、独立审查及你的验收决定；单个视图不能认证全部条件。']])
  ]);

  const memoryReference=references('memory');
  topics.memory.sections=[
    P('Save a decision that will matter again','保存下一次还会用到的约定',
      ['The Orbit team repeatedly needs the same platform labels and matching notes. That is worth saving because it applies beyond one message. “The review is done” is a transient result and belongs in the conversation or Task.', 'The following agreement is tutorial data, not a Rovai product rule. Its wording names the project so it cannot be mistaken for a naming policy for every future project.'],
      ['Orbit 后续工作还会反复用到统一的平台名称和对应说明，因此适合保存。“审查已经完成”是临时结果，留在会话或任务即可。','下面的约定属于教程示例，不是 Rovai 的产品规则。正文写明适用项目，避免被误解为所有未来项目都要遵守的命名规范。']),
    Q('The agreement','示例约定',
      'For the Orbit tutorial, use Apple Silicon, Intel and Windows x64 consistently. Keep each platform note beside its matching download. The files are text demos, not real installers. This is a tutorial agreement, not a Rovai product rule.',
      '在 Orbit 教程下载页中统一使用 Apple Silicon、Intel、Windows x64。各平台说明放在对应下载旁边。文件是文本演示，不是真实安装包。这是教程约定，不是 Rovai 产品规则。'),
    F('Choose the scope before saving','保存前选对适用范围',[
      ['Shared memory','共同记忆','An agreement useful across the local team, such as Orbit’s platform naming. Shared memory is broader than the current conversation, so name the project and limits explicitly.','适用于本机队伍共同遵守的约定，例如 Orbit 平台命名。共同记忆的范围比当前会话更广，应明确项目与边界。'],
      ['Teammate memory','队员记忆','A durable habit or lesson for one teammate, such as an implementer’s handoff checklist. Select the intended teammate.','一位队员长期使用的习惯或经验，例如实现交付检查方法，需选定目标队员。'],
      ['Between teammates','队员间记忆','A collaboration agreement for a pair. A mutual entry applies to both; a directed entry records one side’s responsibility toward the other. Direction is meaningful, not a display order.','两位队员之间的协作约定。双方共同条目适用于两人，单向条目表示一方对另一方的责任；方向有实际含义，并非排序。']]),
    S('Create and inspect the saved item','新增并查看保存后的条目',
      ['Open Memory → Add Memory. Choose Shared memory and Agreement for this example.', 'Enter the complete agreement. Add 1–3 short retrieval keys, such as Orbit, platforms and downloads. Keys help lookup; they do not replace the body.', 'Save, then select the item. Inspect its scope, In Use state, formation source, retrieval keys and current revision.', 'When work resumes, ask the teammate to look up the applicable Orbit agreement. A saved entry is available within its scope; its presence does not prove that a particular Run read it.'],
      ['打开“记忆 → 新增记忆”，本例选择“共同记忆”和“约定”。','填写完整正文，添加 1–3 个简短检索词，例如 Orbit、platforms、downloads。检索词帮助查找，不能代替正文。','保存后选中条目，检查范围、沿用状态、形成来源、检索词和当前版本。','下次继续工作时，可以请队员查阅适用的 Orbit 约定。保存意味着条目在其范围内可用，不能据此证明某次执行读过它。']),
    I('A filled memory entry','填写完整的记忆条目','The actual editor is filled with a project-specific agreement and retrieval keys.','真实编辑器已填写项目约定与检索词。','memory-filled-en.jpg'),
    I('Saved content and source','已保存内容与来源','The saved detail shows User created, the active body and version history. This example was added by the user, so it does not pretend to be an automatically captured candidate.','详情真实显示“用户创建”、沿用正文和版本历史。本例由用户新增，并不伪装成自动捕获的候选。','memory-saved-en.jpg'),
    P('Candidates and review are another path','候选与审核是另一条路径',
      ['An Agent can propose a shared-memory addition or revision for user review. Pending candidates are separate from the active memory collection. Read the proposed body and source, then accept, edit and accept, or reject through the review UI.', 'Agents may directly maintain their own teammate memory and permitted directed relationship memory. Shared candidates and direct teammate writes therefore do not all follow the same approval path.', 'If the candidate is stale because its target or revision changed, read the latest state. Do not repeatedly accept an outdated proposal. An empty Pending Review list means there is nothing awaiting this review, not that every discussion was automatically checked.'],
      ['智能体可以提交共同记忆的新增或修订候选，交给用户审核。待审核候选与正在沿用的记忆分开存放。阅读建议正文和来源，再通过审核入口接受、编辑后接受或拒绝。','智能体也可以在权限范围内直接维护自己的队员记忆及单向关系记忆，因此共同候选和队员直接写入并不走完全相同的审核路径。','如果目标或版本已变化，候选会过时，应先读最新状态，不要反复接受旧建议。待审核列表为空只表示当前没有这类候选，不表示每次讨论都经过自动判断。']),
    I('Revise when the agreement changes','约定变化后修订','The example revision explains what to update if real installers replace the tutorial fixtures. Scope and type stay locked in this revision editor.','示例修订补充了“以后换成真实安装包时应更新什么”。修订编辑器中的范围和类型保持锁定。','memory-revision-en.jpg'),
    P('Continue, retire or replace','继续沿用、停止沿用与替代',
      ['Use Revision to change the body and keys; save and inspect the resulting version history. For a change of identity such as scope or type, create the appropriate new entry rather than pretending a body edit changes the scope.', 'Stop using removes an outdated item from the active set while retaining its record. It does not erase copies already present in an accepted Run or undo a decision already made. Permanent forgetting is a separate destructive action; it is not needed to revise this tutorial agreement.', 'The product provides memory lookup and records observable access. Do not infer “the Agent read this memory” merely because its answer uses similar words, and do not expect every active memory to be loaded every turn.'],
      ['通过“修订”修改正文和检索词，保存后查看新的版本历史。需要改变范围或类型这类身份时，建立相应的新条目，不要把正文修改误认为范围变化。','“停止沿用”让过时条目退出有效集合，保留其记录；它不会抹掉已接收执行里的副本，也不会撤销已作出的决定。“永久遗忘”是另一个破坏性操作，本次修订不需要它。','产品提供记忆查阅，并记录可观察的访问。不要仅凭回答用了相似措辞就认定智能体读取过某条记忆，也不要期待每轮都加载全部有效记忆。']),
    ...memoryReference
  ];

  const executionReference=references('execution');
  topics.execution.sections=[
    P('Start from the request you sent','从你发出的请求开始看',
      ['In the Orbit conversation, the implementation request, review request and contrast follow-up create distinct attempts. Select the relevant teammate and request in Run; do not inspect a previous successful Run and assume it covers the latest message.', 'A received message can still be waiting for delivery or execution conditions. A Run exists when work has actually been claimed. Its visible queued, running, waiting or terminal state answers a narrower question than the overall project status.'],
      ['Orbit 中的实现、审查和对比度修复是不同的执行。打开“执行”，选中对应队员和请求，不要把上一条成功记录当成最新消息的结果。','消息被接收后仍可能等待投递或执行条件。工作被领取后才产生执行；排队、运行、等待和终态说明的是某次操作，而非整个项目的状态。']),
    F('Read the state before intervening','介入前先分清状态',[
      ['Not started','还没开始','Read the message-processing indicator and queue. The teammate may be busy, unavailable, or waiting for a previous execution to be safely cleaned up. Inspect the configuration and reported reason before resending.','查看消息处理提示和队列。队员可能忙碌、不可用，或正在等待前一次执行安全收尾。先看配置与原因，再决定是否重发。'],
      ['Running','运行中','Read observed narration and tool steps. A long command or a quiet model interval can have no new output. Elapsed time is not a completion estimate.','查看已观察到的叙述和工具步骤。长命令或模型思考阶段可能暂时没有新输出；已用时间不是完成倒计时。'],
      ['Waiting for approval','等待审批','Open the approval request and inspect its target and native choices. Resolve that request, then check whether the execution actually continues.','打开审批，查看目标和原生选项。处理这一项后，再确认执行是否继续。'],
      ['Waiting for input','等待输入','Read the question or missing requirement, then provide the requested information in the relevant conversation. Additional permission is not a substitute for a missing product decision.','阅读提问或缺少的条件，在相应会话补充信息。缺少产品决定时，增加权限不能代替回答。'],
      ['Failed or interrupted','失败或中断','Read the last successful step and the error. Inspect files before starting a successor request; some writes may already have happened.','阅读最后成功步骤和错误，在发送后续请求前检查文件，因为此前的写入可能已发生。'],
      ['Completed','执行完成','Read the final result, changed files and stated limitations. Completion of a process does not certify the content or mark every Task and Mission complete.','阅读最终结果、变更文件与限制。过程结束不认证内容质量，也不表示所有任务和使命都完成。']]),
    S('Inspect the implementation and review','检查实现与审查',
      ['Open Run and select Dingding’s implementation request. Expand observed steps when you need the command or result.', 'Read the final message and open its Files Changed card.', 'Select Cheese’s review request separately. Compare the concrete finding with the relevant file.', 'After a follow-up, inspect the new Run and refreshed files rather than replacing the old result in your mental model.'],
      ['打开“执行”选择叮叮的实现请求；需要命令或结果时展开步骤。','阅读最终消息，并打开下方文件变更卡片。','另外选择芝士的审查请求，把具体发现与文件对照。','后续修复产生新执行，应检查新记录与刷新后的文件，同时保留旧过程的事实。']),
    I('An actual running request','真实运行中的请求','The Orbit capture shows a real running request with observed progress. No waiting or approval result was fabricated for the illustration.','Orbit 截图来自真实运行中的请求，展示已观察进度；没有为插图伪造等待或审批结果。','collaboration-running-en.jpg'),
    P('Choose the panel position','三种布局放在一起理解',
      ['Pin to right, Floating and Bottom show the same selected teammate and execution records. Choose a position that leaves room for the files you are reading. This preference changes presentation, not execution or permissions.'],
      ['右侧停靠、浮层和底部显示同一套队员与执行记录。按正在阅读的文件选择合适位置；位置偏好只改变展示，不改变执行或权限。']),
    ...topics.execution.sections.filter(s=>s.kind==='shot'),
    ...executionReference
  ];
  prepend('approvals',[
    P('A decision about one operation','针对一个具体操作作决定',
      ['An approval request is raised by an Agent capability that supports interactive approval. The initial Orbit implementation ran its file checks without an approval card. The later Mission requested a local HTTP server and did require approval; that actual request is shown below.', 'When a real request appears, compare its command or target with your task. Allow only the scope you intended, or deny and provide a safer alternative. A rejected request can leave earlier successful changes intact. Agents differ in what they can ask and which permission choices they expose.'],
      ['审批由支持交互审批的智能体能力提出。最初的 Orbit 实现执行文件检查时没有出现审批卡；后续使命为了启动本地 HTTP 服务提出了真实审批，下面展示的是这一次请求。','真实请求出现时，把命令或目标与任务对照，只同意你需要的范围；也可拒绝并给出可行替代方案。拒绝不会抹掉此前已经成功的修改。不同智能体能提出的请求与权限选项并不相同。'])
  ]);
  prepend('recovery',[
    F('Choose the action that matches the problem','按问题选择要结束的对象',[
      ['Withdraw a message','撤回消息','Available only before any recipient claims the eligible message. It removes the pending request through the product’s withdrawal path; it is not a way to interrupt a running Agent.','仅在符合条件且尚无接收队员领取时可用，通过撤回路径移除待处理请求；不能用于中断正在运行的智能体。'],
      ['Stop a Run','停止执行','Stops the selected attempt. Other teammates and waiting deliveries are separate. Check for a successor request before assuming the entire conversation is idle.','停止选中的一次执行。其他队员和等待中的投递分开处理；不要由此认定整个会话都空闲。'],
      ['Cancel a Task','取消任务','Ends a recorded responsibility. Inspect and stop any active execution separately when that is also your intent.','结束记录中的责任；如果也要停止实际操作，需另行检查并停止当前执行。'],
      ['Change Mission status','更改使命状态','Changes the board’s business state. It does not stop every Run, roll back files, merge a branch or clean the worktree.','改变使命板业务状态，不会停止全部执行、回滚文件、合入分支或清理工作树。']]),
    S('Continue after an interruption','中断后继续工作的顺序',
      ['Read the last Run state and last observed step. Check whether it was waiting, stopped, failed or left with an uncertain outcome.', 'Inspect the actual modified files and any queued requests. Stop is not undo.', 'Resolve the missing permission, account, network or product decision.', 'Send a new, bounded follow-up: state what already exists, what remains and which files may change. Do not replay the whole request when it could repeat a side effect.'],
      ['查看最后执行状态和最后观察步骤，分清等待、停止、失败或结果尚不明确。','检查实际文件变化与排队请求。停止不是撤销。','处理缺少的权限、账号、连接或产品决定。','发送有边界的后续请求，说明已有结果、剩余内容和可改文件；可能重复副作用时，不要重放整项任务。'])
  ]);

  const automationReference=references('automations');
  topics.automations.sections=[
    P('Repeat a bounded check','重复执行一个有边界的检查',
      ['The Orbit example checks the existing download fixtures and reports errors without editing files. It uses a saved prompt, one teammate and the Orbit project. First run it manually to verify the result before choosing a recurring time.','This is host-based automation: Rovai and the configured Agent must be available on the computer doing the work. A schedule is not an independent cloud service.'],
      ['Orbit 示例检查现有下载文件并报告错误，不修改文件。它保存一条明确请求、一位执行队员和 Orbit 项目。先手动运行一次，确认结果后再选择重复时间。','定时任务依赖执行主机：电脑上的 Rovai 与已配置智能体需要可用。保存时间计划并不意味着创建了独立云服务。']),
    Q('A repeatable request','可以重复使用的请求',
      'Run node verify.mjs in the Orbit project. Read index.html and report the three platform labels, the check result and any concrete error. Do not change files, commit, publish or contact teammates. Keep the final report under 150 words.',
      '在 Orbit 项目运行 node verify.mjs，读取 index.html，报告三个平台名称、检查结果以及具体错误。不要修改文件、提交、发布或联系其他队员。最后用简短摘要交付。'),
    I('Set the execution context','设置执行上下文','This filled example chooses Dingding, the Orbit project and Manual. No external notification destination is selected.','填好的示例选择 Dingding、Orbit 项目和手动触发，没有选择外部通知目标。','automation-filled-en.jpg'),
    S('Save, run and inspect','保存、运行并查看结果',
      ['Open Automations → New. Fill the name and full execution content, then choose the teammate and project. The title alone is not the work request.','Choose Manual for the first check and save. Open the task’s action menu and choose Run Once.','Read Execution history. Open the history row to enter the conversation created for that occurrence, then inspect its public reply and Run.','Once the request works as intended, choose a schedule and verify the next time in the host’s local time zone. Turn it off from the action menu when the check is no longer needed.'],
      ['打开“定时任务 → 新建”，填写名称和完整执行内容，选择队员与项目。只有名称不能代替请求正文。','首次验证选择“手动”并保存，在任务操作菜单选择“运行一次”。','查看执行历史，打开这一条记录进入本次新建的会话，再看公屏结果和执行记录。','请求符合预期后，再设定时间并核对主机本地时区下的下次运行时间。不再需要时从操作菜单关闭。']),
    F('What each occurrence uses','每次触发使用什么',[
      ['New conversation','新会话','Each accepted occurrence creates its own conversation from the saved request, selected teammate and project. It does not silently append to an old conversation or inherit its entire transcript.','每次接收的触发都根据保存的请求、队员和项目新建会话，不会悄悄追加到旧会话或继承旧会话全部消息。'],
      ['Agent and files','智能体与文件','The chosen teammate executes on the host in the selected project or managed Quick chat directory. Files remain real host files and may have changed since the previous occurrence.','所选队员在主机的项目目录或受管快速对话目录执行；这些是真实文件，可能已不同于上一次触发时。'],
      ['Result and notification','结果与通知','Execution history retains the outcome and conversation entry. An optional channel notification has a separate delivery outcome; a failed notification is not a reason to run the model again.','历史记录保留结果和会话入口。可选渠道通知有独立送达结果；通知失败不意味着应该重跑模型。']]),
    F('When a scheduled occurrence cannot proceed','不能正常运行时会怎样',[
      ['Previous occurrence is active','上次仍在运行','An overlapping occurrence of the same automation is skipped, not queued behind it. Read the history reason.','同一定时任务的上次运行仍在进行时，本次重叠触发会跳过，不会排队补跑；查看历史中的原因。'],
      ['Approval or input is required','需要审批或补充输入','Unattended execution cannot wait for an interactive decision indefinitely. The current implementation cancels that execution and records an interaction-required failure. Complete the interactive work in a normal conversation, then simplify the recurring request.','无人值守执行不能无限等待交互决定。当前实现会取消该次执行并记录需要交互的失败。先在普通会话完成交互，再调整定时请求。'],
      ['App closed or host asleep','应用关闭或主机休眠','No Agent runs while the required host process is unavailable. On recovery, the scheduler records the latest missed occurrence and advances to a future time; it does not replay every missed interval. A missed or overlapping one-time schedule is consumed and disabled.','所需主机进程不可用时不会执行智能体。恢复后记录最近一次错过的触发并推进到将来时间，不会补跑所有错过的间隔。仅一次计划即使错过或重叠也会被消费并关闭。'],
      ['Turn off or remove','关闭或移除','Turning off prevents future scheduled triggers. Inspect an already active Run separately. Removing the definition does not erase past conversations and execution evidence.','关闭会阻止未来计划触发，已在进行的执行要另行查看。移除定义不会抹掉过去的会话和执行记录。']]),
    ...automationReference
  ];
  prepend('skills',[
    P('Use a capability to improve one step','让能力改变一个具体工作步骤',
      ['The Orbit implementation needed responsive layout and visible keyboard focus. In the recorded execution, the native Agent discovered and read an installed UI design Skill and used its search guidance before editing the page. The result was actual CSS plus checks, not merely a Skill listed in Settings.','This was native Agent discovery. It is not evidence that the user selected a / token or that a Rovai Toolbox workflow ran. The independent review still found a contrast issue, which shows why a selected capability is not a quality certificate.'],
      ['Orbit 的实现需要响应式布局和清晰的键盘焦点。真实执行中，原生智能体发现并阅读了已安装的界面设计 Skill，使用其检索指引后再修改页面。结果是实际 CSS 和检查脚本，而不只是设置页里多了一项。','这次采用的是原生智能体发现路径，并不代表用户选择过 / 标记，也不代表 Rovai 工具箱工作流被执行。独立审查仍发现对比度问题，说明使用能力不等于质量认证。']),
    S('Request an available native Skill','为一条请求选择可用原生 Skill',
      ['Inspect Settings → Skills for the teammate’s Agent. Read the capability’s purpose and confirm that the required native installation exists. This screen does not install or edit it.','Return to the project conversation, choose the intended teammate, type / and select an available Skill candidate. The candidate may come from the Agent’s user or project scope.','Describe the desired result and file limits beside the selected token. Send the request.','Look for an actual Skill read or related tool step in Run, and inspect the delivered files. A token establishes the request; execution evidence establishes what happened.'],
      ['在“设置 → Skills”查看队员所用智能体的清单，阅读用途，确认原生安装已存在。此页不会安装或编辑 Skill。','回到项目会话，选定队员，输入 / 并选择可用候选。候选可能来自智能体的用户范围或项目范围。','在已选择的标记旁说明预期结果和文件边界，再发送。','在执行记录中找实际阅读 Skill 或相关工具步骤，并检查交付文件。标记说明你的要求，执行证据说明实际发生的操作。']),
    Q('An example request after selecting a design Skill','选择界面设计 Skill 后的请求示例',
      'Use the selected Skill to improve the Orbit page’s narrow-screen layout and visible keyboard focus. Preserve the three existing fixture links and demo labels. Change only index.html and styles.css, then report the checks actually completed.',
      '使用已选 Skill 改进 Orbit 页面窄屏布局与键盘焦点。保留三个现有演示链接及示例标记，只修改 index.html 和 styles.css，报告真正完成的检查。'),
    P('Assign a Toolbox capability separately','工具箱能力另行分配',
      ['Settings → Toolbox contains Rovai collaboration instructions such as review-duo. Open the item, read its instructions and choose the teammates who should receive it. This persistent assignment differs from selecting a native Skill for one message.','An assigned instruction can guide a teammate’s working method, but it does not independently trigger a Run, create approvals or grant new filesystem rights. Send a real request and inspect how the Agent uses it.'],
      ['“设置 → 工具箱”提供 review-duo 等 Rovai 协作指引。打开条目阅读说明，再选择接收它的队员。这种长期分配与为某条消息选择原生 Skill 是不同入口。','分配指引可以影响队员的工作方法，但不会自行触发执行、完成审批或增加文件权限。仍需发送实际请求，并检查智能体如何使用它。'])
  ]);

  topics.feishu=T('Feishu: from connection to a reply','飞书：从连接到收到回复',
    'Publish a teammate bot from the desktop App, then verify one small request from your own Feishu chat.',
    '从桌面应用发布队员机器人，再用自己的飞书聊天验证一条小范围请求。',[
    P('Prepare the account and host','准备账号与主机',
      ['Use the Feishu identity and tenant that will own the application. That identity needs access to the Feishu developer console and the ability to create and publish an internal application; some tenants require an administrator to approve publication or permissions. Confirm that approval route before setup.','Keep Rovai Desktop and the teammate’s configured Agent running on the execution host. Complete a small local conversation first. This tutorial uses an already published teammate bot. A private text test was followed by a dedicated demonstration group containing only the owner and that bot.','Feishu and Lark are separate providers. Choose the tenant’s actual provider; a Feishu connection is not a Lark connection.'],
      ['使用准备持有应用的飞书身份和租户。该身份需要能访问开放平台并创建、发布企业自建应用；部分租户需要管理员审核发布或权限，配置前先确认审核方式。','保持执行主机上的 Rovai 桌面应用与队员智能体可用，先在本地完成一条简单会话。本教程先用已发布队员机器人测试所有者私聊，再建立仅含所有者和该机器人的专用演示群。','飞书与 Lark 是不同平台，请选择租户实际所属的平台；飞书连接不能等同于 Lark 连接。']),
    S('Sign in from Rovai Desktop','从 Rovai 桌面端登录',
      ['Open Settings → Channels and select Feishu. Start the developer-account sign-in from the native desktop App.','Use your Feishu client to complete the platform login. On the confirmation screen, inspect the account and tenant you are authorizing. Never share the live QR code in a tutorial or support message.','Return to Channels and check the displayed developer identity. Signing in establishes the account context; it does not itself publish every teammate.'],
      ['打开“设置 → 渠道”，选择飞书，在桌面端发起开发者账号登录。','用飞书客户端完成平台登录，在确认界面核对授权身份与租户。有效登录二维码不要放进教程或支持消息。','回到渠道页，确认显示的开发者身份。登录只是建立账号上下文，不会自动发布全部队员。']),
    S('Publish the intended teammate','发布选定队员',
      ['In the Feishu section, select the teammate you want to make available and use its publish action. Verify that teammate’s role and Agent configuration first. Each published teammate has its own bot identity.','Rovai progresses through application creation or reuse, bot capability, permissions and event setup, version publication and connection verification. Read the current stage if it stops. Do not create a duplicate platform application merely because verification is taking time.','If tenant approval is required, open the application’s official platform entry. Check its application identity, requested capabilities and available-user scope, then ask the tenant administrator to complete the platform’s review. Return to Rovai and use the available continue or verification action for that same application.','Wait for both publication and connection to succeed. A created application, a submitted version and a connected bot are different milestones. The native App owns account login; desktop Web access does not replace that login step.'],
      ['在飞书区域选中要开放的队员，使用该队员的发布操作。先核对职责与智能体配置；每位已发布队员对应自己的机器人身份。','Rovai 会推进应用创建或复用、机器人能力、权限与事件设置、版本发布和连接验证。停住时查看当前阶段，不要因验证耗时而重复创建平台应用。','需要租户审核时，打开该应用的官方平台入口，核对应用身份、请求能力和可用成员范围，再请租户管理员在平台完成审核。回到 Rovai，对同一个应用继续或重新验证。','等待发布与连接都成功。“已创建应用”“已提交版本”和“机器人已连接”是不同节点。账号登录由原生桌面端完成，桌面 Web 入口不能替代这一步。']),
    I('Find the Channels entry','找到渠道入口','This isolated layout reference shows where providers and teammate publication are configured. It is not a screenshot of the account used in the live test.','这张隔离环境界面参考图展示平台与队员发布的入口，不是实测账号的连接截图。','channels-en.png'),
    S('Send the first private request','发送第一条私聊请求',
      ['In Feishu, find the published bot with the same teammate name. Open its private conversation using the owner account associated with the connection.','For the first test, send the text-only request below. It does not need a project selection or file access.','Watch the execution card and the final text reply. On the Rovai host, open the corresponding Quick chat and inspect the same request and execution. If the card offers Show recent output or Open execution desk, use the entry available for your configured host.','Confirm the platform names in the reply. A delivered request, a running card and a final reply are separate evidence; do not treat sending alone as a successful connection.'],
      ['在飞书中找到与目标队员同名的已发布机器人，使用连接所属账号打开它的私聊。','首次发送下面这条纯文字请求，不需要选择项目或访问文件。','观察执行卡片和最终文字回复；在 Rovai 主机中打开对应快速对话，检查同一请求与执行。卡片提供“显示最近输出”或“打开执行台”时，使用当前主机已配置的可用入口。','核对回复中的平台名称。请求送达、卡片运行和最终回复是不同证据，不能把按下发送当成连接成功。']),
    Q('The request used in the live test','实测使用的请求',
      'This is a Rovai website tutorial request. Give three short platform-selection notes for the Orbit download page: Apple Silicon, Intel and Windows x64. Say which computers each fits and mark each as a tutorial example. Reply with text only. Do not read or write files or contact other teammates.',
      '这是 Rovai 官网渠道教程的演示请求。请为 Orbit 下载页整理三条简短的平台选择说明：Apple Silicon、Intel、Windows x64。每条说明适合哪种电脑，并提醒这是教程示例。只回复文字，不读写文件，不联系其他队员。'),
    P('What actually came back','实际收到的结果',
      ['The live tests used Chinese and English requests in the dedicated Orbit group. The execution card progressed from running to completed. Its reply matched Apple Silicon to Apple M-series Macs, Intel to Intel Macs, and Windows x64 to Intel/AMD x64 computers running 64-bit Windows; each line was marked as a tutorial example.','This verifies private text exchange and a new group’s Quick chat selection, request routing and replies. It does not verify first-time application publication, a project-bound group, file attachments, Lark or DingTalk. The real account’s surrounding chat history is not included in the website assets.'],
      ['实测在 Orbit 专用群里分别发送中英文请求，执行卡从“执行中”变为“已完成”。回复分别把 Apple Silicon 对应到 Apple M 系列 Mac，把 Intel 对应到 Intel Mac，把 Windows x64 对应到运行 64 位 Windows 的 Intel/AMD x64 电脑；每条均标注教程示例。','这验证了已有连接下的私聊收发，以及新群选择快速对话后的寻址和回复；没有验证首次发布、绑定具体项目的群、附件、Lark 或钉钉。本次素材不包含真实账号周边的聊天历史。']),
    P('Move to a group deliberately','需要群聊时再建立关联',
      ['Create a dedicated group and add only the intended published bot and authorized participants. Use Feishu’s actual mention picker to address the bot. The first valid group or topic request can offer a project selection or Quick chat; choose the host project deliberately.','The resulting external conversation binding is stable. Later messages do not silently move it to another project. Being in the same Feishu group does not automatically authorize every person to operate the Rovai owner’s computer; the current inbound ownership checks still apply.'],
      ['建立专用群，添加目标已发布机器人及需要参与的人，再用飞书真正的提及选择器选中机器人。群组或话题首条有效请求可以出现项目选择或快速对话入口，应明确选择主机项目。','建立后，外部会话关联保持稳定；后续消息不会悄悄切换到另一个项目。同在飞书群里也不意味着每个人自动获得操作 Rovai 所有者电脑的权限，当前入站所有权检查仍然适用。']),
    F('Locate a connection problem','按环节排查',[
      ['Bot cannot be found','搜不到机器人','Check the application identity, publication status and platform available-user scope. Confirm you are searching in the correct Feishu tenant.','检查应用身份、发布状态及平台可用成员范围，确认在正确飞书租户中查找。'],
      ['Message arrives but work does not start','消息到达但未开始','Check the owner account, connected host, teammate readiness and current Run or queue. Do not repeatedly send the same file-changing request.','检查所有者账号、连接主机、队员可用性及当前执行或队列。不要反复发送会改文件的同一请求。'],
      ['Publication paused','发布停住','Read the stage and reason. Complete pending platform approval, then continue verification of the known application rather than creating another.','阅读当前阶段和原因，先完成平台待审核事项，再继续验证已有应用，避免重复创建。'],
      ['Output button unavailable','输出入口不可用','A browser execution link needs an available configured Web entry. Read the final chat reply and host Run directly when that link is not configured.','浏览器执行链接需要可用的 Web 入口；未配置时直接查看聊天最终回复和主机执行记录。']]),
    {kind:'links',title:['Platform entry','平台入口'],links:[{url:'https://open.feishu.cn/app',label:['Feishu developer console','飞书开放平台控制台']}]}
  ]);
  prepend('channels',[
    P('Choose one complete path','先走通一个平台',
      ['Start with the Feishu tutorial for the full desktop sign-in, teammate publication and first request flow. Lark is a separate provider; DingTalk has its own developer setup and publication stages. Reuse the concepts, not one platform’s credentials or approval steps.','Channels deliver requests to the connected desktop host and send results back. Keep that host available. The standalone Server 0.4.7 does not provide the Feishu and DingTalk channel path.'],
      ['飞书教程覆盖桌面登录、队员发布和第一条请求。Lark 是独立平台，钉钉也有自己的开发者配置与发布环节；可以复用理解方式，不能照搬账号凭证和审核步骤。','渠道把请求送到已连接桌面主机，再把结果返回。主机需要保持可用。独立 Server 0.4.7 不提供飞书和钉钉渠道链路。'])
  ]);
  prepend('remote',[
    F('Two different host choices','分清两种主机方式',[
      ['Desktop Web entry','桌面 Web 入口','A browser connects to the remote service of an already running desktop App. It uses that host’s workspace and data. Agent execution and file operations remain on that host. Native desktop login is required for channel accounts.','浏览器连接已运行桌面应用的远程服务，共用该主机的工作台与数据；智能体执行和文件操作仍在主机上。渠道账号登录需要原生桌面端。'],
      ['Standalone Server 0.4.7','独立 Server 0.4.7','A separately deployed host has its own data directory, project paths, Agent installations and authentication. It does not automatically share your desktop data or channel connection. Feishu and DingTalk channels are not currently provided by this host form.','独立部署有自己的数据目录、项目路径、智能体安装和认证，不会自动共用桌面数据或渠道连接；这种主机形态当前不提供飞书、钉钉渠道。']]),
    S('Resume work from a browser','从浏览器接着工作',
      ['On the desktop host, open Settings → Remote connection. Enable only the entry you intend to use and follow its displayed address and sign-in method. Keep the host awake and running.','On your other device, open that address over the reachable network and sign in. Check the project and conversation name against the desktop.','Read the previous delivery, send a bounded follow-up if needed, and inspect Run and Files Changed. The resulting changes are on the host, not automatically downloaded to the browser device.','If the page disconnects, first check host availability and the network route. Do not submit duplicate work until you have checked whether the original request was accepted.'],
      ['在桌面主机打开“设置 → 远程连接”，启用需要使用的入口，按显示地址与登录方式连接，保持主机运行且不休眠。','在另一台设备通过可达网络打开地址并登录，核对项目和会话名称与桌面端一致。','阅读上次交付，需要时发送有边界的后续请求，并查看执行与文件变更。修改发生在主机上，不会自动下载到浏览器设备。','掉线后先检查主机和网络；确认原请求是否已接收后，再决定是否重发，避免重复操作。'])
  ]);

  const deliverySections=[
    I('The actual review finding','真实审查意见','The reviewer found footer text at 4.39:1 against the solid background and identified styles.css. It also stated which browser checks had not been performed.','审查队员定位到 styles.css 中页脚文字对比度为 4.39:1，同时明确哪些浏览器检查没有完成。','collaboration-review-en.jpg'),
    Q('A bounded follow-up','根据意见发起小范围修复',
      'Verify the reported footer contrast in the actual CSS. If confirmed, darken only that text color to at least 4.5:1 and add a numeric check to verify.mjs. Re-run the existing checks. Do not redesign, commit or publish. Report the before/after ratio and changed files.',
      '核实实际 CSS 中的页脚对比度。如果确认不足，只加深该文字颜色使其达到至少 4.5:1，并在 verify.mjs 加入数值检查。重新运行已有检查，不重新设计、提交或发布。报告修改前后的比值和变更文件。'),
    I('Inspect the repair and delivery','检查修复与交付','Dingding changed the footer to #5b6984 and added a regression check. The reported result is 5.15:1 against the solid background and at least 4.71:1 across the checked background colors.','Dingding 把页脚改为 #5b6984，并补充回归检查；实际报告是纯色背景 5.15:1，检查的背景颜色中最低 4.71:1。','collaboration-delivery-en.jpg'),
    P('Accept what was actually verified','按实际验证范围验收',
      ['The final delivery includes index.html, styles.css, verify.mjs and the three retained text fixtures. The documentation capture independently reran the Node checks successfully. The Agent’s earlier browser-access denial remains part of the record.','If your own review finds no issue, stop at the accepted result. Do not invent a defect to make the workflow look complete. For another change, send a new request with the current facts and preserve the earlier record.'],
      ['最终交付包含 index.html、styles.css、verify.mjs 以及三个原有文本文件。文档采集时独立重新运行了 Node 检查，结果通过。智能体此前浏览器访问被拒绝的事实仍保留在记录中。','如果你的审查没有发现问题，就以验收结果收尾，不需要编造缺陷凑流程。需要继续修改时，基于当前事实发送新请求，并保留之前的过程。'])
  ];
  const reviewImageIndex=topics.collaboration.sections.findIndex(s=>s.title?.[0]==='Decide from the review, then inspect files');
  if(reviewImageIndex>=0) topics.collaboration.sections.splice(reviewImageIndex,0,...deliverySections);
  else topics.collaboration.sections.push(...deliverySections);


  topics.collaboration.sections.push(
    I('Open the delivered page in Rovai','在 Rovai 中打开交付页面','The file reference opens the real index.html in Rovai’s HTML preview. The image was captured after the contrast repair; it is a rendered delivery, not a replacement mockup.','文件引用在 Rovai HTML 预览中打开真实 index.html。图像采集于对比度修复之后，是实际渲染的交付，不是另外画的效果图。','orbit-preview-en.jpg')
  );
  topics.missions.sections.splice(topics.missions.sections.findIndex(x=>x.kind==='fields'),0,
    P('The actual continuation','实际推进过程',
      ['The first Mission run checked the page, fixture links and local HTTP responses. Its later request to query the Mission service was denied, and it reported that it could not read the full criteria. A new user message supplied the complete criteria, limited the change to DELIVERY.md and did not retry the denied operation.','The successor Run created that one report and passed node verify.mjs. HTML and CSS were unchanged. The temporary HTTP service was stopped. The report was actually written in Chinese, despite the original English request; the source and screenshots preserve that result. This capture does not claim a merge, a release or a completed Mission status.','The Activity view shows a separate worktree, source branch and fixed baseline. Expanding Cumulative file changes revealed DELIVERY.md as one added, uncommitted file. The separate Teammate Delivery section remained empty: a changed file and an explicitly registered delivery are different records.'],
      ['第一次使命执行检查了页面、下载文件和本地 HTTP 响应。后续查询使命服务的操作被拒绝，队员说明无法读取完整验收条件。用户在新消息中补充完整要求，把修改范围限制为 DELIVERY.md，没有重试被拒绝的操作。','后续执行创建了这一份报告，并通过 node verify.mjs；HTML/CSS 未修改，临时 HTTP 服务已停止。虽然初始请求要求英文，实际报告使用中文，源文件和截图保留了这一结果。本次没有把代码合入、正式发布或把使命标记为已完成。','活动区显示独立工作树、来源分支与固定基准。展开累计文件变更后可见新增但未提交的 DELIVERY.md。单独的“队员交付”仍为空：实际文件变化与显式登记的交付属于不同记录。']),
    I('Read the worktree and current changes','读取工作树与当前变化','The Activity view records the execution directory and baseline alongside the current cumulative file list. Refresh reads the current workspace again.','活动区在当前累计文件列表旁记录执行目录与基准；刷新会重新读取当前工作区。',['mission-delivery-en.jpg','mission-delivery-zh.jpg']),
    I('Inspect the delivered report','检查交付报告','The cumulative diff contains 24 added lines in DELIVERY.md: platform files, completed checks and unperformed browser tests. The report remains in the Mission worktree until you integrate it deliberately.','累计差异展示 DELIVERY.md 新增 24 行：平台文件、已完成检查和未完成的浏览器测试。报告仍在使命工作树中，是否集成由后续操作决定。',['mission-diff-en.jpg','mission-diff-zh.jpg'])
  );
  const groupIndex=topics.feishu.sections.findIndex(x=>x.title?.[0]==='Move to a group deliberately');
  topics.feishu.sections.splice(groupIndex,0,
    S('The dedicated group used in the captures','截图中的专用群操作',
      ['Create a group containing only your own account. Open group settings → Group bots → Add bot and select the already published teammate. Check the identity, then add it.','In the message composer, type @ and select that bot from the real mention picker. Add the bounded request and send.','For this text-only tutorial, select Start Quick chat in Rovai’s project-selection card. A project-dependent request should instead choose the intended project on the host.','Rovai creates the corresponding conversation. Compare the incoming message, running teammate and final answer with the external group. The next English request used the same established group conversation.'],
      ['创建仅含自己账号的群，在群设置 → 群机器人 → 添加机器人中选择已发布队员，核对身份后添加。','在输入区键入 @，从实际提及选择器中选中机器人，再填写有边界的请求并发送。','本次是纯文字教程，在 Rovai 项目选择卡片点击“开始快速对话”；依赖文件的请求则应选择主机上的正确项目。','Rovai 会建立对应会话，核对入站消息、运行队员和最终回复与外部群一致。后续英文请求沿用了已建立的群会话。']),
    I('Choose the initial context','选择首次工作上下文','The first group request offered a project or Quick chat. This actual test chose Quick chat and did not access a real project.','第一条群请求可选项目或快速对话。本次实测选择快速对话，没有访问真实项目。','feishu-project-choice-zh.jpg'),
    I('The request and execution in Rovai','Rovai 中的请求与执行','The left side contains the addressed request and reply; the expanded Run on the right shows the actual completed steps, including the successful public reply operation. Unrelated navigation is collapsed.','左侧是带接收对象的请求与回复，右侧展开的执行记录展示实际完成的步骤，包括成功返回公开回复的操作。截图收起了无关导航。',['feishu-rovai-execution-en.jpg','feishu-rovai-execution-zh.jpg']),
    I('Receive the actual reply','收到实际回复','The dedicated group contains the tutorial request, the platform-specific answer and the completed execution card. This is an actual reply from the connected host. Feishu’s interface remains in Chinese; the English page uses the separate English request and response.','专用群中展示教程请求、各平台说明和完成卡片。这是已连接主机返回的实际回复；英文页面采用另一次英文请求与回复，飞书界面仍保留中文。',['feishu-result-en.jpg','feishu-result-zh.jpg'])
  );
  topics.feishu.sections.splice(topics.feishu.sections.findIndex(x=>x.title?.[0]==='Publish the intended teammate')+1,0,
    S('Check the platform-side publication','在飞书平台核对发布',
      ['Open the same application from the Feishu developer console. Compare its name and App ID with the application shown by Rovai, and verify the tenant.','In the application’s capabilities, confirm that the bot capability is present. Rovai’s managed publication configures the bot, permissions and events; inspect the reported stage when setup is incomplete.','Open Version management and release (版本管理与发布), select the submitted version, and inspect its publication status and available-user scope. If it awaits review, have the authorized tenant administrator review that version and its requested permissions.','Once the platform shows the version as published and your account is in the available scope, return to the same teammate in Rovai and continue connection verification. Then find that bot in Feishu and send the small text request below.'],
      ['在飞书开放平台控制台打开同一个应用，对照 Rovai 显示的应用名称与 App ID，并确认所属租户。','在应用能力中确认已添加机器人。Rovai 的受管发布负责配置机器人、权限与事件；配置未完成时，结合 Rovai 报告的具体阶段检查。','进入“版本管理与发布”，打开已提交版本，查看发布状态与可用成员范围。若正在等待审核，请有权限的租户管理员审核该版本及其请求的权限。','平台显示版本已发布、当前账号属于可用范围后，回到 Rovai 的同一队员继续验证连接，再在飞书找到该机器人，发送下面的小范围文字请求。']),
    {kind:'links',title:['Feishu platform references','飞书平台参考'],links:[
      {url:'https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process',label:['Custom app development and publication','企业自建应用开发与发布']},
      {url:'https://www.feishu.cn/content/389799179937',label:['Bot capability and adding a bot to a group','机器人能力与添加机器人进群']}
    ]}
  );
  // Integrate captured results before the reference tables and related reading.
  const beforeFields=(id,items)=>{const at=topics[id].sections.findIndex(x=>x.kind==='fields');topics[id].sections.splice(at<0?topics[id].sections.length:at,0,...items);};
  beforeFields('automations',[
    I('The completed occurrence','本次已完成的运行','The history row records Run succeeded. Opening it reveals a new conversation with the saved request and the actual result.','历史记录显示运行成功；打开该行会进入带有保存请求和实际结果的新会话。','automation-history-en.jpg'),
    I('Read the report in its conversation','在对应会话阅读报告','The check returned exit code 0, listed Apple Silicon, Intel and Windows x64, and reported an unchanged working tree. The final reply also retained an explicit-send CLI limitation.','检查返回退出码 0，列出 Apple Silicon、Intel、Windows x64，并报告工作区未变化；最终回复同时保留了显式发送 CLI 的限制。','automation-result-en.jpg')
  ]);
  topics.missions.sections.splice(topics.missions.sections.findIndex(x=>x.title?.[0]==='Create, start and follow through')+1,0,...[
    I('A filled mission, ready to start','填写完整的使命','This continuation verifies the delivered Orbit page and requests one DELIVERY.md. The fixture’s final page was committed as the starting point before the Mission was created.','该后续目标核验已交付 Orbit 页面，只要求新增 DELIVERY.md。创建使命前，最终页面已在独立示例仓库中保存为起始提交。','mission-filled-en.jpg'),
    I('Execution and board state can differ','执行与看板状态可以不同','A teammate is running while the card still appears under Not started. Starting execution did not silently change the Mission’s business status.','队员已在执行，但卡片仍位于“未开始”。启动执行没有悄悄替用户改写使命业务状态。','mission-running-en.jpg')
  ]);
  beforeFields('tasks',[
    I('Record one owner and a bounded responsibility','填写负责人及责任范围','This actual saved task assigns Cheese a final delivery check. It remains pending; the task card explicitly says that creation does not automatically start execution.','这条实际保存的任务把最终交付检查交给 Cheese，保持待处理；任务卡明确显示“创建不会自动启动执行”。','task-saved-zh.jpg')
  ]);
  beforeFields('files',[
    I('Read the exact repair','阅读具体修复','The real diff changes the footer color from #66748f to #5b6984. Use the adjacent file list to inspect the numeric regression check in verify.mjs.','真实差异把页脚颜色从 #66748f 改为 #5b6984；通过旁边文件列表还能查看 verify.mjs 的数值回归检查。','files-contrast-zh.jpg')
  ]);
  topics.approvals.sections.splice(1,0,
    I('A real approval during the Mission','使命中真实出现的审批','The Agent requested a localhost-only HTTP server to check download responses. The capture shows the exact command, working directory and native choices before Allow once was selected.','智能体请求启动仅本机可访问的 HTTP 服务检查下载响应。图中是选择“Allow once”之前的具体命令、目录与原生选项。','approval-real-en.jpg'),
    S('Resolve the operation, then observe progress','处理操作后再观察进展',
      ['Read the reason and full command. Here the target is the isolated Orbit worktree and the bind address is 127.0.0.1.','Choose the native option matching your intended scope. This recording allowed only this invocation, not all future commands.','Return to Run to see whether the operation resumed. The later output reported HTTP 200 for the page and three text fixtures. That checks HTTP responses, not visual browser layout.'],
      ['阅读理由与完整命令。本例目标是隔离的 Orbit 工作树，监听地址为 127.0.0.1。','选择符合本次范围的原生选项。这次只允许这一项操作，没有给未来全部命令授权。','回到执行记录确认是否恢复。后续输出报告页面和三份文本均返回 HTTP 200；这验证响应，不等于浏览器视觉检查。'])
  );
  topics.execution.sections=topics.execution.sections.filter(x=>!(x.kind==='shot'&& !x.image.startsWith('collaboration')) && x.title?.[0]!=='Choose the panel position');
  topics.execution.sections.splice(topics.execution.sections.length-executionReference.length,0,{
    kind:'gallery',title:['Three panel positions','三种执行台布局'],
    body:['These captures show the same real contrast repair. Choose a position for reading; it does not change the execution or its permissions. Expand a view to compare.','以下画面展示同一次真实对比度修复。选择布局只影响阅读方式，不改变执行及权限；展开对应项可比较。'],
    images:[
      {label:['Pin to right','固定到右侧'],image:['collaboration-delivery-en.jpg','collaboration-delivery-zh.jpg'],alt:['Conversation beside the real Run','会话与真实执行并排'],caption:['Read the request and execution side by side.','并排阅读请求和执行过程。']},
      {label:['Floating layer','浮层'],image:'execution-floating-real-en.jpg',alt:['Real execution in a floating panel','浮层中的真实执行'],caption:['Keep the conversation width and open the execution when needed.','保持会话宽度，需要时打开执行浮层。']},
      {label:['Bottom','底部'],image:['execution-bottom-real-en.jpg','execution-bottom-real-zh.jpg'],alt:['Real execution in the bottom panel','底部面板中的真实执行'],caption:['Use a wide panel for process and command output.','用宽幅区域阅读过程与命令输出。']}
    ]
  });
  for(const topic of Object.values(topics)) for(const sec of topic.sections){
    if(sec.image==='memory-saved-en.jpg')sec.image=['memory-saved-en.jpg','memory-saved-zh.jpg'];
    if(sec.image==='memory-revision-en.jpg')sec.image=['memory-revision-en.jpg','memory-revision-zh.jpg'];
    if(sec.image==='collaboration-delivery-en.jpg')sec.image=['collaboration-delivery-en.jpg','collaboration-delivery-zh.jpg'];
    if(sec.image==='workspace-en.png') {sec.image=['collaboration-delivery-en.jpg','collaboration-delivery-zh.jpg'];sec.caption=['Actual Orbit repair delivery; open the collaboration tutorial for the full sequence.','真实 Orbit 修复交付；完整过程见多队员协作教程。'];}
  }
  topics.collaboration.sections.push({kind:'links',title:['Try the same project','使用同一个示例项目'],links:[
    {file:'examples/orbit-tutorial.zip',label:['Download the starter, actual result and Mission report','下载起始项目、真实结果与使命报告']},
    {file:'examples/orbit/index.html',label:['Open the delivered Orbit page','打开最终 Orbit 页面']}
  ]});
  topics.missions.sections.push({kind:'links',title:['Read the actual report','查看实际报告'],links:[
    {file:'examples/mission/DELIVERY.md',label:['DELIVERY.md — from the separate Mission worktree','DELIVERY.md：来自独立使命工作树']}
  ]});
  topics.installation.sections.splice(1,0,
    {kind:'aside',body:[
      'Mac users upgrading from v0.4.0 or earlier to v0.4.1 need one manual replacement because the signing identity changed. Finish current work and quit Rovai, download the DMG for your chip, drag the app into Applications, choose Replace, then reopen it and check your conversations and settings. Do not uninstall the old app or clear user data.',
      'Mac 用户从 v0.4.0 或更早版本升级到 v0.4.1 时，由于签名身份变更，需要手动覆盖安装一次。完成手头工作并退出 Rovai，下载对应芯片的 DMG，拖入“应用程序”并选择“替换”；重新打开后检查会话与设置。不要卸载旧版或清理用户数据。'
    ]},
    {kind:'links',title:['Release details','版本说明'],links:[
      {url:'https://github.com/murray17/rovai-ai/releases/tag/v0.4.1',label:['Read the v0.4.1 upgrade notes','查看 v0.4.1 升级说明']}
    ]}
  );
  for(const [id,ids] of Object.entries({
    understanding:['quickstart','mechanism','collaboration'],mechanism:['collaboration','missions','memory'],
    collaboration:['members','tasks','files','missions','memory'],members:['agents','session-members','collaboration'],
    agents:['compatibility','execution'],missions:['tasks','execution','files'],tasks:['collaboration','missions'],
    memory:['collaboration','members'],execution:['approvals','recovery','files'],files:['missions','collaboration'],
    approvals:['execution','recovery'],recovery:['message-queue','execution'],skills:['agents','mcp','collaboration'],
    automations:['execution','channels'],channels:['feishu','remote'],feishu:['channels','remote','execution'],remote:['channels','compatibility'],
    quickstart:['collaboration','mechanism']
  })) related(id,ids);
})();
