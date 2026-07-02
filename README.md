# KShell

[English](./README.en.md) | 简体中文

自研的跨平台 Shell 桌面客户端,产品原型参考 FinalShell,UI 自主设计。

> 状态:M1 / M1.5 / M2 / M3 / M4 / M6 + SSH 密钥库 已代码完成,等待真机联调。

## 功能规划

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 | SSH 终端(密码/私钥认证)+ 多标签 + PTY resize | ✅ 代码完成 |
| M1.5 | known_hosts 指纹校验 + 首次连接确认 + mismatch 拒绝 | ✅ 代码完成 |
| M2 | 会话持久化(SQLite)+ 凭据加密(机器绑定 AES-256-GCM) | ✅ 代码完成 |
| M3 | SFTP 双栏文件管理 + 传输队列 + 拖拽/复制/剪切 | ✅ 代码完成 |
| M4 | 服务器监控面板(CPU/内存/网络/磁盘/负载,ECharts) | ✅ 代码完成 |
| M5 | Docker 面板(容器/镜像/网络) | ⏳ 规划中(插件化) |
| M6 | 端口隧道 / 转发(本地转发 + 远程转发) | ✅ 代码完成 |
| — | SSH 密钥库(生成/导入/管理/部署公钥) | ✅ 代码完成 |

## 技术栈

**前端**
- Vue 3.5 + TypeScript + Vite 6
- Tailwind CSS 4(`@tailwindcss/vite` 插件,OKLCH 主题,`--primary-hue` 参数化主题色)
- shadcn-vue(new-york 风格,基于 reka-ui):alert / badge / card / collapsible / context-menu / dialog / dropdown-menu / progress / select / sidebar / slider / table / tabs / textarea / toggle-group / tooltip 等组件
- xterm.js 5.5 + fit / web-links 插件
- ECharts 5(监控图表,动态加载避免进主 chunk)
- lucide-vue-next 图标
- 偏好持久化:localStorage(`kshell-preferences`)

**后端**
- Tauri 2(Rust)
- russh 0.61(纯 Rust SSH 客户端,ring 后端)
- russh-sftp 2.3(SFTP 协议)
- ssh-key 0.7(密钥对生成与序列化)
- tokio + DashMap(会话/通道状态)
- rusqlite 0.32(会话/分组/密钥库持久化,bundled)
- aes-gcm 0.10(凭据 & passphrase 加密,机器绑定随机 key 文件 + AES-256-GCM)
- tauri-plugin-dialog / tauri-plugin-shell

**目标平台**:Windows / macOS / Linux

## 项目结构

```
KShell/
├── src/                          # 前端(Vue)
│   ├── api/                      # Tauri invoke 封装
│   │   ├── ssh.ts                #   SSH 连接/通道/exec
│   │   ├── sftp.ts               #   SFTP 文件操作
│   │   ├── sessions.ts           #   会话分组 CRUD
│   │   ├── keys.ts               #   SSH 密钥库
│   │   ├── monitor.ts            #   监控采集脚本 + 解析
│   │   └── tunnel.ts             #   端口隧道/转发
│   ├── components/
│   │   ├── ui/                   # shadcn-vue 基础组件
│   │   ├── layout/               # TitleBar / SessionSidebar / WorkArea / StatusBar
│   │   ├── dialogs/              # 全局弹窗(新建连接/偏好/关于/快捷键/确认/提示/toast/监控/密钥库)
│   │   ├── terminal/             # xterm 集成 + 上下分栏(TerminalSplit)
│   │   ├── sftp/                 # SFTP 双栏(SftpView / FilePane / TransferPanel)
│   │   ├── monitor/              # 监控侧栏精简卡(MonitorSummary)
│   │   └── tunnels/              # 端口隧道面板
│   ├── stores/                   # 响应式全局状态
│   │   ├── tabs.ts               #   标签页
│   │   ├── sessions.ts           #   会话/分组
│   │   ├── keys.ts               #   SSH 密钥库
│   │   ├── monitor.ts            #   监控轮询(跟随活跃终端)
│   │   ├── dialogs.ts            #   弹窗触发
│   │   ├── transfers.ts          #   传输队列
│   │   ├── host-key.ts           #   主机公钥确认
│   │   ├── prompt.ts             #   交互式输入
│   │   ├── toast.ts              #   toast 通知
│   │   ├── ui.ts                 #   侧边栏/状态栏可见性 + 清屏
│   │   └── preferences.ts        #   主题/字号偏好(localStorage 持久化)
│   ├── styles/global.css         # Tailwind 4 + OKLCH 主题变量(字号/尺寸/主题色/sidebar 语义色)
│   ├── lib/utils.ts              # cn() 等工具
│   ├── App.vue
│   └── main.ts
├── src-tauri/                    # 后端(Rust)
│   ├── src/
│   │   ├── lib.rs                # Tauri Builder 入口
│   │   ├── commands.rs           # #[tauri::command] 定义(参数校验 + 分发)
│   │   ├── state.rs              # AppState(sessions / channels / store / known_hosts)
│   │   ├── crypto.rs             # 机器绑定 AES-256-GCM(key.bin 加密/解密)
│   │   ├── ssh/
│   │   │   ├── client.rs         # russh 连接 + 认证 + known_hosts 校验
│   │   │   ├── channel.rs        # PTY / shell 通道
│   │   │   ├── tunnel.rs         # 本地/远程端口转发
│   │   │   └── known_hosts.rs    # 主机公钥信任库(JSON)
│   │   ├── sftp/
│   │   │   ├── session.rs        # SFTP 会话与文件操作
│   │   │   └── commands.rs       # SFTP 命令(列表/传输/删除/重命名等)
│   │   ├── keys/
│   │   │   ├── gen.rs            # 密钥对生成(ED25519/RSA/ECDSA)+ 序列化
│   │   │   ├── deploy.rs         # 公钥部署到远端 authorized_keys
│   │   │   ├── commands.rs       # 密钥库 Tauri 命令
│   │   │   └── mod.rs            # 模块入口
│   │   └── store/
│   │       ├── mod.rs            # SQLite 门面(groups/sessions/ssh_keys CRUD + 迁移)
│   │       └── model.rs          # 数据结构(Group/Session/SshKey/AuthKind)
│   ├── tauri.conf.json
│   └── Cargo.toml
├── pnpm-workspace.yaml           # pnpm 11 allowBuilds
├── vite.config.ts
├── tsconfig.json
├── components.json               # shadcn-vue 配置
├── CLAUDE.md                     # 项目规范(供 AI 协作参考)
└── README.md
```

## 开发

**先决条件**
- Node.js ≥ 20 + pnpm 11
- Rust 稳定版(rustup)
- Windows:MSVC 构建工具、WebView2

**安装依赖**

```powershell
pnpm install
```

**开发调试**

```powershell
pnpm tauri:dev
```

首次运行会编译 russh 及依赖,约需 3–5 分钟。之后热更新即可。

**构建产物**

```powershell
pnpm tauri:build
```

## SSH 通信架构

```
┌──────────────────────┐    invoke     ┌──────────────────────┐
│ Vue (xterm.js)       │ ────────────► │ Tauri commands       │
│                      │               │                      │
│ ssh_connect          │               │ russh::client        │
│ ssh_open_shell       │               │ Handle<ClientHandler>│
│ ssh_write / resize   │               │                      │
│ ssh_exec             │               │                      │
│                      │◄──────────── │ event: ssh://{id}/…   │
│ onChannelData/Exit   │               │  (data / exit)        │
└──────────────────────┘               └──────────────────────┘
```

- 会话池 `DashMap<SessionId, Arc<Mutex<SshSession>>>`
- 通道池 `DashMap<ChannelId, ChannelHandle>`,后台 tokio 任务通过 mpsc unbounded 通道驱动
- PTY 数据流由后端 `emit("ssh://{ch}/data")` 推送至前端,`ssh_write` 反向传入
- `ssh_exec` 一次性执行命令(request_exec),供监控采集与密钥部署复用
- 端口转发:`tunnel_add`(本地)/`tunnel_add_remote`(远程)在已建立的 SSH 会话上开启 forwarded tcp 通道

## SFTP 通信架构

- 同一 SSH 会话上复用 russh 通道打开 SFTP 子系统(`russh-sftp` 协议层)
- 前端 `SftpView` 左右分栏(本地 / 远端),拖拽、复制、剪切、目录递归传输
- 传输队列 `stores/transfers.ts` 统一管理,`TransferPanel` 浮动展示进度,支持取消

## 服务器监控(M4)

- 复用 `ssh_exec` 在远端执行采集脚本,读取 `/proc/stat`、`/proc/meminfo`、`/proc/loadavg`、`/proc/net/dev`、`df` 输出
- 前端 `api/monitor.ts` 按 `===KSM_xxx===` 标记分段解析,差分计算 CPU 使用率与网络速率
- `stores/monitor.ts` 每 2 秒轮询,跟随活跃终端 tab 自动启停
- `MonitorDialog` 用 ECharts 绘制 CPU / 内存 / 网络 / 负载实时折线图,磁盘用表格展示
- `MonitorSummary` 侧栏底部精简卡,`StatusBar` 快捷入口

## SSH 密钥库

- **生成密钥对**:支持 ED25519 / RSA(2048/3072/4096)/ ECDSA(P256/P384/P521),序列化为 OpenSSH PEM 存储到 `app_data_dir/keys/`
- **导入密钥**:从外部私钥文件导入,自动提取算法 / 指纹 / 公钥
- **密钥库管理**:`KeyManagerDialog` 弹窗管理列表,支持重命名 / 删除 / 右键菜单
- **查看公钥**:展示 OpenSSH 格式公钥与 SHA256 指纹,一键复制
- **部署公钥**:通过已有 SSH 会话把公钥追加到远端 `~/.ssh/authorized_keys`(带去重)
- ** passphrase 加密**:机器绑定 AES-256-GCM 加密后存 `.pass` 文件
- **新建连接集成**:私钥认证时可从密钥库下拉选择,自动填充路径和 passphrase

## 偏好与主题

- `stores/preferences.ts` 管理主题模式(明亮 / 暗黑 / 跟随系统)、主题色(7 种,通过 `--primary-hue` 参数化)、界面字体大小(10–18px)
- 字号通过 `--font-size-ui` 基准 + 语义化字号/尺寸变量级联缩放,全局 UI 高度同步适配
- 终端 xterm 字号接入偏好设置,并支持 Ctrl+滚轮 独立缩放当前终端(8–32px)
- 偏好持久化于 localStorage(`kshell-preferences`)

## 已知限制

- 未实现 SSH agent、keyboard-interactive、代理跳板
- 凭据加密采用机器绑定 AES-256-GCM(`key.bin` 随机密钥),无主密码;key 文件丢失将导致凭据无法解密
- known_hosts 为应用自管 JSON,不与系统 ~/.ssh/known_hosts 互通
- SFTP 取消传输为后端桩,目录复制/剪切的远端递归删除边界仍有少量遗留
- M5 Docker 面板规划以插件化形式实现,后端复用 `ssh_exec` 调用 docker CLI

## License

MIT
