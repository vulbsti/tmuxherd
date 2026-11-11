# Blocked: needs the owner

## Resolved (2026-11-12): old commits reachable through closed PRs and by SHA
Repository recreated from a single clean commit; the old repo is kept private as `vulbsti/tmuxherd-history`. The old repository's closed Dependabot PR refs and pre-rewrite commits (DECISIONS D13, D19–D21) live only in that private repo, so nothing reachable from the new repository carries them.

## Release steps (owner only, by design)
The repo stays private and nothing is published. When ready, follow `RELEASE.md` (go public, `npm publish`, GitHub release).
