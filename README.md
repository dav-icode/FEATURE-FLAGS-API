# 🚩 Feature Flags API

A production-ready **Feature Flags** service built with NestJS, PostgreSQL, and Redis.  
Ships flags to users without redeploying. Roll out features gradually. Kill switches in seconds.

---

## ✨ Features

| Feature | Details |
|---|---|
| **4 Rule Types** | User list, percentage rollout, environment, schedule |
| **Deterministic Rollout** | Same user always lands in the same bucket (djb2 hash) |
| **Redis Cache** | Evaluations cached with configurable TTL; auto-invalidated on changes |
| **Bulk Evaluation** | Evaluate up to 50 flags in a single request (SDK-friendly) |
| **Scoped API Keys** | `flags:read`, `flags:write`, `evaluate`, `audit:read` |
| **Secure Key Storage** | Keys hashed with bcrypt (cost 12); raw key returned once only |
| **Audit Log** | Immutable history of every flag change with before/after snapshots |
| **Kill Switch** | `PATCH /flags/:key/toggle` disables globally — no deploy required |
| **Swagger UI** | Auto-generated API docs at `/docs` |
| **Input Validation** | class-validator + whitelist strips unknown fields |
| **Env Validation** | Joi schema — app refuses to start with bad config |

---

## 🏗 Architecture

```
src/
├── config/           # Typed env config + Joi validation schema
├── prisma/           # PrismaService (lifecycle-aware DB client)
├── redis/            # RedisService (cache helpers, pattern invalidation)
├── common/
│   ├── guards/       # ApiKeyGuard — prefix lookup + bcrypt compare
│   ├── decorators/   # @RequiresPermissions, @CurrentApiKey
│   ├── filters/      # GlobalExceptionFilter — consistent error envelopes
│   └── interceptors/ # LoggingInterceptor — method/path/status/duration
└── modules/
    ├── flags/        # CRUD + rule management + cache invalidation
    ├── evaluation/   # Core evaluation engine + bulk endpoint
    ├── auth/         # API key creation and revocation
    └── audit/        # Immutable change history
```

### Evaluation Algorithm

```
evaluate(flagKey, { userId, environment })
  │
  ├─ Redis cache hit? → return cached result (reason: CACHED)
  │
  ├─ flag.enabled = false → { enabled: false, reason: FLAG_DISABLED }
  │
  ├─ no rules → { enabled: true, reason: NO_RULES }
  │
  └─ rules sorted by priority (desc):
       ├─ USER_LIST   → userId in list?
       ├─ PERCENTAGE  → djb2(flagKey:userId) % 100 < percentage?
       ├─ ENVIRONMENT → environment in list?
       └─ SCHEDULE    → now >= enableAt && now < disableAt?
           │
           first match wins → cache result → return
           no match → { enabled: false, reason: NO_RULE_MATCHED }
```

### API Key Security Model

```
create()                      verify()
────────                      ────────
rawKey = "ff_<uuid>"          prefix = key[0:8]
prefix = rawKey[0:8]          candidates = DB.where(prefix)  ← fast index scan
hash   = bcrypt(rawKey, 12)   for c in candidates:
store  → { prefix, hash }       if bcrypt.compare(key, c.hash) → match
return rawKey  ← once only    check: enabled, expiresAt, permissions
```

---

## 🚀 Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 20+ (for local development)

### 1. Clone & configure

```bash
git clone https://github.com/dav-icode/feature-flags-api.git
cd feature-flags-api
cp .env.example .env
# Edit .env and set strong passwords for POSTGRES_PASSWORD and REDIS_PASSWORD
```

### 2. Start infrastructure

```bash
docker-compose up postgres redis -d
```

### 3. Install dependencies & run migrations

```bash
npm install
npx prisma migrate dev --name init
```

### 4. Seed the database (creates your first API key)

```bash
npx ts-node prisma/seed.ts
```

Copy the API key printed in the terminal — it won't be shown again.

### 5. Start the API

```bash
npm run start:dev
```

API: `http://localhost:3000/api/v1`  
Swagger: `http://localhost:3000/docs`

---

## 🧪 Testing

### Run unit tests

```bash
npm test
```

### Run with coverage

```bash
npm run test:cov
```

### Manual tests with curl

```bash
# Set your key from the seed step
export API_KEY="ff_your_key_here"
export BASE="http://localhost:3000/api/v1"

# ── 1. Create a flag ──────────────────────────────────────────────────────────
curl -s -X POST "$BASE/flags" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "new-checkout-flow",
    "name": "New Checkout Flow",
    "description": "Refactored checkout with 1-click payment",
    "enabled": true
  }' | jq

# ── 2. Add a percentage rollout rule ─────────────────────────────────────────
curl -s -X POST "$BASE/flags/new-checkout-flow/rules" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "PERCENTAGE",
    "value": { "percentage": 10 },
    "priority": 5
  }' | jq

# ── 3. Evaluate for a user ────────────────────────────────────────────────────
curl -s -X POST "$BASE/evaluate/new-checkout-flow" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc123",
    "environment": "production"
  }' | jq
# → { "flagKey": "new-checkout-flow", "enabled": true/false, "reason": "RULE_PERCENTAGE" }

# ── 4. Bulk evaluate (SDK bootstrap) ─────────────────────────────────────────
curl -s -X POST "$BASE/evaluate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_abc123",
    "environment": "production",
    "flagKeys": ["new-checkout-flow", "dark-mode", "beta-dashboard"]
  }' | jq

# ── 5. Kill switch — disable instantly, no deploy ────────────────────────────
curl -s -X PATCH "$BASE/flags/new-checkout-flow/toggle" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }' | jq

# ── 6. Audit log ──────────────────────────────────────────────────────────────
curl -s "$BASE/audit" \
  -H "Authorization: Bearer $API_KEY" | jq

# ── 7. Create a read-only API key for the SDK ────────────────────────────────
curl -s -X POST "$BASE/auth/keys" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production SDK Key",
    "permissions": ["evaluate"]
  }' | jq
```

---

## 📦 How to integrate in NestJS (client-side example)

```typescript
// feature-flags.service.ts — minimal SDK wrapper
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async isEnabled(
    flagKey: string,
    ctx: { userId: string; environment: string },
  ): Promise<boolean> {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `${this.config.get('FEATURE_FLAGS_URL')}/evaluate/${flagKey}`,
          ctx,
          { headers: { Authorization: `Bearer ${this.config.get('FEATURE_FLAGS_KEY')}` } },
        ),
      );
      return data.enabled;
    } catch {
      // Fail safe: unknown = disabled
      return false;
    }
  }
}

// Usage in any service or controller:
const isNewFlow = await this.featureFlags.isEnabled('new-sap-integration', {
  userId: cliente.id,
  environment: process.env.NODE_ENV,
});

if (isNewFlow) {
  return this.newIntegration.process(event);
} else {
  return this.legacyIntegration.process(event);
}
```

---

## 🔒 Security Checklist

- [x] API keys hashed with bcrypt (cost factor 12) — raw key never stored
- [x] Prefix-based lookup prevents full table scans during auth
- [x] Scoped permissions per key (`flags:read`, `flags:write`, `evaluate`, `audit:read`)
- [x] Expiring keys with `expiresAt`
- [x] Immediate revocation via `DELETE /auth/keys/:id`
- [x] Helmet HTTP security headers
- [x] Rate limiting (100 req/min per IP)
- [x] CORS allowlist
- [x] Global validation pipe with `whitelist: true` (strips unknown fields)
- [x] Env validation at startup (Joi) — app won't start with missing config
- [x] Stack traces hidden in production error responses

---

## 🛣 Roadmap

- [ ] TypeScript SDK (npm package with local cache + background sync)
- [ ] Admin dashboard (Next.js + flag visualizer)
- [ ] Webhook notifications on flag changes
- [ ] A/B testing metrics integration

---

## 🧑‍💻 Tech Stack

`NestJS 10` · `TypeScript 5` · `PostgreSQL 16` · `Prisma 5` · `Redis 7` · `ioredis` · `bcryptjs` · `Helmet` · `Swagger`

---

## License

MIT
