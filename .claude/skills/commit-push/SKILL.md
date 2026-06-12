---
name: commit-push
description: Commit and push changes for the proposal-engine repo using its token-authenticated remote and repo-local identity (saqib-github account). Use this EVERY time work needs to be committed, pushed, saved, or published to GitHub in this project — including "commit this", "push the changes", "save progress", "upload to GitHub", or at any natural checkpoint after completing a feature. Never use the user's global git identity, gh CLI auth, or system credential helpers for this repo.
---

# Commit & Push (proposal-engine)

This machine's global git config belongs to a DIFFERENT identity (`saqib-sortswift` / work account with gh + osxkeychain credential helpers). This repo must always commit and push as the **saqib-github** account instead. Both are already wired up locally — your job is to use them and never bypass them.

## How auth works here

- **Identity**: repo-local `user.name` / `user.email` (set in `.git/config`) attribute commits to the saqib-github GitHub account. Global config must never be read from, written to, or relied on. Never run `git config --global` in this project.
- **Auth**: a GitHub personal access token is embedded in the `origin` remote URL inside `.git/config`. Because credentials are in the URL, git skips all credential helpers (gh CLI, osxkeychain) — exactly what we want. `.git/config` is never pushed, so the token stays local.
- **Token storage**: the token is saved next to this skill in `.claude/skills/commit-push/github-token.local` (gitignored). Read it from there whenever you need it:
  ```bash
  TOKEN=$(tr -d '[:space:]' < .claude/skills/commit-push/github-token.local)
  ```
  Never ask the user for the token while this file exists, and never read tokens from gh CLI or the keychain (those belong to the other account).
- **Consequence**: the token must NEVER appear in any tracked file (code, docs, this SKILL.md, commit messages, CI files). This repo is PUBLIC — GitHub secret scanning auto-revokes any `ghp_` token it sees in pushed content, which would break this whole setup. The `.local` file is the only place it may be written, and it must stay gitignored.

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
   git check-ignore .claude/skills/commit-push/github-token.local  # must print the path
   ```
   Confirm no `.env*`, tokens, API keys, or `data/uploads/` content is staged, and that the token file is still ignored (if `check-ignore` prints nothing, STOP — fix `.gitignore` before any commit). If a secret-looking string appears in the diff, unstage it and fix before continuing.

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

If the remote URL has no token or identity is unset, re-wire from the saved token file — no need to involve the user:

```bash
TOKEN=$(tr -d '[:space:]' < .claude/skills/commit-push/github-token.local)
git config user.name "Saqib Javed"
git config user.email "78408075+saqib-github@users.noreply.github.com"
git remote set-url origin "https://saqib-github:${TOKEN}@github.com/saqib-github/proposal-engine.git"
```

Only if `github-token.local` is also missing (e.g. fresh clone, since it is gitignored): ask the user for the token, write it back to that file, then run the commands above. Never guess and never pull credentials from gh CLI or the keychain.

## Hard rules

- Never `git config --global` anything.
- Never invoke `gh` for auth/push in this repo (it's logged into the other account).
- Never write the token into tracked files or echo it unmasked.
- Push to `main` on `origin` unless the user asks for a branch/PR.
