# Contributing

## Gitflow

This repo follows **gitflow**:

- `main` — production-ready, tagged releases only.
- `develop` — integration branch (default working branch).
- `feature/*` — branch off `develop`, merge back into `develop`.
- `release/*` — stabilize a release, merge into `main` **and** `develop`, tag on `main`.
- `hotfix/*` — urgent fixes branched off `main`, merged into `main` + `develop`.

```bash
git checkout develop
git checkout -b feature/my-change
# ...work, commit...
git checkout develop && git merge --no-ff feature/my-change
```

Release:

```bash
git checkout -b release/1.0.0 develop
# bump versions, finalize docs
git checkout main && git merge --no-ff release/1.0.0 && git tag -a v1.0.0 -m "v1.0.0"
git checkout develop && git merge --no-ff release/1.0.0
```

## Toolchain

- Node.js 20+ (`.nvmrc`/`engines` pin to >=20).
- No build step for the frontend — it's vanilla ES modules served statically.
- CDK app is TypeScript (`infra/`).

## AWS profile (`web-game`)

Add to `~/.aws/config`:

```ini
[profile web-game]
credential_process = ada credentials print --account 253988640130 --role Admin --format json
region = us-east-1
output = json
```

Verify:

```bash
aws sts get-caller-identity --profile web-game
```

## Verify before pushing

Run all test suites from the repo root:

```bash
npm run verify
```

This runs the backend (`node:test`), frontend (`node:test`), and infra
(CDK assertions) suites. Please keep them green and add tests with new code.
