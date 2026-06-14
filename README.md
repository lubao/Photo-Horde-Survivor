# 🌾 Photo Horde Survivor · 照片割草

A web-based **horde-survivor ("割草") game** where the player's uploaded **photo** is
turned into the game's **hero, enemies, bullets, and map background** using
**AWS Bedrock Nova Canvas**. The backend generates **3 hero style choices**,
narrates each generation step, and the player picks **exactly one (final, once
only)**. Includes a **leaderboard** and an opt-in **gallery** of AIGC creations.

```
Browser (HTML5 Canvas + Cognito Hosted UI)
        │  HTTPS
        ▼
   CloudFront ──► S3 (static web)
        ├─ /assets/* ─► S3 (generated assets, private via OAI)
        └─ /api/*    ─► HTTP API Gateway (JWT authorizer)
                              ├─ POST /upload-url          presign S3 PUT
                              ├─ POST /generate            quota + async worker
                              ├─ GET  /generate/{id}/status poll narration + previews
                              ├─ POST /select              single-selection lock
                              ├─ GET/POST /scores          leaderboard
                              └─ GET  /gallery             opted-in creations
                                   │ (async Event invoke)
                                   ▼
                          Generation Worker Lambda ─► Bedrock Nova Canvas
                                                   ─► S3 assets + DynamoDB steps
```

## How it works

1. **Sign in** with Cognito Hosted UI.
2. **Upload a photo** — the browser resizes it and PUTs it to S3 via a presigned URL.
3. **Generate** — a daily-quota check passes, a generation record is created, and an
   async **worker Lambda** calls Nova Canvas `IMAGE_VARIATION` to make **3 styled hero
   previews** (Neon / Pixel / Cartoon), cleaned with `BACKGROUND_REMOVAL`.
4. **Watch the narration** — the frontend polls `/status` and shows a live progress log
   (analyzing photo → generating hero variants → cleaning sprites → ready).
5. **Choose once** — selection is locked atomically in DynamoDB (`409` on any repeat).
   Selecting kicks off the async **assets phase** that generates the enemy, bullet, and
   background for the chosen style.
6. **Play** — a horde-survivor loop using your generated sprites; submit your score.
7. **Gallery** — if you opted in, your creation appears in the public gallery (generated
   art only — never your raw photo).

## Repository layout

```
photo-horde-survivor/
├── infra/        # AWS CDK app (TypeScript) + CDK assertion tests
├── backend/      # Lambda handlers (Node 20 ESM) + unit tests (node:test)
│   ├── shared/   # common · nova · data · storage
│   └── handlers/ # health uploadUrl generate worker status select scores gallery
└── frontend/     # Static HTML5 Canvas game (vanilla ES modules) + logic tests
    └── src/      # config auth api logic flow game main
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

```bash
aws sts get-caller-identity --profile web-game
```

## Test

From the repo root (runs backend + frontend + infra suites):

```bash
npm run verify
```

## Deploy

> ⚠️ Deploys real, billable resources to account `253988640130`. Ensure Bedrock model
> access for `amazon.nova-canvas-v1:0` is enabled first.

```bash
cd backend && npm install && cd ..
cd infra   && npm install

# first time per account/region only
npx cdk bootstrap --profile web-game

npx cdk deploy --profile web-game --require-approval never
```

CDK outputs `SiteUrl` (CloudFront). The frontend `config.json` (API base + Cognito IDs)
is generated and deployed automatically. Open `SiteUrl`, sign in, and play.

### Local frontend testing

```bash
cd frontend && npm run serve   # http://localhost:8080
```

Use **"略過，用預設圖玩 / Play with defaults"** to test gameplay without Bedrock or
sign-in. To exercise the API locally, pass overrides:
`http://localhost:8080/?api=<ApiEndpoint>&userPoolId=...&clientId=...&domain=...`

## API

| Method | Path                         | Auth | Description                                  |
|--------|------------------------------|------|----------------------------------------------|
| GET    | `/api/health`                | —    | Health check                                 |
| POST   | `/api/upload-url`            | JWT  | Presigned S3 PUT URL for the photo           |
| POST   | `/api/generate`              | JWT  | Quota check + async hero generation → id     |
| GET    | `/api/generate/{id}/status`  | JWT  | Steps, hero previews, asset pack (owner-only) |
| POST   | `/api/select`                | JWT  | Lock one variant (once) + async asset build  |
| GET    | `/api/scores`                | —    | Top 20 leaderboard                            |
| POST   | `/api/scores`                | JWT  | Submit a validated score                      |
| GET    | `/api/gallery`               | —    | Opted-in public AIGC creations                |

## Cost & safety notes

- Bedrock image generation is billed per image: `/generate` produces 3 hero images
  (plus background-removal calls); selecting produces 3 more (enemy, bullet, background)
  for the chosen style only.
- **Per-user daily quota** (default 10/day) is enforced atomically in DynamoDB.
- Raw uploads auto-expire after **7 days**; unfinished generations have a 30-day TTL.
- All S3 buckets block public access; assets are served via CloudFront OAI / presigned URLs.
- The API is protected by a Cognito JWT authorizer; only the leaderboard and gallery
  reads are public. The gallery only ever shows creations where `allowGallery === true`.

## Future upgrade path

The async generation runs in a single worker Lambda (simple, fully covered by polling).
For parallel asset generation and declarative retries, this can be migrated to a
**Step Functions Express workflow** with a `Map`/`Parallel` state — see `ARCHITECTURE.md`.

## License

[MIT](./LICENSE) © 2026 lubao
