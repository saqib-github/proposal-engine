---
name: commit-push
description: Commit and push changes for the proposal-engine repo using its token-authenticated remote and repo-local identity (saqib-github account). Use this EVERY time work needs to be committed, pushed, saved, or published to GitHub in this project — including "commit this", "push the changes", "save progress", "upload to GitHub", or at any natural checkpoint after completing a feature. Never use the user's global git identity, gh CLI auth, or system credential helpers for this repo.
---

# Commit & Push (proposal-engine)

This machine's global git config belongs to a DIFFERENT identity (`saqib-sortswift` / work account with gh + osxkeychain credential helpers). This repo must always commit and push as the **saqib-github** account instead. Both are already wired up locally — your job is to use them and never bypass them.

## How auth works here

- **Identity**: repo-local `user.name` / `user.email` (set in `.git/config`) attribute commits to the saqib-github GitHub account. Global config must never be read from, written to, or relied on. Never run `git config --global` in this project.
- **Auth**: a GitHub personal access token is embedded in the `origin` remote URL inside `.git/config`. Because credentials are in the URL, git skips all credential helpers (gh CLI, osxkeychain) — exactly what we want. `.git/config` is never pushed, so the token stays local.
- **Consequence**: the token must NEVER appear in any tracked file (code, docs, this skill, commit messages, CI files). GitHub push protection would block the push and the token would have to be rotated.

## Workflow

1. **Verify the wiring** (cheap, do it before every push session):
   ```bash
   git config user.email          # expect: 78408075+saqib-github@users.noreply.github.com
   git remote get-url origin | sed 's/ghp_[A-Za-z0-9]*/ghp_***/'   # expect https://saqib-github:ghp_***@github.com/...
   ```
   If either is missing (e.g. fresh clone), STOP and re-link — see Recovery below.

2. **Review what you're committing**:
   ```bash
   git status --short && git diff --stat
   ```
   Confirm no `.env*`, tokens, API keys, or `data/uploads/` content is staged. If a secret-looking string appears in the diff, unstage it and fix before continuing.

3. **Commit** with a clear conventional-style message (`feat:`, `fix:`, `docs:`, `chore:`):
   ```bash
   git add -A
   git commit -m "feat: <what and why in one line>

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

4. **Push**, masking the token in any output you show:
   ```bash
   git push origin main 2>&1 | sed 's/ghp_[A-Za-z0-9]*/ghp_***/'
   ```

## Recovery (fresh clone or missing auth)

The token lives only in `.git/config`. If the remote URL has no token or identity is unset, ask the user for the token (never guess, never pull from gh CLI), then:

```bash
git config user.name "Saqib Javed"
git config user.email "78408075+saqib-github@users.noreply.github.com"
git remote set-url origin "https://saqib-github:<TOKEN>@github.com/saqib-github/proposal-engine.git"
```

## Hard rules

- Never `git config --global` anything.
- Never invoke `gh` for auth/push in this repo (it's logged into the other account).
- Never write the token into tracked files or echo it unmasked.
- Push to `main` on `origin` unless the user asks for a branch/PR.
