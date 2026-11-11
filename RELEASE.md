# Release and go-public checklist (for the maintainer)

These steps are for the owner to run. The build session did **not** run any of them: the repository is private, and nothing has been published.

## 0. First: clear BLOCKED.md
Do **not** run step 1 until every open item in `BLOCKED.md` is done. The old problem (closed Dependabot PRs and pre-rewrite commits that kept local setup details) was resolved by recreating the repository from a single clean commit; see `BLOCKED.md`.

## 1. Make the repository public
```bash
GH_TOKEN=$(gh auth token -u vulbsti) gh repo edit vulbsti/tmuxherd --visibility public --accept-visibility-change-consequences
GH_TOKEN=$(gh auth token -u vulbsti) gh repo edit vulbsti/tmuxherd \
  --description "Supervise Claude Code, Codex, Pi and any terminal coding agent in tmux from one browser tab: live grid, answer permission prompts, stall watchdog." \
  --add-topic tmux,claude-code,codex,ai-agents,coding-agents,developer-tools,dashboard
# Enable private vulnerability reporting (SECURITY.md points to it):
GH_TOKEN=$(gh auth token -u vulbsti) gh api -X PUT repos/vulbsti/tmuxherd/private-vulnerability-reporting
```

## 2. Publish to npm
```bash
npm whoami                 # log in first with `npm login` if needed
npm pack --dry-run         # check the file list: bin/, src/, public/, README.md, LICENSE, CHANGELOG.md
npm publish --access public
```
After this, `npx tmuxherd` works for everyone.

## 3. GitHub release
```bash
GH_TOKEN=$(gh auth token -u vulbsti) gh release create v0.1.0 --title "tmuxherd 0.1.0" --notes-file CHANGELOG.md
```

## Later releases
1. Bump `version` in `package.json` and add a `CHANGELOG.md` section.
2. Run `npm ci && npm run lint && npm test && npm run e2e`, plus `npm run e2e:real` locally.
3. `git commit -am "release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags`.
4. `npm publish`, then `gh release create vX.Y.Z`.
