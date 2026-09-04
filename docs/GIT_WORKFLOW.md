# Git Workflow

Run Phase 1 from the project root to initialize Git. For every phase after that, first confirm that the preceding phase is committed and the worktree is clean.

## Repository initialization

```bash
cd /Users/anshumaansharma0404gmail.com/Desktop/Recoup
git init
git branch -M main
git status
```

## Start each phase

```bash
git status --short
git log --oneline -5
```

If `git status --short` contains unexpected changes, stop and resolve them instead of overwriting or discarding them.

## Review and commit each completed phase

```bash
git diff --check
git status --short
git diff --stat
git diff
git add -A
git diff --cached --check
git diff --cached --stat
git commit -m "<phase commit message>"
git status --short
```

The final `git status --short` must be empty. Never use `git add .` blindly, `git reset --hard`, `git clean -fd`, force push, or commit secrets and local databases.

## Optional GitHub remote after Phase 1

```bash
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git remote -v
git push -u origin main
```

After later phase commits:

```bash
git push origin main
```
