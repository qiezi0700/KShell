# KShell

English | [简体中文](./README.md)

A cross-platform SSH desktop client, inspired by FinalShell, with original UI design.

> Status: M1 / M1.5 / M2 / M3 / M4 / M6 + SSH Key Manager — code complete, pending real-device testing.

## Roadmap

| Milestone | Description | Status |
|-----------|-------------|--------|
| M1 | SSH terminal (password/private key auth) + multi-tab + PTY resize | ✅ Code complete |
| M1.5 | known_hosts fingerprint verification + first-connect confirmation + mismatch rejection | ✅ Code complete |
| M2 | Session persistence (SQLite) + credential encryption (machine-bound AES-256-GCM) | ✅ Code complete |
| M3 | SFTP dual-pane file manager + transfer queue + drag/copy/cut | ✅ Code complete |
| M4 | Server monitoring dashboard (CPU/memory/network/disk/load, ECharts) | ✅ Code complete |
| M5 | Docker dashboard (containers/images/networks) | ⏳ Planned (plugin-based) |
| M6 | Port tunneling / forwarding (local + remote forward) | ✅ Code complete |
| — | SSH Key Manager (generate/import/manage/deploy public key) | ✅ Code complete |

## Tech Stack

**Frontend**
- Vue 3.5 + TypeScript + Vite 6
- Tailwind CSS 4 (`@tailwindcss/vite` plugin, OKLCH theme, `--primary-hue` parameterized theme color)
- shadcn-vue (new-york style, based on reka-ui): alert / badge / card / collapsible / context-menu / dialog / dropdown-menu / progress / select / sidebar / slider / table / tabs / textarea / toggle-group / tooltip and more
- xterm.js 5.5 + fit / web-links plugins
- ECharts 5 (monitoring charts, dynamically loaded to avoid main chunk bloat)
- lucide-vue-next icons
- Preferences persisted in localStorage (`kshell-preferences`)

**Backend**
- Tauri 2 (Rust)
- russh 0.61 (pure Rust SSH client, ring backend)
- russh-sftp 2.3 (SFTP protocol)
- ssh-key 0.7 (keypair generation and serialization)
- tokio + DashMap (session/channel state)
- rusqlite 0.32 (session/group/key persistence, bundled)
- aes-gcm 0.10 (credential & passphrase encryption, machine-bound random key file + AES-256-GCM)
- tauri-plugin-dialog / tauri-plugin-shell

**Target platforms**: Windows / macOS / Linux

## Project Structure

```
KShell/
├── src/                          # Frontend (Vue)
│   ├── api/                      # Tauri invoke wrappers
│   │   ├── ssh.ts                #   SSH connect/channel/exec
│   │   ├── sftp.ts               #   SFTP file operations
│   │   ├── sessions.ts           #   Session/group CRUD
│   │   ├── keys.ts               #   SSH key manager
│   │   ├── monitor.ts            #   Monitor collection script + parser
│   │   └── tunnel.ts             #   Port tunnel/forwarding
│   ├── components/
│   │   ├── ui/                   # shadcn-vue base components
│   │   ├── layout/               # TitleBar / SessionSidebar / WorkArea / StatusBar
│   │   ├── dialogs/              # Global dialogs (new connection / preferences / about / shortcuts / confirm / prompt / toast / monitor / key manager)
│   │   ├── terminal/             # xterm integration + split panes (TerminalSplit)
│   │   ├── sftp/                 # SFTP dual-pane (SftpView / FilePane / TransferPanel)
│   │   ├── monitor/              # Monitor sidebar summary card (MonitorSummary)
│   │   └── tunnels/              # Port tunnel panel
│   ├── stores/                   # Reactive global state
│   │   ├── tabs.ts               #   Tabs
│   │   ├── sessions.ts           #   Sessions/groups
│   │   ├── keys.ts               #   SSH key manager
│   │   ├── monitor.ts            #   Monitor polling (follows active terminal)
│   │   ├── dialogs.ts            #   Dialog triggers
│   │   ├── transfers.ts          #   Transfer queue
│   │   ├── host-key.ts           #   Host key confirmation
│   │   ├── prompt.ts             #   Interactive input
│   │   ├── toast.ts              #   Toast notifications
│   │   ├── ui.ts                 #   Sidebar/statusbar visibility + clear
│   │   └── preferences.ts        #   Theme/font preferences (localStorage)
│   ├── styles/global.css         # Tailwind 4 + OKLCH theme vars (font-size/dimensions/theme colors/sidebar semantic colors)
│   ├── lib/utils.ts              # cn() and utilities
│   ├── App.vue
│   └── main.ts
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── lib.rs                # Tauri Builder entry
│   │   ├── commands.rs           # #[tauri::command] definitions (validation + dispatch)
│   │   ├── state.rs              # AppState (sessions / channels / store / known_hosts)
│   │   ├── crypto.rs             # Machine-bound AES-256-GCM (key.bin encrypt/decrypt)
│   │   ├── ssh/
│   │   │   ├── client.rs         # russh connect + auth + known_hosts verification
│   │   │   ├── channel.rs        # PTY / shell channel
│   │   │   ├── tunnel.rs         # Local/remote port forwarding
│   │   │   └── known_hosts.rs    # Host public key trust store (JSON)
│   │   ├── sftp/
│   │   │   ├── session.rs        # SFTP session and file operations
│   │   │   └── commands.rs       # SFTP commands (list/transfer/delete/rename etc.)
│   │   ├── keys/
│   │   │   ├── gen.rs            # Keypair generation (ED25519/RSA/ECDSA) + serialization
│   │   │   ├── deploy.rs         # Public key deployment to remote authorized_keys
│   │   │   ├── commands.rs       # Key manager Tauri commands
│   │   │   └── mod.rs            # Module entry
│   │   └── store/
│   │       ├── mod.rs            # SQLite facade (groups/sessions/ssh_keys CRUD + migrations)
│   │       └── model.rs          # Data structures (Group/Session/SshKey/AuthKind)
│   ├── tauri.conf.json
│   └── Cargo.toml
├── pnpm-workspace.yaml           # pnpm 11 allowBuilds
├── vite.config.ts
├── tsconfig.json
├── components.json               # shadcn-vue config
├── CLAUDE.md                     # Project conventions (for AI collaboration)
└── README.md
```

## Development

**Prerequisites**
- Node.js ≥ 20 + pnpm 11
- Rust stable (rustup)
- Windows: MSVC build tools, WebView2

**Install dependencies**

```powershell
pnpm install
```

**Dev mode**

```powershell
pnpm tauri:dev
```

First run compiles russh and dependencies (~3–5 min). Hot reload after that.

**Build**

```powershell
pnpm tauri:build
```

## SSH Communication Architecture

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

- Session pool: `DashMap<SessionId, Arc<Mutex<SshSession>>>`
- Channel pool: `DashMap<ChannelId, ChannelHandle>`, driven by background tokio tasks via mpsc unbounded channels
- PTY data stream pushed from backend via `emit("ssh://{ch}/data")`, `ssh_write` sends input back
- `ssh_exec` runs one-off commands (request_exec), reused by monitor collection and key deployment
- Port forwarding: `tunnel_add` (local) / `tunnel_add_remote` (remote) opens forwarded tcp channels on an established SSH session

## SFTP Communication Architecture

- Reuses russh channel on the same SSH session to open SFTP subsystem (`russh-sftp` protocol layer)
- Frontend `SftpView` dual-pane (local / remote), with drag, copy, cut, and recursive directory transfer
- Transfer queue managed by `stores/transfers.ts`, `TransferPanel` shows floating progress, supports cancel

## Server Monitoring (M4)

- Reuses `ssh_exec` to run a collection script on the remote host, reading `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/net/dev`, `df` output
- Frontend `api/monitor.ts` parses output by `===KSM_xxx===` section markers, calculates CPU usage and network rate via diff
- `stores/monitor.ts` polls every 2 seconds, auto start/stop following the active terminal tab
- `MonitorDialog` renders CPU / memory / network / load real-time line charts with ECharts, disk usage in a table
- `MonitorSummary` sidebar compact card, `StatusBar` quick entry

## SSH Key Manager

- **Generate keypairs**: Supports ED25519 / RSA (2048/3072/4096) / ECDSA (P256/P384/P521), serialized as OpenSSH PEM to `app_data_dir/keys/`
- **Import keys**: Import from external private key files, auto-extracts algorithm / fingerprint / public key
- **Key management**: `KeyManagerDialog` manages key list with rename / delete / context menu
- **View public key**: Shows OpenSSH-format public key and SHA256 fingerprint, one-click copy
- **Deploy public key**: Appends public key to remote `~/.ssh/authorized_keys` via an existing SSH session (with dedup)
- **Passphrase encryption**: Machine-bound AES-256-GCM encryption, stored in `.pass` file
- **New connection integration**: Private key auth can select from key manager dropdown, auto-fills path and passphrase

## Preferences & Theme

- `stores/preferences.ts` manages theme mode (light / dark / system), theme color (7 presets via `--primary-hue`), UI font size (10–18px)
- Font size cascades via `--font-size-ui` base + semantic size/dimension variables, global UI height adapts accordingly
- Terminal xterm font size is tied to preferences, with Ctrl+scroll to independently zoom the current terminal (8–32px)
- Preferences persisted in localStorage (`kshell-preferences`)

## Known Limitations

- No SSH agent, keyboard-interactive, or jump host support
- Credential encryption uses machine-bound AES-256-GCM (`key.bin` random key), no master password; losing the key file makes credentials undecryptable
- known_hosts is app-managed JSON, not interoperable with system ~/.ssh/known_hosts
- SFTP cancel transfer is a backend stub; some edge cases in remote recursive directory delete remain
- Port tunnel panel frontend wiring incomplete (`TunnelPanel.vue` is a placeholder)
- M5 Docker dashboard is planned as a plugin, reusing `ssh_exec` to call docker CLI on the backend

## License

MIT
