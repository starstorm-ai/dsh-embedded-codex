---
description: "升级固定 DSH submodule、兼容 provider 和 Codex App Server 协议。"
kind: "guide"
---

# 升级

DSH 与 Codex 分开升级。两者都会改变 provider 或 App Server 接口，必须分别审查和测试。

## 升级 DeepSeek Harness

1. 在 `upstream/deepseek-harness` checkout 目标官方 commit。
2. 在父仓库执行 `git add upstream/deepseek-harness`，让 gitlink 成为新的唯一基线。
3. 确认 `agent`、`agent-presets` 与 `session-controller` 的 Profile id、provider 名称和职责没有发生意外变化。
4. 更新 `src/compat/host-version.ts` 中允许的 DSH package 版本。
5. 从新基线重新制作并审查 `compat/patches/*.patch`，每个 DSH 文件生成一个 patch，并按 README 的 DSH 相对路径 `+` 编码规则命名；不要强制套用行为已经不兼容的旧 patch。
6. 执行 `pnpm test`。
7. 运行真实账号检查，重点验证空白 Session Runtime 切换、恢复、fork 和 Web `removed → added`。

构建会从 gitlink 获取目标 commit，并自动让旧的 `.tmp/upstream-build.json` 失效；不需要维护额外 commit 或文件摘要。

## 升级 Codex

1. 将 `package.json` 的 `@openai/codex` 改为准确版本。
2. 执行 `pnpm install` 更新 `pnpm-lock.yaml`。
3. 运行维护脚本生成协议：

   ```powershell
   pnpm exec tsx scripts/maintenance/update-protocol.mts
   ```

4. 审查全部 `protocol/` diff，更新 App Server 字段验证、通知映射、请求映射和 fake server fixture。
5. 执行 `pnpm test` 和真实账号检查。

协议生成器直接读取已安装 `@openai/codex` 的 package manifest，不维护第二份 Codex 版本，也不使用 `PATH` 中的 Codex。

## 发布前检查

```powershell
pnpm test
pnpm pack
tar -tf .\dsh-embedded-codex-*.tgz
```

确认 tarball 不包含 `upstream/`、`compat/generated/`、`.tmp/`、认证文件或日志，并用生成的 tarball 完成一次真实 DSH Web Profile 安装。

不要在 DSH 安装目录应用源码 patch，也不要提交 `compat/generated/`。发布产物必须由 submodule、可审查 patch 和本仓库源码重建。
