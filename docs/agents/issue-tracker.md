# Issue tracker: GitHub

Issues and specs for `li-shun-code/mojian` live in GitHub Issues. Use the `gh` CLI from this repository.

## Conventions

- Create issues with `gh issue create`; read them with `gh issue view <number>`; list open issues with `gh issue list --state open`.
- Link child work with GitHub sub-issues and blocking dependencies when available. Otherwise record the relationship in the issue body.
- Apply or remove labels with `gh issue edit <number> --add-label ...` / `--remove-label ...`.
- When a skill says to publish work to the issue tracker, create a GitHub issue.
- Before the first issue creation in a session, verify the target with `gh repo view --json nameWithOwner`.

## Pull requests as a triage surface

**PRs as a request surface: no.**
