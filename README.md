# KShell

[English](./README.en.md) | 简体中文

跨平台 SSH 桌面客户端,参考 FinalShell 产品形态,UI 自主设计。

> **Vibe Coding 项目** — 本项目从第一行代码到最终功能实现,全程由 AI 驱动开发。开发者通过自然语言描述需求与设计意图,AI 生成全部代码,开发者负责架构决策、审查与引导。没有一行代码是手动敲出来的。
>
> 状态:M1 / M1.5 / M2 / M3 / M4 / M5 / M6 + SSH 密钥库 已代码完成,等待真机联调。

## 功能一览

| 功能 | 说明 |
|------|------|
| SSH 终端 | 密码 / 私钥 / SSH agent / keyboard-interactive 认证,多标签,PTY resize,上下分栏 |
| 主机校验 | known_hosts 指纹校验,首次连接确认,mismatch 拒绝 |
| 会话管理 | 分组树形管理,SQLite 持久化,凭据 AES-256-GCM 加密,会话级操作栏 + 右键菜单 |
| SFTP | 双栏文件管理,拖拽 / 复制 / 剪切,目录递归传输,进度队列 |
| 服务器监控 | CPU / 内存 / 网络 / 磁盘 / 负载实时图表(ECharts) |
| Docker 面板 | 容器 / 镜像 / 卷 / 网络 / Compose stack 管理,日志流,容器新建 / 编辑 / 重建 / 克隆,Docker 安装,系统清理 |
| 端口隧道 | 本地转发 + 远程转发,会话级管理 |
| SSH 密钥库 | 生成 / 导入 / 管理密钥对,部署公钥到远端 |
| 命令面板 | Ctrl+K 快速搜索并执行命令 |
| 主题系统 | OKLCH 色彩,7 种主题色,明亮 / 暗黑 / 跟随系统,字号可调 |

## 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| M1 | SSH 终端(密码/私钥认证)+ 多标签 + PTY resize | ✅ 代码完成 |
| M1.5 | known_hosts 指纹校验 + 首次连接确认 + mismatch 拒绝 | ✅ 代码完成 |
| M2 | 会话持久化(SQLite)+ 凭据加密(AES-256-GCM,KEK 存 OS keychain) | ✅ 代码完成 |
| M3 | SFTP 双栏文件管理 + 传输队列 + 拖拽/复制/剪切 | ✅ 代码完成 |
| M4 | 服务器监控面板(CPU/内存/网络/磁盘/负载,ECharts) | ✅ 代码完成 |
| M5 | Docker 面板(容器/镜像/卷/网络/Compose stack + 日志/详情/新建/编辑/重建/系统清理) | ✅ 代码完成 |
| M6 | 端口隧道 / 转发(本地转发 + 远程转发) | ✅ 代码完成 |
| — | SSH 密钥库(生成/导入/管理/部署公钥) | ✅ 代码完成 |

## 技术栈

**前端**
- Vue 3.5 + TypeScript 6 + Vite 8
- Tailwind CSS 4(`@tailwindcss/vite` 插件,OKLCH 主题,`--primary-hue` 参数化主题色)
- shadcn-vue(new-york 风格,基于 reka-ui):alert / badge / card / collapsible / context-menu / dialog / dropdown-menu / input / label / progress / scroll-area / select / separator / sheet / sidebar / skeleton / slider / status-dot / switch / table / tabs / textarea / toggle / toggle-group / tooltip 等组件
- xterm.js 6 + fit / web-links 插件
- ECharts 6(监控图表,动态加载避免进主 chunk)
- @lucide/vue 图标
- @vueuse/core(快捷键 / 响应式工具)
- @tanstack/vue-table(Docker 列表虚拟化备用)
- highlight.js(Docker 日志高亮备用)
- uuid(标签页 id 生成)
- 偏好持久化:SQLite(`settings` KV 表 + `quick_commands` 表)

**后端**
- Tauri 2(Rust)
- russh 0.62(纯 Rust SSH 客户端,ring 后端)
- russh-sftp 2.3(SFTP 协议)
- ssh-key 0.7(密钥对生成与序列化)
- tokio + DashMap(会话/通道状态)
- rusqlite 0.40(会话/分组/密钥库/偏好/快捷指令持久化,bundled)
- aes-gcm 0.10 + keyring 3(凭据 & passphrase AES-256-GCM 加密,KEK 存 OS keychain)
- tauri-plugin-dialog / tauri-plugin-shell

**目标平台**:Windows / macOS / Linux

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` / `Ctrl+T` | 新建连接 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+K` | 命令面板 |
| `Ctrl+PgDn` / `Ctrl+PgUp` | 切换标签 |
| `Ctrl+Shift+C` | 终端复制选中文本 |
| `Ctrl+Shift+V` | 粘贴到终端 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | SFTP 复制 / 剪切 / 粘贴文件 |
| `Ctrl+滚轮` | 终端字号独立缩放(8–32px) |
| 右键 | 会话/分组操作菜单(连接终端/SFTP/Docker、编辑/删除) |

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
│   │   ├── docker.ts             #   Docker CLI 封装 + 归一化
│   │   ├── tunnel.ts             #   端口隧道/转发
│   │   └── settings.ts           #   偏好/快捷指令 SQLite CRUD
│   ├── components/
│   │   ├── ui/                   # shadcn-vue 基础组件
│   │   ├── layout/               # TitleBar / ActivityBar / SessionSidebar / WorkArea / StatusBar
│   │   ├── sidebar/              # 侧栏业务面板(SessionsPanel / KeysPanel)
│   │   ├── dialogs/              # 全局弹窗(新建连接/偏好/关于/快捷键/确认/提示/toast/监控/密钥库/命令面板)
│   │   ├── terminal/             # xterm 集成 + 上下分栏(TerminalSplit)
│   │   ├── sftp/                 # SFTP 双栏(SftpView / FilePane / TransferPanel)
│   │   ├── monitor/              # 监控侧栏精简卡(MonitorSummary)
│   │   ├── docker/               # Docker 面板(容器/镜像/卷/网络/Compose + 日志/详情/新建/编辑/克隆/安装/系统清理)
│   │   └── tunnels/              # 端口隧道面板(TunnelPanel)
│   ├── stores/                   # 响应式全局状态
│   │   ├── tabs.ts               #   标签页 + 按 storedSession 关闭相关 tab
│   │   ├── tab-views.ts          #   tab 类型 → 视图组件注册表
│   │   ├── sessions.ts           #   会话/分组
│   │   ├── session-actions.ts    #   会话级动作注册表(连接终端/SFTP/Docker)
│   │   ├── keys.ts               #   SSH 密钥库
│   │   ├── monitor.ts            #   监控轮询(跟随活跃终端)
│   │   ├── docker.ts             #   Docker 数据轮询(容器/镜像/卷/网络/stack + stats)
│   │   ├── sidebar-panels.ts     #   侧栏面板注册表 + 宽度拖拽
│   │   ├── status-actions.ts     #   状态栏动作注册表
│   │   ├── command-palette.ts    #   命令面板开关
│   │   ├── overlays.ts           #   浮层组件注册表
│   │   ├── dialogs.ts            #   弹窗触发
│   │   ├── transfers.ts          #   传输队列
│   │   ├── host-key.ts           #   主机公钥确认
│   │   ├── ki-prompt.ts          #   keyboard-interactive 认证响应
│   │   ├── prompt.ts             #   交互式输入
│   │   ├── toast.ts              #   toast 通知
│   │   ├── ui.ts                 #   侧边栏/状态栏可见性 + 清屏
│   │   └── preferences.ts        #   主题/字号偏好(SQLite 持久化)
│   ├── styles/global.css         # Tailwind 4 + OKLCH 主题变量(字号/尺寸/主题色/sidebar 语义色)
│   ├── lib/utils.ts              # cn() 等工具
│   ├── lib/migrate-localStorage.ts # 一次性 localStorage → SQLite 迁移
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
│   │   │   ├── channel.rs        # PTY / shell / exec 通道
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
│   │       ├── mod.rs            # SQLite 门面(groups/sessions/ssh_keys/settings/quick_commands CRUD + 迁移)
│   │       └── model.rs          # 数据结构(Group/Session/SshKey/AuthKind/QuickCommand)
│   ├── tauri.conf.json
│   └── Cargo.toml
├── pnpm-workspace.yaml           # pnpm 11 allowBuilds
├── vite.config.ts
├── tsconfig.json
├── components.json               # shadcn-vue 配置
├── CLAUDE.md                     # 项目规范(供 AI 协作参考)
├── LICENSE
├── README.md
└── README.en.md
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

**代码检查**

```powershell
pnpm vue-tsc -b --force    # 前端类型检查
cargo check                # 后端编译检查
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
- **passphrase 加密**:机器绑定 AES-256-GCM 加密后存 `.pass` 文件
- **新建连接集成**:私钥认证时可从密钥库下拉选择,自动填充路径和 passphrase

## 端口隧道(M6)

- **本地转发**:监听本机端口,经 SSH 隧道转发到远端目标
- **远程转发**:远端服务器监听端口,连接经 SSH 隧道转发到本机目标
- 侧栏「隧道」tab 管理面板,支持添加 / 删除 / 状态实时更新
- 会话断开时隧道自动关闭

## Docker 面板(M5)

- 通过 `ssh_exec` 在远端调用 docker CLI,前端 `api/docker.ts` 按 `--format '{{json .}}'` 归一化为 camelCase
- `stores/docker.ts` 每 5 秒轮询容器/镜像/卷/网络/stack,stats 独立采集避免阻塞主列表
- 五个子面板(容器 / 镜像 / 卷 / 网络 / Compose stack)以子 tab 切换,计数 Badge 实时更新
- **容器**:启停 / 重启 / 删除 / 进入终端(docker exec -it sh)/ 日志流(跟随 / 过滤 / 时间戳 / 文件定位)/ 详情 / 重建(pull + stop + rm + run 原配置)/ 编辑(改名 / 内存 / CPU / 重启策略)/ 克隆(可选拉取最新镜像 / 停止原容器)
- **镜像**:删除 / 拉取 / 更新 / 详情(配置 + 构建层历史)
- **卷 / 网络**:删除 / 清理未使用 / 原始 JSON 详情
- **Compose stack**:up / down / restart / deploy,按 stack 名分组管理
- **新建容器向导**:`DockerRunDialog` 支持端口映射 / 卷绑定 / 环境变量 / 资源限制 / 网络 / 重启策略;克隆模式复用同一向导
- **Docker 安装**:远端未安装 docker 时显示「安装 Docker」入口,调用 get.docker.com 官方脚本(支持 Aliyun / Azure 镜像源)
- **系统清理**:`docker system df` 汇总 + 一键 prune(含 / 不含卷)

## 偏好与主题

- `stores/preferences.ts` 管理主题模式(明亮 / 暗黑 / 跟随系统)、主题色(7 种,通过 `--primary-hue` 参数化)、界面字体大小(10–18px)
- 字号通过 `--font-size-ui` 基准 + 语义化字号/尺寸变量级联缩放,全局 UI 高度同步适配
- 终端 xterm 字号接入偏好设置,并支持 Ctrl+滚轮 独立缩放当前终端(8–32px)
- 偏好持久化于 SQLite(`settings` KV 表),首次启动自动从 localStorage 一次性迁移
- 快捷指令(`quick_commands` 表)含 5 条内置预设,支持增删改,通过终端悬浮按钮一键发送

## UI 设计

- 基于 shadcn-vue(new-york 风格)+ reka-ui,深色为主,紧凑面板密度参考 JetBrains / Termius
- 全部颜色引用 OKLCH CSS 变量(`--panel`/`--titlebar`/`--sidebar`/`--success`/`--warning`),不写死 hex
- 间距遵循 Tailwind 默认 4px 网格,界面文本默认 12px,终端等宽 13–14px
- 会话/分组操作改为右键 ContextMenu,侧栏基于 shadcn Sidebar 体系

## 已知限制

- Docker 面板依赖远端 docker CLI,需当前用户具有 docker 组权限;未安装时面板提供一键安装入口(get.docker.com 脚本),安装后需手动刷新
- Docker 子面板(容器/镜像/卷/网络/stack)各表头/行高在极端字体缩放下可能略有错位

## License

MIT
