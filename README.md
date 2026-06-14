# 🌾 Photo Horde Survivor · 照片割草

A web-based **horde-survivor ("割草") game** where the player's uploaded **photo** is turned into the game's **hero, enemies, bullets, and map background** using **AWS Bedrock Nova Canvas**. The backend generates **3 style choices** and the player picks **exactly one (final, once only)**. Includes a **leaderboard** and an opt-in **gallery** of AIGC creations.

```
Browser (Canvas game) ──HTTPS──► CloudFront ──► S3 (static web)
                                      │
                                      ├─ /assets/* ─► S3 (generated assets)
                                      └─ /api/*    ─► HTTP API Gateway ─► Lambda
                                                                          ├─ generateAssets ─► Bedrock Nova Canvas
                                                                          ├─ selectAsset    ─► Bedrock + DynamoDB (single-selection lock)
                                                                          ├─ scores         ─► DynamoDB (Leaderboard)
                                                                          └─ gallery        ─► DynamoDB (gallery GSI)
```

## Features

- 📷 **Photo → game assets**: upload a photo, Bedrock Nova Canvas (`amazon.nova-canvas-v1:0`) generates themed assets via `IMAGE_VARIATION`.
- 🎨 **3 styles, choose once**: backend returns 3 styled hero previews (Neon / Pixel / Cartoon). Selection is locked atomically in DynamoDB — **you can only choose once**.
- 🧹 **Horde-survivor gameplay**: WASD/arrows/mouse/touch movement, auto-fire at nearest enemy, escalating waves, health & score.
- 🏆 **Leaderboard**: top scores in DynamoDB.
- 🖼️ **Gallery**: only creations where the player explicitly opted in to share are shown.
- ☁️ **Infrastructure-as-code**: full AWS CDK stack.

## Repository layout

```
photo-horde-survivor/
├── infra/        # AWS CDK app (TypeScript)
│   ├── bin/app.ts
│   └── lib/game-stack.ts
├── backend/      # Lambda handlers (Node.js 20, ESM)
│   ├── shared/common.mjs
│   └── handlers/{generateAssets,selectAsset,scores,gallery}.mjs
└── frontend/     # Static web game (HTML5 Canvas, vanilla JS)
    ├── index.html, styles.css
    └── src/{config,api,game,main}.js
```

## Prerequisites

- Node.js 20+ and npm
- AWS profile **`web-game`** (account `253988640130`, role `Admin`, region `us-east-1`)
- Bedrock model access enabled for `amazon.nova-canvas-v1:0` in us-east-1

### AWS profile (`~/.aws/config`)

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

## Deploy

```bash
# 1. install dependencies
cd backend && npm install && cd ..
cd infra && npm install

# 2. bootstrap (first time only, per account/region)
npx cdk bootstrap --profile web-game

# 3. deploy
npx cdk deploy --profile web-game --require-approval never
```

CDK outputs `SiteUrl` (CloudFront URL) — open it to play. The frontend is deployed
to S3 and served via CloudFront; `/api/*` and `/assets/*` are routed by the same distribution.

### Local frontend testing

```bash
cd frontend && python3 -m http.server 8080
# open http://localhost:8080/?api=<ApiEndpoint-from-cdk-output>
```
Use **"略過，用預設圖玩 / Play with defaults"** to test gameplay without calling Bedrock.

## API

| Method | Path           | Description                                             |
|--------|----------------|---------------------------------------------------------|
| POST   | `/api/generate`| `{ imageBase64, playerName?, allowGallery? }` → 3 styles |
| POST   | `/api/select`  | `{ generationId, variantId }` → full asset pack (once)  |
| GET    | `/api/scores`  | Top 20 leaderboard entries                              |
| POST   | `/api/scores`  | `{ playerName, score, style?, generationId? }`          |
| GET    | `/api/gallery` | Opted-in public AIGC creations                          |

## Gitflow

This repo follows **gitflow**:

- `main` — production-ready, tagged releases.
- `develop` — integration branch (default working branch).
- `feature/*` — branch off `develop`, merge back into `develop`.
- `release/*` — stabilize a release, merge into `main` + `develop`.
- `hotfix/*` — urgent fixes off `main`.

```bash
git checkout develop
git checkout -b feature/my-change
# ...work...
git checkout develop && git merge --no-ff feature/my-change
```

## Cost & safety notes

- Bedrock image generation is billed per image. `/generate` produces 3 images; `/select` produces 3 more (enemy, bullet, background) for the chosen style only.
- S3 uploads bucket auto-expires raw photos after 7 days; generation records have a 30-day TTL until a selection is finalized.
- All buckets are private (Block Public Access); assets are served via presigned URLs / CloudFront OAI.
- Gallery only ever shows creations where `allowGallery === true`.

## License

Internal demo project.
