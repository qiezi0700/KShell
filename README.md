# KShell

自研的跨平台 Shell 桌面客户端,产品原型参考 FinalShell,UI 自主设计。

> 状态:M1 / M1.5 / M2 / M3 / M6 已代码完成,等待真机联调。

## 功能规划

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 | SSH 终端(密码/私钥认证)+ 多标签 + PTY resize | ✅ 代码完成 |
| M1.5 | known_hosts 指纹校验 + 首次连接确认 + mismatch 拒绝 | ✅ 代码完成 |
| M2 | 会话持久化(SQLite)+ 凭据加密(机器绑定 AES-256-GCM) | ✅ 代码完成 |
| M3 | SFTP 双栏文件管理 + 传输队列 + 拖拽/复制/剪切 | ✅ 代码完成 |
| M4 | 服务器监控面板(CPU/内存/网络,ECharts) | ⏳ |
| M5 | Docker 面板(容器/镜像/网络) | ⏳ |
| M6 | 端口隧道 / 转发(本地转发 + 远程转发) | ✅ 代码完成 |

## 技术栈

**前端**
- Vue 3.5 + TypeScript + Vite 6
- Tailwind CSS 4(`@tailwindcss/vite` 插件,OKLCH 主题,`--primary-hue` 参数化主题色)
- shadcn-vue(new-york 风格,基于 reka-ui)
- xterm.js 5.5 + fit / web-links 插件
- lucide-vue-next 图标
- 偏好持久化:localStorage(`kshell-preferences`)

**后端**
- Tauri 2(Rust)
- russh 0.61(纯 Rust SSH 客户端,ring 后端)
- russh-sftp 2.3(SFTP 协议)
- tokio + DashMap(会话/通道状态)
- rusqlite 0.32(会话/分组持久化,bundled)
- aes-gcm 0.10(凭据加密,机器绑定随机 key 文件 + AES-256-GCM)
- tauri-plugin-dialog / tauri-plugin-shell

**目标平台**:Windows / macOS / Linux

## 项目结构

```
KShell/
├── src/                          # 前端(Vue)
│   ├── api/                      # Tauri invoke 封装
│   │   ├── ssh.ts                #   SSH 连接/通道
│   │   ├── sftp.ts               #   SFTP 文件操作
│   │   ├── sessions.ts           #   会话分组 CRUD
│   │   └── tunnel.ts             #   端口隧道/转发
│   ├── components/
│   │   ├── ui/                   # shadcn-vue 基础组件
│   │   ├── layout/               # TitleBar / SessionSidebar / WorkArea / StatusBar
│   │   ├── dialogs/              # 全局弹窗(新建连接/偏好设置/关于/快捷键/确认/提示/toast)
│   │   ├── terminal/             # xterm 集成 + 上下分栏(TerminalSplit)
│   │   ├── sftp/                 # SFTP 双栏(SftpView / FilePane / TransferPanel)
│   │   └── tunnels/              # 端口隧道面板
│   ├── stores/                   # 响应式全局状态
│   │   ├── tabs.ts               #   标签页
│   │   ├── sessions.ts           #   会话/分组
│   │   ├── dialogs.ts            #   弹窗触发
│   │   ├── transfers.ts          #   传输队列
│   │   ├── host-key.ts           #   主机公钥确认
│   │   ├── prompt.ts             #   交互式输入
│   │   ├── toast.ts              #   toast 通知
│   │   ├── ui.ts                 #   侧边栏/状态栏可见性 + 清屏
│   │   └── preferences.ts        #   主题/字号偏好(localStorage 持久化)
│   ├── styles/global.css         # Tailwind 4 + OKLCH 主题变量(字号/尺寸/主题色)
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
│   │   └── store/
│   │       ├── mod.rs            # SQLite 门面(groups/sessions CRUD + 迁移)
│   │       └── model.rs          # 数据结构(Group/Session/AuthKind)
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
│                      │◄──────────── │ event: ssh://{id}/…   │
│ onChannelData/Exit   │               │  (data / exit)        │
└──────────────────────┘               └──────────────────────┘
```

- 会话池 `DashMap<SessionId, Arc<Mutex<SshSession>>>`
- 通道池 `DashMap<ChannelId, ChannelHandle>`,后台 tokio 任务通过 mpsc unbounded 通道驱动
- PTY 数据流由后端 `emit("ssh://{ch}/data")` 推送至前端,`ssh_write` 反向传入
- 端口转发:`tunnel_add`(本地)/`tunnel_add_remote`(远程)在已建立的 SSH 会话上开启 forwarded tcp 通道

## SFTP 通信架构

- 同一 SSH 会话上复用 russh 通道打开 SFTP 子系统(`russh-sftp` 协议层)
- 前端 `SftpView` 左右分栏(本地 / 远端),拖拽、复制、剪切、目录递归传输
- 传输队列 `stores/transfers.ts` 统一管理,`TransferPanel` 浮动展示进度,支持取消

## 偏好与主题

- `stores/preferences.ts` 管理主题模式(明亮 / 暗黑 / 跟随系统)、主题色(7 种,通过 `--primary-hue` 参数化)、界面字体大小(10–18px)
- 字号通过 `--font-size-ui` 基准 + 语义化字号/尺寸变量级联缩放,全局 UI 高度同步适配
- 终端 xterm 字号接入偏好设置,并支持 Ctrl+滚轮 独立缩放当前终端(8–32px)
- 偏好持久化于 localStorage(`kshell-preferences`)

## 已知限制(M1.5 / M2 / M3 / M6)

- 未实现 SSH agent、keyboard-interactive、代理跳板
- 凭据加密采用机器绑定 AES-256-GCM(`key.bin` 随机密钥),无主密码;key 文件丢失将导致凭据无法解密
- known_hosts 为应用自管 JSON,不与系统 ~/.ssh/known_hosts 互通
- SFTP 取消传输为后端桩,目录复制/剪切的远端递归删除边界仍有少量遗留
- 端口隧道面板未完成前端接线(`TunnelPanel.vue` 为占位)

## License

MIT
