---
name: commit
description: 使用 Conventional Commits 规范与 emoji 生成英文 commit message，并执行 /commit 的完整提交流程（暂存、分析、生成、提交）。当用户要求提交代码、生成/优化 commit message、或提及 git commit / Conventional Commits / emoji 时使用本技能。
---

# Commit

## 概述

使用本技能为当前仓库生成并提交符合 Conventional Commits 的英文 commit message，且必须包含 emoji 标签。

## 硬性规则

- 只输出英文的 commit message（正文与 footer 也必须英文）。
- 每条 commit message 必须包含 emoji，且 emoji 是 commit subject 的一部分。
- 使用 Conventional Commits 格式，默认 simple 风格；必要时使用 full 风格。
- 主题行使用祈使语气，首字母大写，不要以句号结尾。

## 命令与参数

- 基本用法：`/commit`
- 选项：
  - `--no-verify`
  - `--style=simple|full`
  - `--type=feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert`

## 工作流

1. **提交前检查**
   - 默认不运行任何检查。
   - 仅在用户明确要求时，才询问并执行具体检查命令。
2. **文件暂存**
   - 运行 `git status`。
   - 若无已暂存文件，自动执行 `git add -A` 暂存所有变更。
3. **变更分析**
   - 查看 `git diff --staged` 了解即将提交的内容。
   - 识别是否存在多个不相关变更；如需要拆分，先提出拆分建议再继续。
4. **生成 commit message**
   - 自动判断 type/scope；若用户提供 `--type` 则以其为准。
   - 按 `simple` 或 `full` 风格生成 message。
5. **执行提交**
   - 使用生成的 message 执行 `git commit`。
   - full 风格建议使用多段 `-m` 或临时文件提交。

## 生成规范（摘要）

- simple：`<emoji> <type>[optional scope]: <description>`
- full：在主题行下方添加空行、body、footer。
- 详细规则、emoji 对照表、拆分策略与示例见 `references/conventional-commits.md`。

## 参考资料

- `references/conventional-commits.md`
