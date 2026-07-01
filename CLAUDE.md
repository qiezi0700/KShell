# KShell 项目规范

本文件面向与本项目协作的 AI(Claude Code 等)以及贡献者,规定 **代码注释语言**、**代码规范** 和 **项目规范** 三部分。所有 PR、AI 生成代码、文档修改都必须遵守。

---

## 1. 注释语言:一律使用中文

- **所有代码注释必须使用简体中文**,包括:
  - Vue 单文件组件的 `<script>`、`<template>`、`<style>` 注释
  - TypeScript / JavaScript 行内和块注释、JSDoc
  - Rust 行内注释、`///` 文档注释、模块级 `//!` 说明
  - JSON5 / TOML 配置文件中允许的注释
- **标识符(变量名、函数名、类型名、文件名)仍使用英文**,以保持与生态一致。
- **提交信息、PR 标题正文**使用中文;必要时可附英文关键词以便搜索。
- **面向用户的界面文案**(按钮、菜单、提示、错误消息)使用简体中文。
- **异常信息**若直接展示给用户,使用中文;若仅记录到日志,使用英文更精简也可。

**只有当 WHY 不显然时才写注释**——隐藏的约束、非直觉的取舍、绕过某个 bug 的说明、会让阅读者惊讶的行为。不要用注释重述代码"做了什么",标识符已经说清楚了。

**示例**

```ts
// 好:说明为什么
// russh 0.52 起 Handler trait 改用 impl Future,不能再用 async_trait 宏
fn check_server_key(...) -> impl Future<...> { ... }

// 坏:重述代码
// 检查服务器公钥
fn check_server_key(...) { ... }
```

```rust
// 好:标注不显然的边界条件
// PTY resize 必须在 shell 请求之后调用,否则对端会忽略首次尺寸
handle.window_change(cols, rows, 0, 0).await?;
```

---

## 2. 代码规范

### 2.1 TypeScript / Vue

- **严格模式**:`tsconfig` 保持 `strict: true`;不允许 `any` 逃逸(必要时用 `unknown` + 类型收窄)。
- **模块别名**:项目根 `@/*` 指向 `src/*`,禁止相对路径穿越 `../../`。
- **Vue 组件**:
  - 一律使用 `<script setup lang="ts">`;不写 Options API。
  - 组件文件名 PascalCase,与默认导出名一致。
  - Props 用 `defineProps<{...}>()` 类型语法;emit 用 `defineEmits<{ ... }>()`。
  - 模板样式一律 Tailwind class,不写 `<style>`,除非需要 `:deep()`。
- **状态管理**:轻量场景直接在 `src/stores/*.ts` 用 `ref` / `reactive` 导出;暂不引入 Pinia。
- **命名**:
  - 变量、函数 `camelCase`;类型、接口、枚举 `PascalCase`;常量 `SCREAMING_SNAKE_CASE`。
  - 布尔用 `isXxx / hasXxx / shouldXxx`。
  - Tauri 命令包装函数与后端命令名保持一致,并用 camelCase(如 `sshOpenShell`)。
- **导入顺序**:第三方包 → `@/` 内部模块 → 相对路径;每组之间空行分隔。
- **错误处理**:
  - 用户可见错误必须返回中文消息。
  - `invoke` 调用统一 `try/catch`,不要吞异常。
- **禁止**:
  - `console.log` 提交进主分支(临时调试可,合入前删除)。
  - 提交注释掉的代码。
  - 引入未使用的依赖。

### 2.2 UI / 样式

- **UI 组件库**:仅使用项目内 `src/components/ui/*`(shadcn-vue new-york 风格);新组件按 shadcn-vue CLI 生成或手写同风格。
- **图标**:仅使用 `lucide-vue-next`。
- **主题**:所有颜色引用 `src/styles/global.css` 中 `@theme inline` 定义的 OKLCH 变量(`--panel`、`--titlebar`、`--success` 等),不写死 hex。
- **间距**:遵循 Tailwind 默认 4px 网格;紧凑面板密度参考 JetBrains / Termius。
- **字号**:界面文本默认 12px,标题 14–16px,终端等宽字体 13–14px。

### 2.3 Rust

- **版本**:Rust stable,edition 2021。
- **格式**:提交前 `cargo fmt`;lint 使用 `cargo clippy -- -D warnings`(允许 CI 逐步收紧)。
- **命名**:模块、文件 `snake_case`;类型 `PascalCase`;常量 `SCREAMING_SNAKE_CASE`。
- **错误**:
  - 内部 `anyhow::Result`,跨命令边界返回 `Result<T, String>`(String 面向前端)。
  - 用 `.context("中文说明")` 补充调用点上下文。
- **异步**:全项目 tokio;IO 一律 `.await`,不使用阻塞 API。
- **状态共享**:通过 `tauri::State<AppState>` 注入;共享可变状态用 `Arc<Mutex<_>>` 或 `DashMap`。
- **Tauri 事件**:统一命名 `ssh://{channel_id}/{event}`(如 `data`、`exit`);新增子系统另起 scheme 前缀(`sftp://`、`docker://`)。
- **禁止**:
  - `unwrap()` / `expect()` 出现在业务路径(测试和 `main` 初始化除外)。
  - 未文档化的 `unsafe`。

### 2.4 依赖策略

- 前端引入新依赖前,先确认是否已有等价功能(Tailwind、reka-ui、vueuse、lucide)。
- Rust crate 优先纯 Rust 实现;涉及系统调用尽量走 `tauri-plugin-*`。
- 引入新依赖需在 PR 描述中说明用途与替代方案。

---

## 3. 项目规范

### 3.1 目录约定

- **前端**
  - `src/api/`:仅存放 Tauri `invoke` 封装与事件监听 helper。
  - `src/components/ui/`:shadcn-vue 基础组件,不含业务逻辑。
  - `src/components/layout/`:整体框架(TitleBar / Sidebar / WorkArea / StatusBar)。
  - `src/components/dialogs/`:全局弹窗,通过 `stores/dialogs.ts` 触发。
  - `src/components/<feature>/`:业务组件(如 `terminal/`、后续 `sftp/`、`monitor/`)。
  - `src/stores/`:响应式全局状态。
  - `src/lib/`:通用工具函数。
- **后端**
  - `src-tauri/src/commands.rs`:所有 `#[tauri::command]` 只做参数校验 + 分发,业务逻辑放到子模块。
  - `src-tauri/src/state.rs`:全局 `AppState` 与 ID 类型别名。
  - `src-tauri/src/ssh/`、后续 `sftp/`、`monitor/`、`docker/`:各子系统一目录一模块。

### 3.2 Git 工作流

- 分支命名:`feat/<模块>-<简述>`、`fix/<简述>`、`chore/<简述>`、`docs/<简述>`。
- 提交信息(Conventional Commits + 中文):
  ```
  feat(ssh): 支持私钥密码短语
  fix(terminal): resize 时首屏偏移一行
  ```
- 一次提交只做一件事;不允许把 `pnpm-lock.yaml` 与业务改动混在无关提交里。
- 合入主分支前必须:
  1. `pnpm vue-tsc -b` 通过
  2. `cargo check`(后期改为 `cargo clippy -- -D warnings`)通过
  3. Windows 上至少手动跑通 `pnpm tauri:dev`

### 3.3 里程碑与任务

- 里程碑对应 README 表格,粒度控制在 1–2 周内可完成。
- 新功能开工前,先在对应里程碑下拆任务(TaskCreate)并列出关键决策。
- 未落地的架构讨论、临时草稿不放进代码库;放到 issue 或 PR 描述。

### 3.4 安全底线

- **凭据**:密码、私钥密码、Token 严禁写死或落入 git 历史。M2 起统一走 Stronghold。
- **公钥校验**:M1.5 起必须校验 known_hosts,`check_server_key` 直接返 true 只允许存在于 M1 分支。
- **命令注入**:任何拼接远端命令的场景使用参数化 API,不做 shell 字符串拼接。
- **前后端边界**:所有从前端进入 Rust 的字符串默认视为不可信,长度、字符集需校验。

### 3.5 AI 协作规范

- AI 生成的代码同样受本文件全部约束。
- 修改现有文件优先用 `Edit` 而非整文件重写。
- 大规模重构、跨模块修改前,先给出方案让人确认,再动手。
- 不要主动创建 README、总结文档、方案文档等,除非本文件或用户明确要求。
- 与用户对话默认使用中文。
