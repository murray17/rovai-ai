// Published behavior: Desktop v0.4.1 / Server server-v0.4.0.
// Capture provenance and intentionally untested network paths: website/deployment-notes.md.
(() => {
  const {topics,groups}=window.RovaiDocs;
  const P=(en,zh,e,z)=>({kind:'prose',title:[en,zh],paragraphs:[e,z]});
  const S=(en,zh,e,z)=>({kind:'steps',title:[en,zh],steps:[e,z]});
  const C=(en,zh,e,z=e)=>({kind:'code',title:[en,zh],body:[e,z]});
  const F=(en,zh,rows)=>({kind:'fields',title:[en,zh],rows:rows.map(([a,b,c,d])=>({label:[a,b],text:[c,d]}))});
  const TB=(en,zh,ec,zc,er,zr)=>({kind:'table',title:[en,zh],columns:[ec,zc],rows:[er,zr]});
  const D=(en,zh,file,e,z)=>({kind:'diagram-file',title:[en,zh],file,alt:[e,z],caption:[e,z]});
  const I=(en,zh,file,e,z)=>({kind:'shot',title:[en,zh],image:file,alt:[e,z],caption:[e,z]});
  const L=(en,zh,links)=>({kind:'links',title:[en,zh],links});
  const link=(id,en,zh)=>({id,label:[en,zh]});
  const ext=(url,en,zh)=>({url,label:[en,zh]});
  const T=(en,zh,e,z,sections)=>({title:[en,zh],lead:[e,z],sections});
  const release='https://github.com/murray17/rovai-ai/releases/tag/server-v0.4.0';
  const releaseFiles='https://github.com/murray17/rovai-ai/releases/download/server-v0.4.0/';
  const related=ids=>L('Continue reading','接着阅读',ids.map(id=>({id,label:topics[id].title})));
  for(const group of groups)group.ids=group.ids.filter(id=>id!=='remote');
  groups.splice(groups.findIndex(g=>g.ids.includes('compatibility')),0,{
    en:'Deployment and remote access',zh:'部署与远程访问',
    ids:['remote','desktop-web','server-install','lan-access','tailscale','public-https','server-maintenance']
  });

  topics.remote=T('Deployment and access overview','部署与访问总览',
    'Choose where Rovai runs, then choose how your other devices reach it. These are two separate decisions.',
    '先决定 Rovai 运行在哪里，再选择其他设备怎样连接。这是两个独立的选择。',[
    P('Continue the work on the host you choose','连接哪台主机，就继续那里的工作',
      ['A browser is another entrance to a running Rovai instance. Conversations, teammates and execution records come from that instance. Agents run on its host and edit the project files available there.', 'Remote access neither migrates nor automatically synchronizes data. Opening a new Server will not bring your Desktop roster, conversations, Agent sign-in or projects with it. To continue a Desktop conversation, connect to that Desktop’s Web service.'],
      ['浏览器是已运行 Rovai 实例的另一个入口。会话、队员和执行记录来自该实例；智能体在它的主机上运行，操作主机能够访问的项目文件。','远程访问不会迁移或自动同步数据。新装 Server 不会自动获得 Desktop 的名册、会话、智能体登录或项目。想继续桌面端的原会话，就连接那一份 Desktop 的 Web 服务。']),
    D('Choose a route','选择适合你的路径','deployment-choice',
      'First choose Desktop Web or a separate Server. Then choose a trusted LAN, a private Tailscale connection or a public HTTPS entrance supported by that release.',
      '先选 Desktop Web 或独立 Server，再选可信局域网、Tailscale 私网或该版本支持的公网 HTTPS 入口。'),
    TB('Two deployment forms','两种部署形态',
      ['Capability','Desktop Web · 0.4.1','Standalone Server · 0.4.0'],['能力','Desktop Web · 0.4.1','独立 Server · 0.4.0'],[
        ['Start / default port','Settings → Remote connection; 8766','Command line; 8767'],
        ['Data and projects','The running Desktop instance and its host files','Its own data directory and host project files'],
        ['Agents','Installed and signed in as the Desktop host user','Installed and signed in as the Server process user'],
        ['Conversations and work','Existing Desktop workspace through a browser','Independent workspace through a browser'],
        ['Channel accounts','Initial sign-in, switching and re-login need native Desktop','Channels are not provided'],
        ['Channel operations in browser','Manage supported existing connections; native account steps remain on Desktop','Not available'],
        ['External HTTPS origin','No origin/domain field in this release’s settings','--public-origin configures a root HTTPS origin'],
        ['Lifetime','Keep Desktop and its host running; re-enable Web after App restart','Keep the Server process running; optionally configure your OS service manager']
      ],[
        ['启动 / 默认端口','设置 → 远程连接；8766','命令行；8767'],
        ['数据与项目','正在运行的 Desktop 实例及其主机文件','独立数据目录及其主机项目文件'],
        ['智能体','由桌面主机用户安装并登录','由 Server 运行账号安装并登录'],
        ['会话与工作','浏览器访问已有桌面工作台','浏览器访问独立工作台'],
        ['渠道账号','首次登录、切换、重新登录需要原生 Desktop','不提供渠道'],
        ['浏览器内渠道操作','可管理已支持的现有连接；原生账号步骤仍回 Desktop 完成','不可用'],
        ['外部 HTTPS 来源','此版本设置没有域名 / Origin 字段','通过 --public-origin 配置根 HTTPS 来源'],
        ['运行周期','主机与 Desktop 保持运行；App 重启后重新开启 Web','保持 Server 进程运行；可另行配置系统服务管理器']
      ]),
    D('Which instance owns the work?','哪一份实例保存工作？','deployment-forms',
      'The browser selects an instance by its address. Desktop and Server each use their own data and host-side environment; the diagram contains no synchronization arrow.',
      '浏览器通过地址选择实例。Desktop 与 Server 分别使用自己的数据和主机环境；两者之间没有自动同步关系。'),
    TB('Three ways to connect','三种连接方式',
      ['Route','Use it when','Prepare'],['方式','适用场景','需要准备'],[
        ['Trusted LAN HTTP','Phone and host share a trusted network','Host LAN IP, a reachable listener and scoped firewall access'],
        ['Tailscale private access','You use your host across networks','Both devices in the tailnet; Server can add Serve HTTPS'],
        ['Public HTTPS','A normal browser should reach a fixed domain','Reachable Server host, domain, HTTPS reverse proxy and owner login']
      ],[
        ['可信局域网 HTTP','手机和主机处于同一可信网络','主机局域网 IP、可达监听地址、限定范围的防火墙规则'],
        ['Tailscale 私有访问','跨网络使用自己的主机','两端加入同一私网；Server 可增加 Serve HTTPS'],
        ['公网 HTTPS','希望普通浏览器通过固定域名访问','可达的 Server 主机、域名、HTTPS 反向代理与 Owner 登录']
      ]),
    P('Match the recipe to your release','按版本选择教程',
      ['These are network arrangements, not three built-in switches. Tailscale and the reverse proxy are configured outside Rovai. Before choosing Server 0.4.0 for Agent work, read the installation page: the macOS arm64 package tested for this guide is blocked by missing bundled Skill resources.', 'Desktop 0.4.1 offers a Web toggle and port, but no public-origin setting. Use its LAN address or its host’s Tailscale interface address. The complete Serve HTTPS and public HTTPS recipes in this group use Server 0.4.0; do not paste Server flags into Desktop.', 'This is a single-owner workspace. A login Token grants access to that instance; publishing an HTTPS address does not create separate accounts or project-level roles.'],
      ['这三种方式是网络方案，不是 App 内三个一键开关。Tailscale 和反向代理需要在 Rovai 外配置。选择 Server 0.4.0 执行智能体工作前，先读安装页：本教程实测的 macOS arm64 包因缺少 bundled Skill 资源而阻塞执行。','Desktop 0.4.1 提供 Web 开关和端口，没有公共来源设置。可使用局域网地址或主机的 Tailscale 网卡地址。本组完整的 Serve HTTPS、公网 HTTPS 配方使用 Server 0.4.0，不要把 Server 参数套到 Desktop。','这是单 Owner 工作台。登录 Token 用于访问对应实例；开放 HTTPS 地址不会自动建立多人账号或项目级权限。']),
    L('Start here','从这里开始',[
      link('desktop-web','Continue an existing Desktop conversation','继续已有桌面会话'),
      link('server-install','Install on a separate host','在独立主机安装 Server'),
      link('lan-access','Connect from the same network','从同一网络连接'),
      link('tailscale','Connect privately across networks','跨网络私有访问'),
      link('public-https','Set up a public HTTPS address','配置公网 HTTPS 地址')])
  ]);

  topics['desktop-web']=T('Enable Desktop Web access','开启桌面端 Web 访问',
    'Open your existing Desktop workspace in another browser. This guide describes Desktop 0.4.1.',
    '从另一个浏览器打开已有桌面工作台。本页按 Desktop 0.4.1 编写。',[
    S('Enable the service on your desktop host','在桌面主机开启服务',
      ['Finish installing and opening Rovai Desktop on the computer that owns your project. Confirm that the original conversation works there.', 'Open Settings → Remote connection. Keep the default port 8766 if it is free; otherwise choose an unused port. Port changes take effect when you enable the service again.', 'Turn on remote access. Check that the status becomes running and that the page lists an address. The Desktop listener accepts connections on the host’s network interfaces.', 'For a first check on this computer, open its local address. For a phone, choose an address belonging to the network the phone can reach.', 'Copy the login Token from the same settings page and enter it into the browser login form. Keep the Token out of URLs, screenshots and shared notes.'],
      ['在保存项目的电脑上安装并打开 Rovai Desktop，先确认原会话可以正常工作。','进入“设置 → 远程连接”。8766 未被占用时保留默认值；否则选择空闲端口。修改端口后，需要重新开启服务才生效。','开启远程访问，确认状态变为运行中且页面列出地址。Desktop 会在主机的网络接口上接受连接。','先在这台电脑用本机地址检查；手机应选择手机所在网络能够访问的主机地址。','从同一设置页复制登录 Token，填入浏览器登录表单。不要把 Token 放进 URL、截图或共享笔记。']),
    I('Settings and running address','设置入口与运行地址',['desktop-web-settings-en.jpg','desktop-web-settings-zh.jpg'],
      'An isolated Desktop 0.4.1 instance. The example uses port 18766 because 8766 was occupied; the product default remains 8766. This crop shows the toggle, port and local address; the host’s private network address and credentials are outside the crop.',
      '隔离的 Desktop 0.4.1 实例。截图因 8766 已被占用而使用 18766；产品默认仍为 8766。截取开关、端口与本机地址，主机私网地址和凭据不进入公开画面。'),
    F('Read the address correctly','读懂访问地址',[
      ['127.0.0.1 / localhost','127.0.0.1 / localhost','These refer to the device running the browser. On your phone they mean the phone, not your Mac. Use them only for a browser on the Rovai host.','这两个地址指向浏览器所在设备。在手机上它们指手机自身，不是你的 Mac；只供 Rovai 主机上的浏览器使用。'],
      ['LAN address','局域网地址','For example http://192.168.1.50:8766. Use the actual address shown for the host’s reachable network and the chosen port.','例如 http://192.168.1.50:8766。使用主机可达网卡的实际地址及所选端口。'],
      ['0.0.0.0','0.0.0.0','A listening scope, not the address to type into a phone. It means the service accepts traffic on available IPv4 interfaces.','这是监听范围，不是手机应输入的目标地址，表示服务接受可用 IPv4 网卡上的连接。'],
      ['QR shortcut','二维码快捷登录','If you use the login QR option, treat it as a short-lived credential. Generate it when ready, scan privately and regenerate if expired. This tutorial uses the Token form so no live QR is published.','使用登录二维码时，把它视为短期凭据；准备连接时再生成，私下扫码，过期后重新生成。本教程使用 Token 表单，不公开有效二维码。']]),
    I('Log in at phone width','在手机尺寸下登录','desktop-web-login-zh.jpg',
      'The Desktop-hosted login page, which is Chinese in this release, captured at a phone-sized viewport. It is a responsive browser capture, not proof of a physical second-device network test.',
      'Desktop 托管的浏览器登录页，按手机宽度采集。这是响应式浏览器截图，不代表已完成第二台实体设备的联网验收。'),
    S('Continue the same conversation','进入同一会话继续工作',
      ['After login, open the navigation and choose the same project and conversation you saw on Desktop.', 'Read the latest message, inspect the Run and changed files, then send a small follow-up to the intended teammate. The selected project is still on the desktop host.', 'Return to Desktop and open that conversation. The browser request and its result belong to the same instance.', 'If the browser disconnects, reconnect and inspect the existing execution before sending the same request again.'],
      ['登录后展开导航，选择与 Desktop 相同的项目和会话。','先读最后一条消息，查看执行和文件变更，再向指定队员发出小范围后续请求。项目仍在桌面主机上。','回到 Desktop 打开同一会话，浏览器请求及结果属于同一个实例。','浏览器掉线后先重新连接、检查原执行，再决定是否重发相同请求。']),
    I('The same host conversation','同一主机上的会话',['desktop-web-conversation-en.jpg','desktop-web-conversation-zh.jpg'],
      'Orbit in the isolated Desktop instance, reopened through its browser entrance. Files and execution remain on the host.',
      '通过浏览器入口重新打开隔离 Desktop 实例中的 Orbit 会话。文件和执行仍保留在主机上。'),
    I('The matching Desktop conversation','桌面端对应的同一会话',['desktop-host-conversation-en.jpg','desktop-host-conversation-zh.jpg'],
      'The same Orbit · Browser follow-up conversation in the native Desktop App, with the same request and actual file-check result. Interface language changes do not translate saved teammate identities or message content.',
      '原生 Desktop 中同名 Orbit · Browser follow-up 会话，包含同一请求与实际文件检查结果。界面切换语言不会翻译已保存的队员身份或消息内容。'),
    P('Keep the work available','保持工作台可用',
      ['The host must stay awake and online. Keep Desktop running and the chosen Agent installed, signed in and able to reach its model service. Closing a browser tab does not stop an accepted Run.', 'Turning off Web access closes browser sessions; it does not mean the Desktop’s work has been undone. Quitting Desktop or shutting down the host can interrupt execution. After restarting the App, reopen Remote connection and enable Web again.', 'Across networks, use the Tailscale guide. Desktop 0.4.1 cannot configure an external HTTPS origin in its settings; use the independent Server recipe when you need Serve HTTPS or a public domain.'],
      ['主机需要保持唤醒、联网，Desktop 持续运行；所选智能体应已安装、登录，并能访问模型服务。关闭浏览器标签页不会停止已经接收的执行。','关闭 Web 访问会结束浏览器会话，不等于撤销 Desktop 中的工作。退出 Desktop 或关闭主机可能中断执行。App 重启后，要回远程连接重新开启 Web。','跨网络访问阅读 Tailscale 教程。Desktop 0.4.1 设置无法配置外部 HTTPS 来源；需要 Serve HTTPS 或公网域名时，使用独立 Server 配方。'])
  ]);

  topics['server-install']=T('Install and run Rovai Server','安装与启动 Rovai Server',
    'Install the published native package, start one independent workspace, and open it in a browser. No source build is required.',
    '安装已发布的原生包，启动独立工作台，再从浏览器进入。普通安装不需要源码构建。',[
    P('Known issue in the published macOS arm64 0.4.0 package','已发布 macOS arm64 0.4.0 包的已知问题',
      ['The package tested on 2026-09-29 can start and accept browser login when launched from current/rovai-server, but a real first request fails with “bundled Skill resources are unavailable”. The release archive does not contain the required bundled Skill resources. Installing a different Agent does not fix this package issue.', 'Use this guide to understand installation and connectivity, but do not rely on that package for completed Agent work until a corrected release is available. Desktop Web is the currently demonstrated alternative. Other OS packages were not execution-tested in this documentation pass.'],
      ['2026-09-29 实测：从 current/rovai-server 启动后可以进入浏览器工作台，但真实首次请求报“bundled Skill resources are unavailable”。发布归档没有包含所需 bundled Skill 资源；更换智能体不能解决这个包问题。','本页仍说明安装与连接操作；修正版发布前，不应依赖这个包完成智能体工作。可采用已演示的 Desktop Web 路径。本轮没有对其他系统包进行真实执行验收。']),
    P('Use the Server release','选择 Server 发布版',
      ['This guide uses Server 0.4.0 (tag server-v0.4.0), independently of Desktop 0.4.1. Use the Server assets from that tag, including its installer script and SHA256SUMS.', 'The package contains the host and matching Web UI. Keep them together. Running the host itself does not require Electron, Node, Rust or pnpm. Each coding Agent has its own installation and authentication requirements.'],
      ['本教程使用 Server 0.4.0（标签 server-v0.4.0），与 Desktop 0.4.1 分别发布。使用这个 Server 标签下的安装包、安装脚本及 SHA256SUMS。','包内包含服务程序和匹配的 Web 界面，必须保持完整。运行 Host 本身不依赖 Electron、Node、Rust 或 pnpm；编程智能体仍有各自的安装和认证要求。']),
    TB('Choose your host package','选择主机安装包',
      ['Host','Asset','Requirements / boundary'],['主机','安装包','条件与边界'],[
        ['macOS Apple Silicon','rovai-server-0.4.0-macos-arm64.tar.gz','Apple Silicon; use the 0.4.0 launch-path workaround below'],
        ['macOS Intel','rovai-server-0.4.0-macos-x64.tar.gz','Intel x64; same package layout'],
        ['Linux x64 GNU','rovai-server-0.4.0-linux-x64.tar.gz','glibc 2.35 baseline; Ubuntu 22.04+ / Debian 12+; no ARM64 or Alpine/musl package'],
        ['Windows x64','rovai-server-0.4.0-windows-x64.zip','x64 Visual C++ v14 Runtime; installer does not add that system component']
      ],[
        ['macOS Apple 芯片','rovai-server-0.4.0-macos-arm64.tar.gz','Apple Silicon；0.4.0 使用下方启动路径处理办法'],
        ['macOS Intel','rovai-server-0.4.0-macos-x64.tar.gz','Intel x64；包结构相同'],
        ['Linux x64 GNU','rovai-server-0.4.0-linux-x64.tar.gz','glibc 2.35 基线；Ubuntu 22.04+ / Debian 12+；无 ARM64 或 Alpine/musl 包'],
        ['Windows x64','rovai-server-0.4.0-windows-x64.zip','需要 x64 Visual C++ v14 Runtime；安装器不代装该系统组件']
      ]),
    L('Get the files and prerequisites','获取文件与前置依赖',[
      ext(release,'Server 0.4.0 release and all assets','Server 0.4.0 发布说明与全部附件'),
      ext('https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist','Microsoft Visual C++ Redistributable','Microsoft Visual C++ 可再发行组件'),
      link('compatibility','Agent availability and platform support','智能体可用性与平台支持')]),
    S('Prepare one ordinary host account','准备一个普通主机账号',
      ['Use an ordinary OS account for Server and its Agents. Install and sign in to the Agent under that same account; do not start Rovai as root to work around a missing CLI.', 'Put your project in a host directory this account can read and, when needed, write. The browser device’s folders are not automatically mounted on the host.', 'Choose a durable absolute data directory with no symlink components. The default is ~/.rovai-server under the process user’s home. Program files and project files are separate.', 'Confirm the chosen port is free. The examples start at 127.0.0.1:8767 for a local check; use a later connection guide to make it reachable elsewhere.'],
      ['使用一个普通系统账号运行 Server 和智能体。在同一账号下安装并登录智能体，不要为解决 CLI 找不到而改用 root 启动 Rovai。','项目放在这个账号可以读取、按需要写入的主机目录。浏览器设备的文件夹不会自动挂载到主机。','选择长期保留、没有符号链接路径组件的绝对数据目录。默认是进程账号主目录下的 ~/.rovai-server；程序文件和项目文件另存。','确认端口空闲。先用 127.0.0.1:8767 完成本机检查，再按后续连接教程让其他设备可达。']),
    C('macOS / Linux · download the installer','macOS / Linux · 下载安装器',
`curl -fL '${releaseFiles}install-server.sh' -o install-server.sh
sh install-server.sh --version 0.4.0`),
    P('What the Unix installer changes','Unix 安装器做了什么',
      ['Run these commands in a working folder. curl is needed to download; the shell installer uses standard archive and SHA-256 utilities. Read the downloaded script if your host has an installation review policy.', 'The default program directory is ~/.local/share/rovai-server, with versioned revisions and a current link. The command link is ~/.local/bin/rovai-server. The installer verifies the selected archive against the same release’s SHA256SUMS and adds guarded PATH entries to common shell profiles. Open a new terminal to pick them up.', 'It does not install a system service, install an Agent, or move Desktop data. For an offline host, download the matching archive and SHA256SUMS from the same tag on another device, transfer them together, and use --from-dir /absolute/release-folder. --prefix and --bin-dir customize the program and command directories.'],
      ['在一个工作文件夹中运行命令。下载需要 curl，脚本使用系统常见的解包与 SHA-256 工具；主机有安装审查要求时先阅读下载的脚本。','默认程序目录为 ~/.local/share/rovai-server，内含按版本保留的 revisions 和 current 链接；命令链接位于 ~/.local/bin/rovai-server。安装器用同一 Release 的 SHA256SUMS 校验选中归档，并向常用 shell 配置添加有保护的 PATH 项；新开终端使其生效。','安装器不会建立系统服务、安装智能体或迁移 Desktop 数据。离线安装时，在另一设备下载同一标签的匹配归档与 SHA256SUMS，一起传入，再使用 --from-dir /绝对路径/发布文件夹。--prefix 与 --bin-dir 分别指定程序和命令目录。']),
    C('Windows · install from PowerShell','Windows · 从 PowerShell 安装',
`Invoke-WebRequest '${releaseFiles}install-server.ps1' -OutFile install-server.ps1
.\u005cinstall-server.ps1 -Version 0.4.0`),
    P('Windows program location','Windows 程序位置',
      ['The installer places the package in %LOCALAPPDATA%\\Programs\\RovaiServer\\current and adds it to the user PATH. Open a new PowerShell window, then run rovai-server --version. Use -InstallDirectory to select another program root or -FromDirectory for local release files.', 'If the command reports a missing VCRUNTIME140.dll, install Microsoft’s x64 v14 runtime first. If your organization blocks scripts, follow its approved script policy; changing the machine-wide execution policy is not part of this guide.'],
      ['程序默认放在 %LOCALAPPDATA%\\Programs\\RovaiServer\\current，并加入用户 PATH。新开 PowerShell，运行 rovai-server --version。-InstallDirectory 可指定程序根目录，-FromDirectory 可使用本地发布文件。','若提示缺少 VCRUNTIME140.dll，先安装 Microsoft 的 x64 v14 组件。如果组织策略阻止脚本，按组织批准的方式执行；本教程不要求更改整机脚本策略。']),
    P('macOS 0.4.0 · launch from the program directory','macOS 0.4.0 · 从程序目录启动',
      ['In the macOS arm64 package tested for this guide, the installer’s ~/.local/bin shortcut can report “Matching WebUI is missing” at startup. The program locates web-ui next to its executable; the shortcut path can resolve to the wrong parent. Start the executable inside current instead. This is a release-specific workaround, not a reason to rebuild or move web-ui into your bin folder.', 'The examples below use the default installation. If you selected --prefix, substitute that program directory. Keep the complete release package together.'],
      ['本教程实测的 macOS arm64 0.4.0 包，通过 ~/.local/bin 快捷命令启动时可能出现“Matching WebUI is missing”。程序寻找相邻 web-ui 时，快捷链接路径可能指向错误的父目录。请直接启动 current 内的程序。这是该版本的兼容处理，无需重新构建，也不要把 web-ui 搬到 bin 目录。','下方按默认安装目录书写；若使用 --prefix，替换为自己的程序目录，并保留完整发布包。']),
    C('First start · macOS','首次启动 · macOS',
`"$HOME/.local/share/rovai-server/current/rovai-server" \\
  --data-dir "$HOME/.rovai-server" \\
  --listen 127.0.0.1:8767`),
    C('First start · Linux','首次启动 · Linux',
`rovai-server --data-dir "$HOME/.rovai-server" --listen 127.0.0.1:8767`),
    C('First start · Windows PowerShell','首次启动 · Windows PowerShell',
`rovai-server --data-dir "$HOME/.rovai-server" --listen 127.0.0.1:8767`),
    S('Log in and prepare the workspace','登录并准备工作环境',
      ['Keep the terminal open. Wait for Ready and read the address and data directory in the startup summary. A local browser opens http://127.0.0.1:8767/.', 'Use the login Token displayed in an interactive startup terminal. When output is redirected or a service manager starts the process, use the token command in a separate terminal with the same --data-dir.', 'After login, check the Agent/Runtime settings on the Server host. Server 0.4.0 still uses some Runtime labels; newer Desktop UI calls them Agents. A browser login does not authenticate the Agent.', 'Create or configure a teammate, select a host project directory, create a conversation and send a small read-only request. Open the execution record and compare the answer with actual files.', 'To stop a foreground Server, press Ctrl-C and wait for it to exit. Starting again with the same account and data directory reopens the same workspace.'],
      ['保持终端打开，等启动摘要出现 Ready，并检查地址与数据目录。本机浏览器打开 http://127.0.0.1:8767/。','使用交互式启动终端显示的登录 Token。输出被重定向或由服务管理器启动时，在另一终端用相同 --data-dir 运行 token 命令。','登录后检查 Server 主机的智能体 / Runtime 设置。Server 0.4.0 的部分界面仍称 Runtime，新版 Desktop 称智能体。浏览器登录不等于完成智能体认证。','创建或配置一位队员，选择主机项目目录，新建会话，发送一个小的只读请求。打开执行记录，对照实际文件核对回答。','前台运行时按 Ctrl-C，等待进程退出。用同一账号、同一数据目录再次启动，会重新打开原工作台。']),
    C('Read the Token · Linux / Windows','获取 Token · Linux / Windows',
`rovai-server --data-dir "$HOME/.rovai-server" token`),
    C('Read the Token · macOS 0.4.0','获取 Token · macOS 0.4.0',
`"$HOME/.local/share/rovai-server/current/rovai-server" --data-dir "$HOME/.rovai-server" token`),
    I('Browser login','浏览器登录','server-login-zh.jpg',
      'The actual Server 0.4.0 login screen before credentials are entered. This release’s Web UI is Chinese. Use this Server’s Token, not Desktop’s.',
      '实际 Server 0.4.0 登录页，尚未填写凭据。应使用本 Server 实例的 Token，不能混用 Desktop 凭据。'),
    I('An actual first request and its blocker','真实首次请求及遇到的阻碍','server-orbit-zh.jpg',
      'Orbit in the isolated Server 0.4.0 workspace. The submitted request failed before Agent launch because bundled Skill resources were unavailable. This is an actual failure, not a completed review; the release’s Web UI is Chinese.',
      '隔离 Server 0.4.0 工作台中的 Orbit 项目。真实请求在智能体启动前因缺少 bundled Skill 资源而失败；这不是已完成的审查。'),
    P('What these examples verify','这组示例验证了什么',
      ['The package install, local browser login, host-project conversation, failed first execution and normal stop/restart were checked on macOS arm64. Package availability for other platforms is listed above; this capture is not a Windows/Linux acceptance run or a physical phone connectivity test.', 'Agent support is separate from host package availability. In particular, Linux Agent entries retain their own preview/qualification status. Use the compatibility guide before relying on a particular Agent.'],
      ['本组在 macOS arm64 检查了包安装、本机浏览器登录、主机项目会话、首次执行失败和正常停止后重开。上表列出的其他平台有公开安装包，但本次截图不是 Windows / Linux 验收，也不是实体手机联网测试。','智能体支持与 Host 安装包可用性分别判断，尤其 Linux 智能体仍保留各自的预览 / 验收状态。依赖具体智能体前，先阅读兼容性说明。']),
    L('Source builds are a separate workflow','源码构建另见开发流程',[
      ext('https://github.com/murray17/rovai-ai/blob/main/docs/development/server-preview.md','Build and validate Server from source','从源码构建与验收 Server')])
  ]);

  topics['lan-access']=T('Connect over a trusted LAN','局域网访问',
    'Use a phone or another computer on the same trusted network. Keep this HTTP entrance off the public Internet.',
    '在同一可信网络中使用手机或另一台电脑。这个 HTTP 入口不向公网开放。',[
    D('Use the host’s network address','使用主机的网络地址','deployment-lan',
      'The phone and host share a trusted LAN. The browser opens the host IP, with 8766 for Desktop Web or 8767 for Server. Loopback addresses stay on each individual device.',
      '手机与主机处于同一可信局域网。浏览器输入主机 IP；Desktop Web 默认 8766，Server 默认 8767。回环地址只指向各自设备。'),
    S('Find the right IP on the host','在主机查找正确 IP',
      ['Connect both devices to the same trusted network. A similar Wi-Fi name is not enough if one device is on a guest network or an isolated VLAN.', 'On macOS, open System Settings → Network, choose the active connection and read its TCP/IP address. On Windows, run ipconfig and find the active adapter’s IPv4 address. On Linux, run ip -br -4 addr.', 'Choose the address of the interface reachable from the other device, for example 192.168.1.50. Ignore loopback, disconnected adapters and addresses belonging to unrelated VPNs.', 'For repeated use, reserve the host’s DHCP address in your router or check it again after a network change.'],
      ['两台设备接入同一可信网络。Wi-Fi 名称相似并不够：其中一台可能在访客网络或隔离 VLAN。','macOS 打开“系统设置 → 网络”，选择正在使用的连接，在 TCP/IP 中查看地址。Windows 运行 ipconfig，查看有效网卡的 IPv4 地址。Linux 运行 ip -br -4 addr。','选另一台设备能够到达的网卡地址，例如 192.168.1.50；忽略回环、断开连接及无关 VPN 的地址。','经常使用时可在路由器保留主机 DHCP 地址；更换网络后重新确认。']),
    F('Choose the listening scope','选择监听范围',[
      ['Desktop Web','Desktop Web','Enable Remote connection. In Desktop 0.4.1 the service listens on network interfaces at the selected port (default 8766). Restrict who can reach it through the host firewall.','在远程连接中开启。Desktop 0.4.1 在所选端口监听网络接口（默认 8766），通过主机防火墙限制可达来源。'],
      ['Independent Server','独立 Server','Stop the previous foreground instance, then start it with a LAN listen address and --allow-insecure-lan. A specific interface address limits the listener; 0.0.0.0 covers all IPv4 interfaces.','先停止原前台实例，再使用局域网监听地址及 --allow-insecure-lan 启动。指定网卡 IP 可缩小监听范围；0.0.0.0 则覆盖全部 IPv4 网卡。']]),
    C('Server · bind one LAN interface','Server · 监听一张局域网网卡',
`rovai-server --data-dir "$HOME/.rovai-server" \\
  --listen 192.168.1.50:8767 --allow-insecure-lan`),
    P('Use the executable for your installation','使用对应安装的程序入口',
      ['Replace the IP with your host’s actual address. On macOS 0.4.0, replace rovai-server with "$HOME/.local/share/rovai-server/current/rovai-server" as described in the installation guide. On Windows PowerShell, place the arguments on one line instead of using the shell continuation character above.', 'The flag acknowledges unencrypted HTTP on a trusted network; it does not turn off login. Do not forward this port from your Internet router or permit it from every public address.'],
      ['把 IP 替换为真实主机地址。macOS 0.4.0 按安装页把 rovai-server 替换为 "$HOME/.local/share/rovai-server/current/rovai-server"。Windows PowerShell 请把参数放在同一行，不使用上方 shell 续行符。','该参数确认在可信网络使用未加密 HTTP，不会关闭登录认证。不要把此端口通过路由器映射到公网，也不要允许全部公网来源访问。']),
    S('Allow only the required local traffic','只放行所需局域网流量',
      ['If the host firewall blocks the listener, add an inbound rule for the selected TCP port and your trusted local subnet. Keep the firewall enabled.', 'On macOS, review the firewall’s application permission for Rovai Desktop or the Server executable. On Windows, limit an inbound rule to the Private profile and the local subnet; do not change an untrusted network to Private just to connect.', 'On Ubuntu using UFW, the example below allows a /24 LAN to port 8767. Substitute your real subnet and use port 8766 only for Desktop. It adds a rule; it does not enable or disable UFW.', 'Open http://192.168.1.50:8767/ for Server, or http://192.168.1.50:8766/ for Desktop, on the other device. Enter that instance’s Token and open the intended conversation.'],
      ['若主机防火墙阻止连接，为所选 TCP 端口和可信局域网网段增加入站规则，保持防火墙开启。','macOS 检查 Rovai Desktop 或 Server 程序的防火墙应用许可。Windows 将入站规则限定为专用网络和本地子网，不要为连接方便把不可信网络改成专用。','Ubuntu 使用 UFW 时，下方示例允许一个 /24 局域网访问 8767。替换真实网段；Desktop 才使用 8766。命令仅添加规则，不会启停 UFW。','在另一台设备打开 Server 的 http://192.168.1.50:8767/，或 Desktop 的 http://192.168.1.50:8766/。输入对应实例 Token，进入目标会话。']),
    C('Ubuntu UFW · example scoped rule','Ubuntu UFW · 限定来源的示例规则',
`sudo ufw allow from 192.168.1.0/24 to any port 8767 proto tcp
sudo ufw status`),
    F('When the address does not open','地址打不开时逐项检查',[
      ['Wrong network','网络不一致','Disable neither authentication nor the firewall. Check Wi-Fi, guest isolation, corporate VLAN rules and VPN routing first.','不需要关闭认证或防火墙。先检查 Wi-Fi、访客隔离、公司 VLAN 规则和 VPN 路由。'],
      ['Loopback-only listener','只监听回环','127.0.0.1 is reachable only on the host. Restart Server with the intended interface; changing the URL in your browser does not change the listener.','127.0.0.1 只能从主机访问。用目标网卡重新启动 Server；只改浏览器 URL 不会改变监听范围。'],
      ['Address or port changed','地址或端口变化','Read the current host IP and service port again. A remembered browser address can be stale.','重新查看主机 IP 与服务端口；浏览器记住的旧地址可能已失效。'],
      ['Host asleep / App stopped','主机休眠 / App 停止','Wake the host, start the intended instance and confirm its status. The browser cannot wake or launch it by itself.','唤醒主机，启动目标实例，确认运行状态。浏览器不会自行唤醒或启动主机。'],
      ['Page opens, login fails','页面打开但不能登录','Use this instance’s Token and the same address as the page. See the login guide for origin and session errors.','使用本实例 Token，并保持页面地址一致；来源和会话错误见登录维护页。']])
  ]);

  topics.tailscale=T('Private access with Tailscale','Tailscale 私有远程访问',
    'Connect your own devices across networks. Use Serve HTTPS for Server, or a direct tailnet address for Desktop 0.4.1.',
    '跨网络连接自己的设备。Server 使用 Serve HTTPS；Desktop 0.4.1 使用私网网卡地址直连。',[
    P('Three responsibilities','三个组件分别做什么',
      ['Tailscale connects authorized devices in your private network. Serve adds an HTTPS entrance inside that network and forwards requests to a service on the host. Rovai still owns the workspace and requires its own login.', 'Serve is private to the tailnet under its access rules. Funnel is a different public publishing feature; this tutorial never enables it. These are external tools, not Rovai settings.'],
      ['Tailscale 把获准设备连接到私有网络；Serve 在私网内提供 HTTPS 入口，并把请求转发给主机服务；Rovai 保存工作台，仍要求自己的登录。','Serve 受私网访问规则约束。Funnel 是另一项公网发布能力，本教程不启用它。它们属于外部工具，不是 Rovai 内置设置。']),
    D('Server behind private HTTPS','Server 的私网 HTTPS 路径','deployment-tailscale',
      'An authorized device reaches the host’s ts.net HTTPS name over Tailscale. Serve forwards to Server on 127.0.0.1:8767; the external HTTPS origin is configured on Server.',
      '获准设备通过 Tailscale 访问主机 ts.net HTTPS 名称。Serve 转发至 127.0.0.1:8767，Server 配置同一个外部 HTTPS 来源。'),
    S('Join both devices to the private network','两端加入同一私网',
      ['Install Tailscale on the Rovai host and on the phone or other computer. Sign in to the intended tailnet and connect both devices.', 'On the host, run tailscale status or inspect the app’s device list. Confirm the second device belongs to the expected network and is permitted to reach this host by the tailnet’s access policy.', 'Use a non-sensitive machine name. For Serve HTTPS, enable the required MagicDNS/HTTPS settings through Tailscale’s setup flow; certificate names can be visible in public certificate transparency records.', 'Keep the Tailscale client connected on the visiting device. A private ts.net address will not become a public website merely because it uses HTTPS.'],
      ['在 Rovai 主机和手机 / 另一台电脑上安装 Tailscale，登录预期的私网并连接两端。','主机运行 tailscale status，或在应用中查看设备列表。确认另一设备属于正确网络，且私网访问策略允许其到达这台主机。','主机命名避免包含敏感信息。Serve HTTPS 按 Tailscale 设置流程启用所需 MagicDNS / HTTPS；证书名称可能出现在公开证书透明度记录中。','访问设备保持 Tailscale 已连接。私有 ts.net 地址使用 HTTPS，并不意味着它是公网网站。']),
    L('Tailscale setup references','Tailscale 设置参考',[
      ext('https://tailscale.com/download','Install Tailscale on both devices','在两端安装 Tailscale'),
      ext('https://tailscale.com/docs/how-to/set-up-https-certificates','MagicDNS, HTTPS and certificate names','MagicDNS、HTTPS 与证书名称')]),
    S('Server · prepare the HTTPS entrance','Server · 准备 HTTPS 入口',
      ['On the host, inspect tailscale serve status first. Use an available HTTPS port; do not replace an existing unrelated Serve/Funnel configuration.', 'Create the Serve mapping below. On a platform where the CLI already has the required rights, omit sudo. Follow any setup link Tailscale prints to enable HTTPS.', 'Read the exact https://…ts.net address from tailscale serve status. The sample orbit-host.example-tailnet.ts.net below is a placeholder.', 'Stop any foreground Rovai Server using this data directory. Start it on loopback with --public-origin set to that exact HTTPS origin (scheme, host and any non-default port; no path or query).'],
      ['先在主机运行 tailscale serve status。选择空闲 HTTPS 端口，不覆盖无关 Serve / Funnel 配置。','创建下方 Serve 转发。CLI 已具备所需权限的平台可省略 sudo。若打印启用 HTTPS 的设置链接，按 Tailscale 流程完成。','从 tailscale serve status 读取真实 https://…ts.net 地址；下方 orbit-host.example-tailnet.ts.net 是占位值。','先停止使用该数据目录的原前台 Server，再以回环地址启动，将 --public-origin 设置为真实 HTTPS 来源（协议、主机及非默认端口，不带路径或查询参数）。']),
    C('On the host · configure Serve','在主机配置 Serve',
`tailscale serve status
sudo tailscale serve --bg --https=443 http://127.0.0.1:8767
tailscale serve status`),
    C('On the host · start Server','在主机启动 Server',
`rovai-server --data-dir "$HOME/.rovai-server" \\
  --listen 127.0.0.1:8767 \\
  --public-origin https://orbit-host.example-tailnet.ts.net`),
    P('Match the origin and executable','来源与程序入口必须对应',
      ['On macOS 0.4.0 use the full current/rovai-server executable from the installation guide. In PowerShell put Server arguments on one line. No --allow-insecure-lan flag is needed for this loopback backend.', 'On the visiting device, connect Tailscale, open the exact HTTPS address, then enter this Server’s Token. Check the Orbit project and last conversation. Serve provides transport; it does not replace Rovai authentication.', 'A page may load while login or live updates fail if the external origin does not match. Correct --public-origin and restart the same instance; do not disable authentication or add arbitrary origins.'],
      ['macOS 0.4.0 使用安装页所示 current/rovai-server 完整路径；PowerShell 把 Server 参数放在同一行。回环后端无需 --allow-insecure-lan。','访问设备先连接 Tailscale，打开准确 HTTPS 地址，再填写本 Server Token。检查 Orbit 项目和上次会话。Serve 提供传输入口，不代替 Rovai 认证。','外部来源不匹配时可能页面能打开，但登录或实时更新失败。修正 --public-origin，再重启同一实例；不要关闭认证或添加任意来源。']),
    S('Desktop 0.4.1 · use the tailnet IP','Desktop 0.4.1 · 使用私网 IP',
      ['Keep Tailscale connected on both devices. On the desktop host, find its Tailscale IPv4 address (typically 100.x.y.z) in Tailscale, then enable Desktop Web access.', 'Open http://100.x.y.z:8766/ from the connected device, using the actual address and selected port. The host interface must be available and the tailnet policy and host firewall must allow it.', 'Log in with the Desktop Token. The browser uses HTTP; traffic between the devices travels through the encrypted Tailscale connection. This does not add a browser TLS padlock.', 'Do not apply the Server --public-origin command to Desktop. Desktop 0.4.1 has no settings field for the Serve HTTPS domain. Choose independent Server if that HTTPS entrance is required.'],
      ['两端保持连接 Tailscale。在桌面主机的 Tailscale 中查到私网 IPv4 地址（通常为 100.x.y.z），再开启 Desktop Web。','另一设备打开 http://100.x.y.z:8766/，替换真实地址及所选端口。主机需有该网卡地址，私网策略与主机防火墙均允许连接。','使用 Desktop Token 登录。浏览器采用 HTTP，设备间流量通过加密 Tailscale 连接传输；这不会在浏览器增加 TLS 小锁。','不要把 Server 的 --public-origin 命令用于 Desktop。Desktop 0.4.1 没有 Serve HTTPS 域名设置；需要这种 HTTPS 入口时，选择独立 Server。']),
    P('Keep it running, then close it deliberately','保持运行与关闭入口',
      ['Serve --bg retains its mapping across Tailscale restarts, but it does not start Rovai. Keep the host awake and configure Server’s own background startup if required. A sleeping laptop is still unavailable.', 'To remove only the HTTPS 443 mapping created in this example, use the matching off command below. Review status afterwards. Do not reset unrelated Serve mappings. Desktop direct access closes when you disable its Web service or revoke the relevant network access.'],
      ['Serve --bg 会保留转发配置，但不会启动 Rovai。主机需要保持唤醒；有需要时另行配置 Server 后台启动。休眠的笔记本仍不可访问。','仅移除本例创建的 HTTPS 443 映射时，使用下方对应 off 命令，再检查状态；不要重置无关映射。Desktop 直连可通过关闭其 Web 服务或撤销相应网络访问来结束。']),
    C('Remove this Serve mapping','关闭本例 Serve 映射',
`sudo tailscale serve --bg --https=443 off
tailscale serve status`),
    L('Serve reference','Serve 命令参考',[
      ext('https://tailscale.com/docs/reference/tailscale-cli/serve','Official Serve command reference','Tailscale Serve 官方命令说明')])
  ]);

  topics['public-https']=T('Public HTTPS with a reverse proxy','公网 HTTPS 与反向代理',
    'Give standalone Server one HTTPS domain using Caddy on a Linux host. Keep the backend on loopback and retain owner login.',
    '在 Linux 主机用 Caddy 为独立 Server 提供一个 HTTPS 域名；后端保持回环监听，保留 Owner 登录。',[
    P('The example deployment','本例部署条件',
      ['This recipe uses Server 0.4.0 and Caddy on Ubuntu/Debian, on the same reachable host. It assumes you control the host, its firewall and a domain. It is a configuration example; the documentation capture did not publish a live public service.', 'Replace agent.example.com and 203.0.113.10 with your own service domain and host IP. They are reserved examples. Do not reuse the Rovai website’s domain or change its DNS to follow this tutorial.', 'Desktop 0.4.1 lacks a public-origin field in its settings. Use the Server installation for this recipe. Use the root of a dedicated hostname; serving Rovai under /rovai/ is not this configuration.'],
      ['本例在同一台可达 Ubuntu / Debian 主机上运行 Server 0.4.0 与 Caddy，要求你拥有主机、防火墙及一个域名的管理权。这是配置示例；本次文档采集没有对外发布真实公网服务。','把 agent.example.com 和 203.0.113.10 替换为自己的服务域名和主机 IP，它们是保留示例值。不要借用 Rovai 官网域名，也不要修改官网 DNS 来跟随本教程。','Desktop 0.4.1 设置没有公共来源字段，本配方使用独立 Server。使用独立主机名的根路径，不是部署在 /rovai/ 子路径。']),
    D('Public address versus backend address','公网地址与后端地址','deployment-https',
      'The browser reaches agent.example.com over HTTPS 443. Caddy terminates TLS and forwards locally over HTTP to 127.0.0.1:8767. The backend is never an Internet-facing port.',
      '浏览器通过 HTTPS 443 连接 agent.example.com。Caddy 终止 TLS，再通过本机 HTTP 转发到 127.0.0.1:8767；后端端口不向互联网开放。'),
    S('Prepare DNS and network access','准备域名解析与网络入口',
      ['Create an A record for your service hostname pointing to the reachable host IPv4 address. Add AAAA only if IPv6 actually reaches the same proxy; an incorrect AAAA can break access and certificate validation.', 'Permit inbound TCP 80 and 443 to Caddy in the provider firewall and host firewall. Port 80 supports HTTP redirection and certificate issuance. If the host sits behind NAT, it needs a valid reachable ingress; CGNAT may prevent direct hosting.', 'Keep TCP 8767 closed to the public Internet. The proxy and Server in this example share a machine, so the backend can remain at 127.0.0.1.', 'Ensure no other application is already using 80/443. On a host with existing sites, add only this site’s configuration and preserve the other sites.'],
      ['为服务主机名添加 A 记录，指向可达主机 IPv4。只有 IPv6 确实到达同一代理时才加 AAAA；错误 AAAA 会导致访问或证书验证失败。','在云平台与主机防火墙允许 TCP 80、443 到达 Caddy。80 用于 HTTP 跳转及证书签发。主机位于 NAT 后时需要真实可达入口；运营商级 NAT 可能无法直接托管。','不向公网开放 TCP 8767。本例代理与 Server 同机，后端可保持 127.0.0.1。','确认 80 / 443 未被其他程序占用。已有网站的主机只添加本服务配置，保留其他站点。']),
    C('Install Caddy · Ubuntu / Debian','安装 Caddy · Ubuntu / Debian',
`sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy`),
    P('Use the official package procedure','使用官方软件包流程',
      ['These commands follow Caddy’s Debian/Ubuntu package instructions. Review them before applying them to your host; the package creates a systemd service. If Caddy is already installed, use its existing installation and configuration.'],
      ['这些命令采用 Caddy 的 Debian / Ubuntu 官方包安装方式。应用前先检查主机环境；软件包会建立 systemd 服务。已经安装 Caddy 时，沿用现有安装与配置。']),
    L('Caddy installation reference','Caddy 安装参考',[
      ext('https://caddyserver.com/docs/install#debian-ubuntu-raspbian','Official Debian / Ubuntu installation','Debian / Ubuntu 官方安装文档')]),
    C('Start the private backend','启动仅本机可达的后端',
`rovai-server --data-dir "$HOME/.rovai-server" \\
  --listen 127.0.0.1:8767 \\
  --public-origin https://agent.example.com`),
    P('Set the same external origin','配置相同的外部来源',
      ['Stop the old Server process before starting with new flags. Preserve the original --data-dir. --public-origin must match what the browser opens, including https and any non-default port. It does not change the listening socket or obtain a certificate.', 'Run Server as the ordinary account that owns its Agent environment. Caddy runs separately. For a persistent Server process, adapt the service template in Sign-in and maintenance and add this --public-origin argument.'],
      ['修改参数前先停止旧 Server，保留原 --data-dir。--public-origin 必须匹配浏览器打开的地址，包括 https 及非默认端口；它不会改变监听 socket，也不会签发证书。','Server 由拥有智能体环境的普通账号运行，Caddy 单独运行。需要后台常驻时，使用登录维护页的服务模板，并加入本 --public-origin 参数。']),
    C('Add this site to /etc/caddy/Caddyfile','在 /etc/caddy/Caddyfile 添加本服务',
`agent.example.com {
    reverse_proxy 127.0.0.1:8767 {
        flush_interval -1
    }
}`),
    P('Preserve authentication and live responses','保留认证与实时响应',
      ['Use HTTP to the loopback backend and HTTPS at the public entrance. This configuration leaves the original Host, Origin and Authorization headers intact and disables response buffering for prompt live delivery. Do not cache authenticated API responses.', 'Do not rewrite Host to 127.0.0.1, remove Origin/Authorization, disable Rovai login or route only the HTML page. Proxy the whole root so APIs and live event responses use the same origin. Caddy obtains and renews the public certificate when DNS and reachability requirements are met.'],
      ['回环后端使用 HTTP，公网入口使用 HTTPS。本配置保留原 Host、Origin 和 Authorization 请求头，关闭响应缓冲以便及时转发实时内容；不要缓存已认证 API 响应。','不要把 Host 改写为 127.0.0.1，不要移除 Origin / Authorization、关闭 Rovai 登录或只代理 HTML。代理整个根路径，使 API 与实时事件保持同源。DNS 与网络条件满足后，Caddy 获取并续期公网证书。']),
    C('Validate and reload','检查并重新加载配置',
`sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager`),
    S('Log in from another network','从外部网络登录',
      ['Open https://agent.example.com/ in a normal browser after the certificate is ready. If the browser reports a certificate error, fix DNS, certificate issuance or the hostname; do not bypass its warning.', 'Enter the Token from the Server data directory. Open a conversation and inspect its latest execution. Send a small request only after confirming the host and project.', 'If the HTML opens but login/live updates fail, check the matching public origin and proxy headers. For 502 responses, confirm Server is running on the configured loopback port.', 'Read Caddy’s service log with journalctl -u caddy and Server’s own logs/server.log. Keep tokens and request details out of shared diagnostics.'],
      ['证书就绪后，在普通浏览器打开 https://agent.example.com/。若浏览器报证书错误，修复解析、签发或主机名，不要跳过警告。','填写 Server 数据目录对应的 Token，进入会话查看最近执行。确认主机与项目后再发小范围请求。','HTML 能打开但登录 / 实时更新失败时，检查公共来源和代理请求头；出现 502 时，确认 Server 正在指定回环端口运行。','用 journalctl -u caddy 查看代理日志，同时查看 Server 的 logs/server.log。分享诊断时不要包含 Token 与私密请求内容。']),
    S('Close the public entrance','关闭公网入口',
      ['Remove only the agent.example.com site block you added. Validate and reload Caddy; leave unrelated sites running.', 'Remove the corresponding service DNS record and any dedicated firewall/NAT rule you created when no longer needed. DNS deletion alone may be delayed by caches; remove the proxy route first.', 'Stop Server as well if the host should stop processing work. Removing the proxy entrance by itself does not stop an already accepted Run.'],
      ['只移除新增的 agent.example.com 配置块，检查并重新加载 Caddy，保留无关站点运行。','不再需要时，删除本服务 DNS 及专门添加的防火墙 / NAT 规则。单独删 DNS 会受缓存影响，应先移除代理入口。','若希望主机也停止处理工作，再正常停止 Server。移除代理入口本身不会停止已接收的执行。']),
    L('Configuration and references','示例配置与参考',[
      {file:'examples/deployment/Caddyfile',label:['Download the example Caddyfile','下载 Caddyfile 示例']},
      ext('https://caddyserver.com/docs/caddyfile/directives/reverse_proxy','Caddy reverse_proxy and streaming','Caddy 反向代理与流式响应'),
      ext('https://caddyserver.com/docs/automatic-https','Caddy automatic HTTPS','Caddy 自动 HTTPS')])
  ]);

  topics['server-maintenance']=T('Sign-in and maintenance','登录与日常维护',
    'Find the right credential, keep the host running, and preserve the workspace when restarting or updating.',
    '找到对应凭据，保持主机运行，并在重启或更新时保留工作台。',[
    F('Token, browser session and instance','Token、浏览器会话与实例',[
      ['Login Token','登录 Token','The instance’s owner credential. Enter it only in that instance’s login form. A Desktop Token comes from Remote connection; a Server Token comes from its terminal or token command with the same data directory.','实例的 Owner 凭据，只填写在对应实例的登录页。Desktop 从远程连接获取；Server 从启动终端或相同数据目录的 token 命令获取。'],
      ['Browser session','浏览器会话','Login creates a browser session for this origin. Another browser, changed origin or an expired session can require login again. Browser credentials are separate from Agent authentication.','登录后建立对应来源的浏览器会话。换浏览器、换来源或会话过期时可能需要重新登录；它与智能体认证无关。'],
      ['Server restart','Server 重启','Server 0.4.0 persists authentication state in its data directory. Reuse that root; a different root means a different instance and credential. A session can still expire.','Server 0.4.0 把认证状态保存在数据目录。继续使用原根目录；换目录意味着另一个实例和凭据。浏览器会话仍可能到期。'],
      ['Desktop restart','Desktop 重启','Desktop Web must be enabled again after the App restarts. Get the current Token from the running Desktop rather than assuming an older saved credential remains valid.','App 重启后需要重新开启 Desktop Web。从正在运行的 Desktop 获取当前 Token，不要假定以前保存的凭据仍有效。'],
      ['Scope','权限范围','This release is a single-owner instance. Do not share the Token as if it were a limited project invitation. HTTPS or Tailscale protects the route, not separate user roles.','当前发布版是单 Owner 实例，不要把 Token 当成某个项目的受限邀请。HTTPS 或 Tailscale 保护连接，不提供独立用户角色。']]),
    C('Read paths and Token · same data directory','查看路径与 Token · 使用同一数据目录',
`rovai-server --data-dir "$HOME/.rovai-server" paths
rovai-server --data-dir "$HOME/.rovai-server" token`),
    P('Keep credentials private','私下保管凭据',
      ['On macOS 0.4.0 use the full current/rovai-server path described in Install Server. The paths command reports locations; token prints a secret. Do not paste that output into an issue, a screenshot or a shared terminal recording.', 'There is no documented rotate-token command in Server 0.4.0. If a credential is exposed, close the reachable entrance first and seek recovery guidance for that release. Do not delete the database or invent a token flag.'],
      ['macOS 0.4.0 使用安装页的 current/rovai-server 完整路径。paths 显示位置，token 输出秘密凭据；不要把输出贴入 Issue、截图或共享终端录屏。','Server 0.4.0 没有公开的 rotate-token 命令。凭据泄露时先关闭可达入口，再按该版本寻求恢复指导；不要删除数据库或尝试虚构参数。']),
    P('Browser connection is not task state','浏览器连接状态不等于任务状态',
      ['A closed tab, lost Wi-Fi connection or proxy restart can disconnect the view while an accepted request continues on the host. Reconnect to the same instance and conversation, then inspect the Run, pending approvals and Files before repeating a request.', 'Stopping Server, quitting Desktop, host shutdown or sleep is different: it affects the execution host. Previously written files are not rolled back by stopping a process. After restart, read the recorded outcome and current files; send only the remaining work.'],
      ['关闭标签页、Wi-Fi 断开或代理重启可能只中断画面，已接收请求仍在主机上继续。重新连接同一实例、同一会话，查看执行、待审批事项和文件，再决定是否重复请求。','停止 Server、退出 Desktop、关机或休眠会影响执行主机。停止进程不会回滚已经写入的文件。重启后结合记录结果与当前文件，只发尚未完成的工作。']),
    S('Foreground operation','前台运行与再次启动',
      ['Keep the terminal that runs Server open. Closing it can stop the process; closing the browser does not have the same effect.', 'To stop deliberately, finish or stop active work in Rovai, press Ctrl-C in the Server terminal and wait for process exit.', 'Restart with the same executable version, account, data root and network flags. If you changed --public-origin, open its matching browser address.', 'Do not start a second process against the same data root. A lock refusal means an instance still owns it; find that process rather than deleting the lock file.'],
      ['保持运行 Server 的终端打开。关闭终端可能结束进程；关闭浏览器没有同样作用。','需要停机时，先在 Rovai 完成或停止正在处理的工作，再在 Server 终端按 Ctrl-C 并等待退出。','使用相同版本程序、账号、数据根目录和网络参数重开。修改 --public-origin 后，应打开对应浏览器地址。','不要让第二个进程使用同一数据根目录。锁拒绝表示另一个实例仍持有目录，应查找进程，不要删除锁文件。']),
    P('Background startup is configured by the OS','后台启动由系统管理器配置',
      ['The installer creates no system service. Choose one process owner and one startup mechanism. A service manager’s environment is not your interactive shell: set a PATH that includes the Agent executable and preserve its home/authentication environment.', 'The following Linux example assumes a normal account named rovai, a default installation under /home/rovai, and a data root /home/rovai/.rovai-server. Create or choose the account deliberately and install/sign in as it first. Replace all paths consistently.', 'Restart=no avoids repeatedly relaunching a process whose startup failed. systemctl enable starts it at boot; it does not turn an interrupted request into a completed one. Keep the host’s network and Agent dependencies available.'],
      ['安装器不建立系统服务。确定一个进程归属账号和一种启动方式。服务管理器环境不是交互 shell，应显式设置包含智能体程序的 PATH，并保留它的主目录与认证环境。','以下 Linux 示例假设普通账号叫 rovai，默认程序位于 /home/rovai，数据根目录为 /home/rovai/.rovai-server。先选择或创建该账号，并以它安装和登录；所有路径要一致替换。','Restart=no 避免启动失败后反复拉起进程；systemctl enable 设置开机启动，不代表中断请求会自动完成。主机网络与智能体依赖仍需可用。']),
    C('Linux · /etc/systemd/system/rovai-server.service','Linux · /etc/systemd/system/rovai-server.service',
`[Unit]
Description=Rovai Server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=rovai
WorkingDirectory=/home/rovai
Environment=HOME=/home/rovai
Environment=PATH=/home/rovai/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/rovai/.local/share/rovai-server/current/rovai-server --data-dir /home/rovai/.rovai-server --listen 127.0.0.1:8767
KillMode=control-group
TimeoutStopSec=90
Restart=no

[Install]
WantedBy=multi-user.target`),
    P('Add the chosen connection flags','补上所选连接方式的参数',
      ['The template listens only on loopback. For Serve or Caddy, append the exact --public-origin https://… to ExecStart. For trusted LAN access, replace --listen and add --allow-insecure-lan as explained in that guide. Never launch a second foreground instance for the same root.', 'Save the unit only after replacing the example account and paths. The commands below check and start it, then enable boot startup. Logs remain in the data directory; journalctl also shows service-level failures.'],
      ['模板仅监听回环。Serve / Caddy 在 ExecStart 末尾添加准确的 --public-origin https://…；可信局域网按相应教程替换 --listen 并添加 --allow-insecure-lan。不要再以前台启动同数据目录的第二个实例。','替换示例账号和路径后保存 unit。下方命令检查、启动并设置开机启动；日志仍保存在数据目录，journalctl 还可查看服务层错误。']),
    C('Linux · start and inspect','Linux · 启动并检查',
`sudo systemd-analyze verify /etc/systemd/system/rovai-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now rovai-server
sudo systemctl status rovai-server --no-pager
sudo journalctl -u rovai-server -n 50 --no-pager`),
    C('Linux · stop and disable boot startup','Linux · 停止并取消开机启动',
`sudo systemctl stop rovai-server
sudo systemctl disable rovai-server`),
    S('macOS · start after account login','macOS · 账号登录后启动',
      ['Use a per-user LaunchAgent rather than assuming the installer installed a daemon. Download the example plist below and replace /Users/rovai everywhere with your account’s absolute home, including program, data, PATH and log paths.', 'Create the log directory before loading the plist. Save the customized file as ~/Library/LaunchAgents/dev.rovai.server.plist. Add --public-origin and its value as separate ProgramArguments entries if your connection requires them.', 'Stop the foreground instance first. Validate with plutil -lint, then load it with launchctl bootstrap gui/$(id -u) and the absolute plist path.', 'RunAtLoad starts this example after that user logs in, not before login. KeepAlive is false; it does not continuously restart failures. Stop/unload with launchctl bootout using the same domain and plist. Inspect the configured logs for launch errors.'],
      ['使用用户级 LaunchAgent，不要以为安装器已经建立守护进程。下载下方 plist，把所有 /Users/rovai 替换为自己的绝对主目录，包括程序、数据、PATH 与日志路径。','加载前创建日志目录，将修改后的文件保存为 ~/Library/LaunchAgents/dev.rovai.server.plist。需要公共来源时，在 ProgramArguments 中把 --public-origin 和值分别添加为两个条目。','先停止前台实例。用 plutil -lint 检查，再通过 launchctl bootstrap gui/$(id -u) 和 plist 绝对路径加载。','本例 RunAtLoad 在该用户登录后启动，不是登录前启动；KeepAlive 为 false，不会持续重试失败进程。使用同一 domain 和 plist 的 launchctl bootout 停止并卸载，启动错误查看已配置日志。']),
    C('macOS · load the customized agent','macOS · 加载修改后的配置',
`mkdir -p "$HOME/.rovai-server/logs"
plutil -lint "$HOME/Library/LaunchAgents/dev.rovai.server.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.rovai.server.plist"`),
    C('macOS · stop and unload','macOS · 停止并卸载',
`launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.rovai.server.plist"`),
    S('Windows · a login startup task','Windows · 登录后启动任务',
      ['Task Scheduler is an optional OS setup, not a Rovai installer feature. Create a task for the same ordinary account that installed and signed in to the Agent. Start with “Run only when user is logged on”; do not enable highest privileges by default.', 'Use an “At log on” trigger. Set Program to the absolute …\\Programs\\RovaiServer\\current\\rovai-server.exe path. Set arguments to --data-dir "C:\\Users\\rovai\\.rovai-server" --listen 127.0.0.1:8767, replacing the account and adding the connection-specific flags.', 'Set Start in to that account’s home. Disable an arbitrary time limit for a continuously running task, choose “Do not start a new instance” for overlap, and review power conditions so the host does not silently stop the process on battery.', 'Run the task once and check its result and Server log. This setup begins after login; it is not a pre-login Windows service. To shut down cleanly, finish active work and use the running console’s Ctrl-C when available. Task Scheduler End may force termination; avoid treating it as a graceful stop or killing all same-name processes. Disable the task before maintenance and verify the specific process has exited before updating.'],
      ['任务计划程序是可选系统配置，不是 Rovai 安装器功能。用安装并登录智能体的同一个普通账号创建任务，先选择“仅当用户登录时运行”，不要默认勾选最高权限。','触发器选择“登录时”。程序填写绝对 …\\Programs\\RovaiServer\\current\\rovai-server.exe 路径；参数使用 --data-dir "C:\\Users\\rovai\\.rovai-server" --listen 127.0.0.1:8767，替换账号并增加连接所需参数。','“起始于”填写该账号主目录。常驻任务不要设置任意运行时限；重叠选择“不启动新实例”，并检查电源条件，避免电池供电时悄悄停止进程。','先运行一次，检查任务结果和 Server 日志。此方式在登录后启动，不是登录前 Windows 服务。需要正常停止时先完成工作，有运行控制台时使用 Ctrl-C；任务计划程序“结束”可能强制终止，不能当作正常退出，也不要批量杀掉同名程序。维护前禁用任务，确认具体进程已退出再更新。']),
    L('Editable startup examples','可编辑的启动配置示例',[
      {file:'examples/deployment/rovai-server.service',label:['Linux systemd unit','Linux systemd 配置']},
      {file:'examples/deployment/dev.rovai.server.plist',label:['macOS LaunchAgent','macOS LaunchAgent 配置']}
    ]),
    F('Logs and update procedure','日志与更新步骤',[
      ['Server log','Server 日志','<data-dir>/logs/server.log. --verbose adds diagnostic output to the terminal. Service manager logs explain launch/account/path failures; the Rovai log explains host behavior.','<data-dir>/logs/server.log。--verbose 增加终端诊断输出。服务管理器日志排查启动、账号、路径问题，Rovai 日志排查 Host 行为。'],
      ['Before updating','更新前','Read the Server release notes, finish or stop active work, stop the exact Server process and its startup manager, then back up the data root and project files. Record version and launch flags.','先读 Server 发布说明，完成或停止当前工作，停止对应进程及启动管理器，备份数据根目录与项目文件，记录版本和启动参数。'],
      ['Install the next version','安装新版本','Run that release’s installer with its explicit version. Preserve the existing data directory. On Windows, the installer does not stop the running executable for you. There is no rovai-server upgrade command in 0.4.0.','用目标 Release 安装器及明确版本重新安装，保留原数据目录。Windows 安装器不会替你停止正在运行的程序。0.4.0 没有 rovai-server upgrade 命令。'],
      ['After updating','更新后','Restart the same instance and confirm version, login, teammate configuration, project path and an existing conversation. Desktop’s update mechanism does not update a separately installed Server.','重启同一实例，确认版本、登录、队员配置、项目路径及原会话。Desktop 的升级机制不会更新独立安装的 Server。']]),
    P('Save and back up the right files','保存与备份哪些内容',
      ['Program revisions are not a backup of workspace data. Stop the instance and copy its whole data directory, including its database, authentication state, managed skills and configuration. Protect the backup like a credential; it can contain private conversations and usable authentication material.', 'Back up project directories separately, including uncommitted files. Agent sign-in/configuration may live outside Rovai’s root, and source attachments can refer to external paths. A database-only copy does not preserve all of these.', 'For a rollback, retain a stopped pre-update data snapshot and the corresponding package. Restoring files in place at the same absolute data root is the conservative recovery path; do not promise that an older binary accepts a migrated database. Copying a data root to a different path or host is not a documented automatic migration.', 'Check a recovery plan on an isolated copy before relying on it. Do not run two hosts against one live data root or delete instance lock/identity files to bypass a refusal.'],
      ['程序 revisions 不是工作台数据备份。停止实例后复制整个数据目录，包括数据库、认证状态、受管 Skills 与配置。备份可能包含私密会话和可用认证材料，应按凭据保护。','项目目录另行备份，包括未提交文件。智能体登录 / 配置可能在 Rovai 根目录外，来源附件也可能引用外部路径。只复制数据库不会保存这些内容。','需要回退时保留升级前停机快照及匹配安装包。较保守的恢复方式是在相同绝对数据根目录原位还原；不要假定旧程序能读取已迁移数据库。把数据根目录复制到新路径或另一主机，不属于已说明的自动迁移。','依赖备份前先在隔离环境检查恢复方案。不要让两个 Host 使用同一实时数据目录，也不要删除实例锁 / 身份文件绕过拒绝。']),
    F('Troubleshoot by symptom','按现象排查',[
      ['Address will not open','地址打不开','Check host awake → process running → listener/IP/port → LAN or tailnet routing → scoped firewall. For HTTPS, also check DNS, certificate and proxy status.','依次检查主机唤醒、进程运行、监听 IP / 端口、局域网或私网路由、防火墙。HTTPS 再查 DNS、证书与代理。'],
      ['Page opens, login fails','页面可打开但登录失败','Use the same instance’s Token. Check the exact external origin and proxy headers; a token from a different data root cannot authenticate this one.','使用同一实例 Token，核对外部来源和代理请求头。另一个数据根目录的 Token 无法登录当前实例。'],
      ['Agent unavailable after login','登录后智能体不可用','Check the process account, service PATH, Agent installation, native sign-in and model access on the host. Installing an Agent on the phone will not help the host.','检查主机进程账号、服务 PATH、智能体安装、原生登录与模型权限。把智能体装在手机上不能解决主机问题。'],
      ['Service stops with terminal','关闭终端后服务停止','You ran it in the foreground. Configure one OS startup method above; keep the same data root and inspect its logs.','当前是前台运行。按上文配置一种系统启动方式，使用原数据根目录并检查日志。'],
      ['Browser dropped during a request','请求途中浏览器掉线','Reopen the same conversation and inspect the existing Run before resending. A disconnected view does not tell you whether execution finished.','重新进入原会话查看原执行，再决定是否重发。画面断线不能说明执行是否完成。'],
      ['Bundled Skill resources unavailable','提示 bundled Skill resources are unavailable','Observed before Agent launch in the published macOS arm64 0.4.0 package. Its required bundled resources are missing. Keep the data, avoid repeated execution, and use Desktop Web or wait for a corrected package; see Install Server.','已在公开 macOS arm64 0.4.0 包的智能体启动前复现，包缺少所需内置资源。保留数据，不要反复重试；使用 Desktop Web 或等待修正版，详见安装页。'],
      ['Matching WebUI is missing','提示 Matching WebUI is missing','Keep the full package together. On macOS 0.4.0 launch current/rovai-server directly, as shown in Install Server.','保留完整发布包。macOS 0.4.0 按安装页直接启动 current/rovai-server。'],
      ['Symlink or root-lock refusal','符号链接或根目录锁拒绝','Use a real absolute data directory; on macOS /tmp is a symlink, so use its canonical /private/tmp path for a disposable fixture. A root lock means another live process may own the instance.','使用真实绝对数据路径。macOS /tmp 是符号链接，临时夹具应使用其规范 /private/tmp 路径。根目录锁表示可能有另一个运行进程持有实例。']])
  ]);

  for(const [id,ids] of Object.entries({
    remote:['desktop-web','server-install'],
    'desktop-web':['lan-access','tailscale','server-maintenance'],
    'server-install':['lan-access','tailscale','public-https','server-maintenance'],
    'lan-access':['desktop-web','server-install','server-maintenance'],
    tailscale:['server-install','server-maintenance'],
    'public-https':['server-install','server-maintenance'],
    'server-maintenance':['execution','recovery','remote']
  }))topics[id].sections.push(related(ids));
  topics.quickstart.sections.unshift(P('Choose the workspace first','先选择在哪份工作台开始',
    ['For work on this computer, open Desktop. To use an existing Desktop remotely, enable its Web service. For a separate host you keep running, install Server and prepare the Agent and project on that host. Then follow the same first-task steps below. Remote access does not copy Desktop data.'],
    ['在当前电脑工作就打开 Desktop；远程继续已有桌面工作，开启它的 Web 服务；使用独立主机时安装 Server，并在主机准备智能体和项目，再执行下方首次任务步骤。远程访问不会复制 Desktop 数据。']));
  topics.quickstart.sections.push(related(['remote','server-install']));
  topics.installation.sections.push(related(['server-install','remote']));
  topics.compatibility.sections.push(P('Server packages and Agent qualification','Server 包与智能体验收分别判断',
    ['Server 0.4.0 has public packages for macOS arm64/x64, Windows x64 and Linux x64 GNU. The Server installation guide lists prerequisites. A package being available does not certify every Agent or model on that OS; Linux Agent support retains its per-adapter preview/qualification boundary.'],
    ['Server 0.4.0 已有 macOS arm64 / x64、Windows x64、Linux x64 GNU 公开包，依赖见 Server 安装页。安装包可用不等于该系统所有智能体或模型均已验收；Linux 智能体仍按具体适配项保留预览 / 资格边界。']),related(['server-install']));
})();
