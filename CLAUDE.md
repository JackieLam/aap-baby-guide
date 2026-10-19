# 开发约定（本仓库）

## Git 与协作流程

- **用 Pull Request 开发**：不直接往 `main` 推改动。每个开发任务从 `main` 切一个分支，完成后开 PR 合并回 `main`。
- **按功能拆 commit**：不同的功能 / 改动用不同的 commit 区分，一个 commit 只做一件相对独立的事，便于回溯与 review。
- **一个 PR 可以包含多个 commit**：一个 PR 聚合一个主题下的若干 commit，不必一个 PR 只有一个 commit。
- **合并方式**：合并 PR 时默认 **squash merge**（除非另有说明）。
- **部署**：`main` 分支由 GitHub Pages 自动部署到 <https://jackielam.github.io/aap-baby-guide/>；合并到 `main` 即上线。

## Commit message

- 用中文或英文均可，首行是简洁的变更摘要，必要时空一行后写要点。
- **不要加任何 AI / agent / 模型署名**：禁止 `Co-Authored-By` 指向 AI/agent/模型，也不要 `🤖 Generated with ...` 之类。人类 co-author 可以。

## 分支命名

- 用 `类型/简述` 形式，例如 `feat/...`、`fix/...`、`docs/...`、`refactor/...`。
