# KShell

自研的跨平台 Shell 桌面客户端,产品原型参考 FinalShell,UI 自主设计。

> 状态:M1.5 + M2 已代码完成,等待真机联调。

## 功能规划

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 | SSH 终端(密码/私钥认证)+ 多标签 + PTY resize | ✅ 代码完成 |
| M1.5 | known_hosts 指纹校验 + 首次连接确认 + mismatch 拒绝 | ✅ 代码完成 |
| M2 | 会话持久化(SQLite)+ 凭据加密(Stronghold) | ✅ 代码完成 |
| M3 | SFTP 双栏文件管理 | ⏳ |
| M4 | 服务器监控面板(CPU/内存/网络,ECharts) | ⏳ |
| M5 | Docker 面板(容器/镜像/网络) | ⏳ |
| M6 | 端口隧道 / 转发 | ⏳ |

## 技术栈

**前端**
- Vue 3.5 + TypeScript + Vite 6
- Tailwind CSS 4(`@tailwindcss/vite` 插件,OKLCH 主题)
- shadcn-vue(new-york 风格,基于 reka-ui)
- xterm.js 5.5 + fit / web-links 插件
- lucide-vue-next 图标

**后端**
- Tauri 2(Rust)
- russh 0.52(纯 Rust SSH 客户端)
- tokio + DashMap(会话/通道状态)
- rusqlite 0.32(会话/分组持久化,bundled)
- tauri-plugin-stronghold(凭据加密,IOTA Stronghold + argon2)
- tauri-plugin-dialog / tauri-plugin-shell

**目标平台**:Windows / macOS / Linux

## 项目结构

```
KShell/
├── src/                          # 前端(Vue)
│   ├── api/                      # Tauri invoke 封装
│   │   └── ssh.ts
│   ├── components/
│   │   ├── ui/                   # shadcn-vue 基础组件
│   │   ├── layout/               # TitleBar / SessionSidebar / WorkArea / StatusBar
│   │   ├── dialogs/              # 弹窗(新建连接等)
│   │   └── terminal/             # xterm 集成
│   ├── stores/                   # 全局响应式状态(tabs / dialogs)
│   ├── styles/global.css         # Tailwind 4 + 主题变量
│   ├── lib/utils.ts              # cn() 等工具
│   ├── App.vue
│   └── main.ts
├── src-tauri/                    # 后端(Rust)
│   ├── src/
│   │   ├── lib.rs                # Tauri Builder 入口
│   │   ├── commands.rs           # #[tauri::command] 定义
│   │   ├── state.rs              # AppState(sessions / channels / store / known_hosts)
│   │   ├── ssh/
│   │   │   ├── mod.rs
│   │   │   ├── client.rs         # russh 连接 + 认证 + known_hosts 校验
│   │   │   ├── channel.rs        # PTY / shell 通道
│   │   │   └── known_hosts.rs    # 主机公钥信任库(JSON)
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

## 已知限制(M1.5 / M2)

- 未实现 SSH agent、keyboard-interactive、代理跳板
- 主密码(Stronghold)首次设置无二次确认,输错将导致凭据无法解密
- known_hosts 为应用自管 JSON,不与系统 ~/.ssh/known_hosts 互通

## License

MIT
