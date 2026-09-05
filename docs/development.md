# Development workflow

Peerly is implemented as independently reviewed steps. A step never flows directly into the next one.

## Per-step lifecycle

1. Present the change plan: behavior, architecture, expected files, result, and acceptance checks.
2. Wait for explicit user approval before editing code.
3. Follow TDD: add a failing behavior test, observe the expected failure, implement the minimum behavior, then refactor.
4. Run relevant tests, lint, type checking, builds, and manual acceptance checks.
5. Request review while all changes remain uncommitted. Report behavior, files, test results, limitations, and exact trial commands.
6. Address feedback and repeat validation. Commit only after explicit review approval.
7. Report the commit hash, then stop and prepare a separate plan for the next step.

Use Conventional Commits. Do not weaken or remove a test to make an implementation pass, do not include unrelated changes, and never commit credentials or generated runtime data.
