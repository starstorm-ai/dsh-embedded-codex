---
description: "在 DeepSeek Harness 中使用官方 Codex App Server 的 Agent Runtime。"
kind: "package-bundle"
---

# dsh-embedded-codex

`dsh-embedded-codex` 是 DeepSeek Harness 的外部 Bundle。它增加 `Embedded Codex` Agent 预设，让 DSH Desktop（以及显式 Web 回归）使用官方 Codex App Server 和当前 OS 用户的 ChatGPT Codex 登录。

Codex 负责模型循环、原生工具、sandbox、审批、隐藏历史和 compaction；DSH 继续负责 Session、Web/API、对话轨迹、持久化和 token 展示。其他 DSH Agent 预设不会受到影响。

## 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- Git，且克隆时初始化 submodule
- 拥有 Codex 权限并已登录的 ChatGPT 账户

本项目精确支持 DSH `dsh-v0.2.0-rc.2`，并固定使用 `@openai/codex@0.159.2`；运行时不会调用 `PATH` 中其他版本的 Codex CLI。

## 从克隆到启动 Desktop

```powershell
git clone --recurse-submodules <repository-url> D:\dsh-embedded-codex
Set-Location D:\dsh-embedded-codex
$previousCi = $env:CI
try {
  $env:CI = 'true'
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
} finally {
  $env:CI = $previousCi
}
codex login
pnpm dev
```

安装期间临时设置 `CI=true`，让 submodule 中的 DSH 跳过 Lefthook 安装器，随后恢复原环境。全局 `core.hooksPath` 保持原配置。首次安装和后续依赖恢复都使用这一方式；具体原因见 [Desktop 指南](docs/desktop.md)。

`pnpm dev` 会完成以下工作：

1. 检查固定版本 DSH 与插件的构建缓存，仅构建输入发生变化或产物缺失的部分，再生成或复用内容一致的真实插件 tgz；构建完成后才加载依赖 DSH 构建产物的 Desktop 辅助模块。
2. 初始化隔离的 `.tmp/desktop/dsh-home/profiles/desktop`；tgz、Bundle 注册或安装文件变化时重新安装，否则复用已有安装。
3. 将 DSH home 固定在 `.tmp/desktop/dsh-home`，Electron userData 固定在 `.tmp/desktop/electron-user-data`；路径相对仓库根目录计算，覆盖外部同名环境变量。
4. 启动 DSH Electron Desktop 开发客户端。

日常启动不自动执行完整测试。使用 `pnpm dev:verify` 可先运行与 `pnpm test` 相同的构建、测试、lint、文档和隔离安装检查，再启动 Desktop。构建、打包和安装输出各阶段耗时及缓存复用状态。上游 Desktop 启动器仍会准备 Node/Python 运行环境并执行 Office 检查；本项目不改变该上游流程，因此这些耗时也存在于 `pnpm start:desktop`。

打开一个新 Session，选择 `Embedded Codex` 即可。Embedded Codex 不需要 `DEEPSEEK_API_KEY`；其他标准预设仍使用各自配置的模型凭据。`dev:web` 仅用于 Web 回归，不是默认客户端入口。

如果克隆时没有携带 submodule，先执行：

```powershell
git submodule update --init --recursive
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` / `pnpm dev:desktop` | 增量构建、按需打包和安装到隔离 Desktop Profile，再启动 Electron |
| `pnpm dev:verify` | 完整验证后启动 Desktop；复用验证生成的 tgz |
| `pnpm start:desktop` | 复用已有构建，重建隔离 Desktop disposable project 并启动 Electron |
| `pnpm build:desktop` | 构建插件和目标 DSH Desktop |
| `pnpm prepare:desktop` | 准备 Desktop package set，并输出插件 tgz 与 preparation manifest |
| `pnpm package:desktop:*` | 生成目标 Electron 制品和精确配对的插件 tgz/manifest |
| `pnpm pack:plugin` | 只生成独立、内容寻址的插件 tgz |
| `pnpm desktop:install-plugin` | 通过 Desktop 注册的 `dsh` 安装 tgz 到真实 `desktop` Profile |
| `pnpm desktop:remove-plugin` | 从真实 `desktop` Profile 移除插件 |
| `pnpm dev:web` | 显式启动隔离 Web 回归环境 |
| `pnpm build` | 只准备插件需要的 DSH 类型及 Host 包，再生成并构建本插件 |
| `pnpm build --clean` | 重新生成兼容源码并全量构建插件；仍复用有效的 DSH 构建 |
| `pnpm test` | 执行 build、Vitest、lint、文档检查和 tarball 隔离安装测试 |
| `pnpm pack` | 生成可安装的 `.tgz`；pnpm 会通过 `prepack` 自动先执行 build |

调试单个测试不需要额外的 package script，例如：

```powershell
pnpm exec vitest run tests/runtime.spec.ts
```

## Desktop 安装与交付

真实 Desktop 先启动一次以初始化 Profile，再完全退出（Windows 包括托盘），执行 `pnpm desktop:install-plugin`。它通过 Desktop 注册的 `dsh` 安装本次构建的 tgz；移除使用 `pnpm desktop:remove-plugin`。

`package:desktop*` 当前交付 **DSH App + 外置插件 tgz + integration manifest**。插件需要通过该 Desktop 的命令安装到用户 Profile；应用安装器没有把插件内置到默认 Profile，也不会携带开发会话或登录数据。

成品默认 DSH home 为 `~/.dsh`，Windows userData 为 `%APPDATA%\@deepseek-ai\dsh-desktop`；它们沿用 DSH 的应用身份。开发环境的数据不会自动迁移到成品。完整路径表、环境变量优先级、打包配置和平台命令见 [Desktop 开发与交付](docs/desktop.md)。

## 构建说明

DSH 基线取父仓库 Git index 中 stage 0 的 submodule gitlink；参考 checkout 必须与它一致且没有受版本控制的修改。兼容版本、六个 replacement、11 个逐文件 patch 和必要产物统一登记在 [`compat/manifest.json`](compat/manifest.json)。patch 在本仓库的生成副本中应用；运行时使用编译后的 provider，Conversation UI 保留原版。

`pnpm build` 只准备插件依赖闭包，`pnpm test` 另外准备 CLI/Loader 集成依赖，Desktop 完整构建使用 `.tmp/desktop-source` 的隔离副本和私有依赖。插件源码变化不使 Desktop 重建；缓存缺失或失效时自动补齐。Desktop 构建适配登记在 [`compat/desktop-build.json`](compat/desktop-build.json)。

修改兼容 provider 前阅读[兼容性与 patch 维护](docs/compatibility.md)；目录归属、缓存和启动耗时见 [Desktop 指南](docs/desktop.md)。

## 权限模式

选择 `Embedded Codex` 后，DSH 权限选择器会切换为 Codex 的三种模式；切回其他 Agent 预设后恢复 DSH 原表。中文显示“请批准 / 帮我批准”，英文显示“Ask for approval / Approve for me”，继续使用 DSH 的选择器、风险确认和图标。

| UI 模式 | App Server 设置 | 行为 |
|---|---|---|
| 请批准 / Ask for approval | `workspaceWrite + on-request + user` | 工作区内直接执行；联网或越界时请求用户批准 |
| 帮我批准 / Approve for me | `workspaceWrite + on-request + auto_review` | 沙盒边界不变，符合条件的越界请求交给自动审核 |
| 完全权限 / Full access | `dangerFullAccess + never` | 不使用 Codex 文件和网络沙盒，不弹出审批 |

权限选择记录在 Session 中。每个新 `turn/start` 都重发完整策略，活动 turn 中不能切换权限；`read-only` 等无法无损映射的旧状态显示为 `Custom`，要求用户明确选择。Ask 与 Auto-review 的显式 writable root 都是 Session cwd，网络默认关闭，临时目录策略沿用当前映射；Auto-review 只改变审批者。精确字段、迁移和审批边界见[架构](docs/architecture.md)。

## 配置

可以在更晚的 Profile patch 中覆盖 `embedded-codex` 条目：

```yaml
- id: embedded-codex
  config:
    requireChatgptLogin: true
```

| 字段 | 默认值 | 用途 |
|---|---|---|
| `providerName` | `codex` | DSH 模型选择器中的 provider id |
| `providerDisplayName` | `Codex` | Provider 显示名称 |
| `defaultModelAlias` | `default` | 使用 Codex 原生默认模型选择 |
| `requireChatgptLogin` | `true` | 拒绝未登录或 API Key 登录 |
| `env` | `{}` | 显式传给 App Server 的环境变量 |
| `processCwd` | 当前进程目录 | App Server 工作目录 |
| `approvalPolicy` | `on-request` | 已弃用；仅在没有 Permission Presets provider 的非标准组合中作为兼容 fallback |
| `sandbox` | `workspace-write` | 已弃用；仅在没有 Permission Presets provider 的非标准组合中作为兼容 fallback |
| `disposeGraceMs` | `3000` | 子进程关闭宽限时间 |
| `stderrMaxBytes` | `65536` | 保留的 stderr 诊断上限 |

## 维护文档

| 文档 | 维护内容 |
|---|---|
| [Desktop 开发与交付](docs/desktop.md) | 数据路径、环境变量、缓存、真实安装、打包和启动排障 |
| [架构](docs/architecture.md) | Runtime/Preset 边界、注入作用域、Session、权限、绑定与清理 |
| [兼容性与 patch 维护](docs/compatibility.md) | 精确基线、保留 patch 的原因、维护规则和平台验证范围 |
| [测试](docs/testing.md) | 自动检查、真实 Loader/Host、故障回归和真实账号验证 |
| [升级](docs/upgrading.md) | DSH/Codex 升级、协议生成和发布检查 |

长期文档描述当前实现和可重复操作；接口以源码及 manifest 为准，行为以对应测试为依据。实现变化同步更新所属文档，不另存已完成计划或按开发轮次累积交付记录。

许可证见 [LICENSE](LICENSE)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
