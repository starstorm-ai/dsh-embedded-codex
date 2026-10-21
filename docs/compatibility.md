---
description: "DSH/Codex 精确基线、兼容 patch 维护、Session 边界与平台验证范围。"
kind: "reference"
---

# 兼容性与 patch 维护

## 支持矩阵

| 组件 | 支持值 |
|---|---|
| DeepSeek Harness tag/commit | `dsh-v0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84` |
| DSH package version | `0.2.0-rc.2` |
| `@openai/codex` | `0.159.2` |
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| 默认客户端/Profile | Electron Desktop / `desktop`（`web` 仅回归） |

本版本是精确兼容，不声明 semver 范围。Host replacement 校验 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-agent-preset-registry`、`@deepseek-ai/dsh-config-editor`、`@deepseek-ai/dsh-permission-presets` 与 `@deepseek-ai/dsh-api-session-controller`；UI replacement 只校验 `@deepseek-ai/dsh-client-ui-permission-presets`。Conversation UI 保持目标 DSH 原版。任一受管 package 版本不同都会明确失败。

父仓库 Git index 中 stage 0 的 submodule gitlink 是开发基线的唯一 commit 来源。构建拒绝 gitlink 缺失、冲突、checkout 不一致或参考 submodule 有受版本控制的修改；升级时先暂存 gitlink。兼容版本、provider、patch 和必要产物来自 `compat/manifest.json`，运行时数据由构建生成。兼容 patch 的单文件约束、文件名编码路径校验、Profile provider guard、组合测试和精确 package 版本检查共同负责发现不兼容变化。

## 保留的兼容边界

当前有六个 replacement、11 个源码 patch。完整文件清单及对应模块/测试维护在 [`compat/manifest.json`](../compat/manifest.json)；这里记录保留这些接入点的原因：

| 接入点 | patch 数 | 必须承接的上游行为 |
|---|---:|---|
| Agent Registry | 1 | 注册 Runtime、选择 factory、检查模型能力并随 effect 释放 |
| Agent Preset Registry | 1 | 将受管 preset 的选择交给 Session 协调器 |
| Session Controller Host/client | 4 | 按 Session 排队、替换/补偿 Agent，以及同 ID 客户端对象重新激活 |
| Config Editor | 1 | 同 id replacement 的配置读取遵循 Loader 后写覆盖规则 |
| Permission Host/types | 2 | 消费 Runtime 权限 profile，投影 Session 专属选项 |
| Permission UI | 2 | 从 Session projection 读取选项，保留 DSH 的组件与交互 |

Codex 模式和模型默认值由插件声明，通用路由与协调逻辑放在 `src/compat`；patch 仅承接这些能力。Conversation UI、默认 Agent Loop 和 transport 使用上游实现。Permission UI 修改 TypeScript/TSX 源码，不改写压缩后的 bundle。

另外五项 Desktop 构建转换登记在 [`compat/desktop-build.json`](../compat/desktop-build.json)，处理 CSS、Windows Electron 子进程退出状态、installer 资源及 pnpm 收集器适配。它们作用于私有构建副本及其私有依赖，与发布 provider 的源码 patch 分开维护；不修改参考 submodule 或共享 pnpm store。

## 修改与生成 patch

普通插件开发修改 `src`、`scripts`、`tests`。改变上游接入点时：

1. 在现有基线上运行 `pnpm build`，生成与当前 patch 一致的 `compat/generated`。
2. 只在本次维护中编辑生成副本；如果增删 patch 目标，同步 manifest 中的用途、所属模块和验证。
3. 在再次 build 之前运行生成命令，将差异保存为可审查的 patch：

   ```powershell
   pnpm exec tsx scripts/maintenance/update-compat-patches.mts
   ```

4. 审查 diff，运行 `pnpm test`；升级基线的额外检查见[升级](upgrading.md)。

`compat/generated` 是可重建输入，不能把手工修改留在那里作为交付，也不提交该目录。更新脚本与构建共用锁，先验证全部 diff，再替换 patch 文件；变更目标必须与 manifest 完全一致。

`compat/patches` 只能包含扁平的 `*.patch` 文件。文件名由 DSH 根目录相对路径将 `/` 换成 `+` 后加 `.patch`，例如：

```text
packages/api/session-controller/src/agent.ts
  -> packages+api+session-controller+src+agent.ts.patch
```

每份 patch 只能有一个 `diff --git` 文件段；`diff --git`、`---`、`+++` 路径必须与文件名解码结果相同，目标必须在 manifest 登记的 provider 源码根内。构建会验证这些约束并严格应用补丁。补丁格式中的空上下文行是合法 diff 标记，应结合实际应用结果审查。

## Profile 冲突

Bundle 以原 package 名称作为 Cordis patch guard。若另一个更早的 Bundle 改写或移除了 `agent`、`agent-preset-registry`、`config-editor`、`permission`、`session-controller` 或 `ui-permission`，DSH 会输出 patch warning。构建校验会同时确认原 registry 已由 package-name guard 禁用，并且兼容 registry 以相同 id 后写覆盖；主 Runtime 的 Loader 检查随后验证最终生效的 provider 组合。兼容 Config Editor 让该同 id replacement 的 profile 设置保持可写。检查也会确认原版 `ui-conversation` 和默认 `agent-loop` 仍启用。

## Session 兼容性

标准 DSH Session 保持标准 Runtime 和原有恢复行为。Codex Session 的原生绑定优先读取版本化 `request/context.data.embeddedCodex` 日志，不再依赖是否存在 Assistant 消息；无新日志时兼容读取 Assistant source 中的旧 binding。新日志损坏或 provider 不符时拒绝恢复，提交结果未知时拒绝重发。fork 只使用继承边界内的已确认绑定。

`permission/preset`、`sandbox/mode` 和 `approval/policy` 仍使用 DSH 原有事件。新 projection state 会从 Session header 与 `agent-preset/selected` 事件恢复 provider-aware 选项；旧 Workspace write 状态安全映射到 Ask，旧 Full access 保留 Full access，旧 Read only 显示为 `custom` 并要求用户选择。

旧实验性实现、其他 Codex adapter 或其他 Agent Runtime 产生的可见 transcript 不会自动转换。若 Session 已有模型 turn，DSH 会锁定 Agent Preset；创建新 Session 才能选择另一个 Runtime。

跨 Runtime 切换只允许空白、idle 且无待处理输入的 Session。切换保持 Session ID；失败时只在清理完整后补偿恢复旧 Agent。清理不完整或补偿失败会阻止后续 admission，避免出现两个持久化写入者。卸载插件恢复 stock provider 组合，但不转换已有 Codex Session 或其隐藏历史。

## 平台与验证范围

以下为 2026-10-20 固定基线的本地验证范围，后续发布按[测试](testing.md)重新验证：

| 范围 | 已验证 | 仍需验证 |
|---|---|---|
| 插件自动检查 | 构建、14 文件 / 81 用例、lint、文档、真实 tgz 安装/卸载、包外 Host/Client 声明 | 新变更应重跑适用检查 |
| Windows x64 Desktop 开发版 | 独立 Profile 启动 Electron、Host/插件/客户端就绪、正常退出 | 真实账号完整 turn、取消、恢复、fork、审批 |
| Windows x64 unsigned 目录成品 | production dependencies、插件 add/list/remove、Host/frontend、真实 Remote preset 往返切换且同一 Session ID | 正式签名、安装器、升级及自动更新 |
| macOS x64 / arm64 | 提供目标命令与相同资格检查流程 | 本地未实机验证运行、打包或签名 |

App Server 业务自动测试使用 fake server；成品 Host 冒烟不发送模型输入。启动成功和接口切换通过不代表真实账号端到端已通过。unsigned 测试配置与正式发布配置分离，具体路径和交付方式见 [Desktop 指南](desktop.md)。

## 不支持的降级

- Host 版本不同不会尝试 duck typing。
- Codex 未登录不会回退到 DeepSeek。
- API-key Codex 登录在默认配置下不会回退为 ChatGPT 登录。
- `ctx.llm.stream()` 不会接管 Codex 对话。
- 缺少原生 thread binding 不会用可见消息重建隐藏历史。
- 未知 App Server request 不会被忽略。
- 未知或无法无损映射的权限状态不会回退到更宽模式。
- App Server 不接受或重写所选 reviewer、approval policy、网络边界时不会继续执行 turn。
