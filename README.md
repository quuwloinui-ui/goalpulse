# GoalPulse

Live football scores, match schedules, standings and curated stream sources: a Flutter app, a Node.js API with a Socket.IO live engine, and a web admin panel.

> **Status.** The backend and admin panel pass 36 automated tests here, and `backend/scripts/smoke.js` (33 end-to-end checks) plus the GitHub Actions workflow verify the whole stack against real Postgres and Redis. I could not run those two in my sandbox (no network), so run them once. The Flutter app has **not been compiled yet**: the CI workflow does that for you (`flutter analyze` plus an APK build), so expect to fix the odd lint or version nit. Real API-Football behaviour (live events, quota headers) and Firebase delivery are untested.

---

## 1. Architecture

```
 Flutter app (Riverpod)
   REST (Dio) ─────────── Socket.IO ─────────── FCM topics
        │                     │                      ▲
┌───────▼─────────────────────▼───────────┐   ┌──────┴────────────────┐
│ Express API         Socket.IO gateway   │   │ Firebase Cloud        │
│ /api/v1/*           (Redis adapter)     │   │ Messaging             │
│ /admin (control room)                   │   └──────▲────────────────┘
│        │ cache-aside      ▲ emits       │          │ 1 condition per event
│        ▼                  │             │          │
│      Redis  ◄──────  LiveUpdater ───────┼──────────┘
│  (cache, live state,   (leader-elected, │
│   rate limits, quota)   polls 1x / 30 s)│
└───────┬─────────────────────┬───────────┘
        │                     │
   PostgreSQL        Provider adapter ──► API-Football  |  Mock (no key needed)
 users · favourites · stream links · banners · flags · news · push log
```

Why it scales and stays inside API quotas:

* **One upstream call per cycle, not per user.** Exactly one instance (Redis-elected leader) polls the provider's *live* endpoint every 30 s, only while a match is live or about to kick off.
* **Everything else is cached** in Redis (cache-aside, request coalescing, stale-if-error). Cache keys use **UTC dates**, so users in every timezone share the same entries; the server slices out the client's *local* day.
* **Live state is overlaid** on cached fixture lists (`fx:state:{id}`), so REST responses are fresh even though the day list is cached for minutes.
* **Push uses FCM topics.** A device follows `team_{id}` / `match_{id}`; one FCM *condition* per event reaches every interested device exactly once. No token fan-out on our side.

## 2. Project structure

```
goalpulse/
├── docker-compose.yml          Postgres + Redis for local dev (profile "full" adds the API)
├── render.yaml                 Render blueprint (API + Postgres + Key Value)
├── backend/
│   ├── Dockerfile · package.json · .env.example
│   ├── prisma/schema.prisma    Users, FavoriteTeam, SavedMatch, StreamLink, Banner, FeatureFlag, News...
│   ├── prisma/seed.js
│   ├── scripts/migrate.sh      migrate deploy (or db push on the very first deploy)
│   ├── public/admin/           control room: index.html · app.js · styles.css
│   ├── test/                   node:test suites (no extra dependencies)
│   └── src/
│       ├── server.js           entry point: wiring, graceful shutdown
│       ├── app.js              Express app, helmet/CSP, health check, static admin
│       ├── config/             env (zod-validated) · leagues · feature defaults
│       ├── lib/                cache (Redis cache-aside) · prisma · redis · logger · errors
│       ├── middleware/         JWT auth · Redis rate limiter · validation · error handler
│       ├── providers/          base contract · api-football adapter + normalisers · mock
│       ├── services/           football (read model) · liveUpdater (real-time engine)
│       │                       push (FCM) · streams · config · bootstrap
│       ├── sockets/gateway.js  Socket.IO + Redis adapter, rooms, limits
│       └── routes/             matches · leagues · user · content · admin
└── mobile/
    ├── pubspec.yaml · env.example.json · analysis_options.yaml
    └── lib/
        ├── main.dart · app.dart
        ├── core/               api_client · socket_service · push_service · theme · format · config
        ├── data/               football_repository · models/ (match, standings, remote_config)
        ├── providers/          app · match (home + details) · standings · favorites   (Riverpod)
        ├── widgets/            NetImage, EmptyState, ErrorView, BannerCard
        └── features/
            ├── home/           DateStrip · filter chips · LeagueSection · MatchCard
            ├── match_details/  Overview · Lineups (pitch) · Stats · Watch + StreamPlayer (HLS / WebView)
            ├── standings/      table · top scorers · top assists
            ├── favorites/ · settings/ · shell/
```

## 3. Quick start (about 5 minutes, no API key needed)

```bash
# 1. infrastructure
docker compose up -d postgres redis

# 2. backend (Node 20+)
cd backend
cp .env.example .env          # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npx prisma migrate dev --name init    # creates prisma/migrations: commit them
npm run dev                   # http://localhost:4000  ->  /admin for the control room

# 3. tests
npm test

# 4. mobile (Flutter 3.24+)
cd ../mobile
flutter create --org com.yourco --project-name goalpulse .   # generates android/ and ios/ only
python3 tool/patch_android.py --cleartext                   # permissions, desugaring, minSdk 23 (--cleartext: local http only)
flutter pub get
cp env.example.json env.json                                 # API_BASE_URL (10.0.2.2 = Android emulator host)
flutter run --dart-define-from-file=env.json
```

`FOOTBALL_PROVIDER=mock` (the default) simulates 16 matches per day, always with something live, so scores, minutes, goals and push dry-runs all move without a key. Switch to real data with `FOOTBALL_PROVIDER=apifootball` and `API_FOOTBALL_KEY`.

## 4. REST API (`/api/v1`)

| Method | Path | Notes |
|---|---|---|
| GET | `/matches?from=ISO&to=ISO` | Matches whose kick-off is in `[from,to)`. The app sends its **local** midnight to midnight as UTC. `?date=YYYY-MM-DD` (UTC day) also works. Max 48 h. |
| GET | `/matches/live` | In-play matches |
| GET | `/matches/by-ids?ids=1,2,3` | Up to 20 (favourites tab) |
| GET | `/matches/:id` | Details: events, lineups, statistics, **streams** |
| GET | `/leagues` | Curated competition list |
| GET | `/leagues/:id/standings` · `/top-scorers` · `/top-assists` | `?season=` optional |
| GET | `/config` | Feature toggles + active banners |
| GET | `/news` | Published articles |
| POST | `/auth/device` | Anonymous device login, returns a JWT |
| GET/PUT/DELETE | `/me/favorites[/teams/:id \| /matches/:id]` | Needs the device JWT |
| POST | `/admin/login` | Admin JWT (12 h) |
| CRUD | `/admin/streams` · `/admin/banners` · `/admin/news` | Admin JWT |
| GET/PUT | `/admin/features[/:key]` | Toggle flags |
| GET/POST | `/admin/notifications` | History / send push |
| GET | `/admin/stats` | Users, live count, provider calls and quota |
| GET/POST/DELETE | `/admin/admins` | Team management (super admin only) |
| POST | `/admin/password` | Change own password (revokes all of that admin's tokens) |
| GET | `/health` | DB + Redis check |

**Normalised fixture** (identical for every provider):

```json
{ "id": 1234, "leagueId": 39, "leagueName": "Premier League", "kickoff": "2026-10-22T19:00:00.000Z",
  "status": "LIVE", "minute": 67, "home": {"id": 42, "name": "Arsenal", "logo": "..."},
  "away": {"id": 49, "name": "Chelsea", "logo": "..."}, "score": {"home": 2, "away": 1},
  "venue": "Emirates", "referee": "M. Oliver", "hasStream": true }
```
`status`: `NOT_STARTED | LIVE | HALF_TIME | FINISHED | POSTPONED | CANCELLED | SUSPENDED`.

## 5. Realtime protocol (Socket.IO)

| Direction | Event | Payload |
|---|---|---|
| client → server | `live:subscribe` / `live:unsubscribe` | joins room `live` (home list) |
| client → server | `match:subscribe` / `match:unsubscribe` | `{ "id": 1234 }` (max 10 rooms per socket) |
| server → client | `live:update` | `{ matches: [{ id, status, minute, score }] }` batched per poll |
| server → client | `match:update` | `{ id, status, minute, score, events: [...] , refresh? }` |

The home list patches itself from `live:update`; the match screen re-fetches from the cached REST endpoint the moment `match:update` arrives (goal, card, new stream source added in the admin panel).

## 6. Push notifications

Topics: `all` (announcements), `team_{id}`, `match_{id}`. The live engine sends **kick-off, goal (with scorer when known), red card, half-time and full-time**, de-duplicated with a Redis `NX` key so restarts never double-send. Tapping a notification opens the match (`data.fixtureId`). Without Firebase credentials the server runs in dry-run mode: messages are logged and recorded in the admin history.

## 7. Admin control room (`/admin`)

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` (created at first start).

* **Stream links:** find a match by day, attach HLS or WebView sources with priority, quality, language and an optional expiry. Open match screens refresh instantly.
* **Notifications:** broadcast to everyone or one topic, optionally deep-linking to a match.
* **Banners and ads:** image, link, placement, priority, schedule window.
* **Feature toggles:** `streams`, `ads`, `news`, `maintenance` plus your own flags. The app re-reads config every 2 minutes.
* **Roles:** *editors* manage stream links and banners; *super admins* also send push, flip features and manage the team (**Team** tab). Everything is re-checked on every request, and a password change signs the account out everywhere.

## 8. Mobile setup details

**Firebase (push).** Create a Firebase project, add the Android and iOS apps, place `google-services.json` in `android/app/` and `GoogleService-Info.plist` in `ios/Runner/` (or run `flutterfire configure`). Create a service-account key (Project settings → Service accounts) and give it to the server: `base64 -w0 key.json` → `FIREBASE_SERVICE_ACCOUNT_BASE64`. iOS: enable *Push Notifications* and *Background Modes → Remote notifications*, and upload an APNs auth key in the Firebase console.

**Android** (`android/app/src/main/AndroidManifest.xml`):

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<!-- development against http://10.0.2.2 only; remove for release -->
<application android:usesCleartextTraffic="true" ...>
```
`flutter_local_notifications` needs core-library desugaring (`coreLibraryDesugaringEnabled true` + `desugar_jdk_libs` in `android/app/build.gradle`); `minSdkVersion 21`.

**Time zones.** Kick-off times arrive as UTC and are converted with `DateTime.toLocal()` and the device's 12/24 h setting, so there is no timezone configuration anywhere.

## 9. Deployment

### Render (fastest)
1. Push the repo to GitHub. 2. **New → Blueprint** and select it (`render.yaml` creates the web service, Postgres and Key Value). 3. Fill the prompted secrets: `API_FOOTBALL_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FIREBASE_SERVICE_ACCOUNT_BASE64`. 4. Open `https://<service>.onrender.com/admin`. Use a paid, always-on web plan: WebSockets and the live worker do not survive free-tier sleeping.

### Railway
New project → **Deploy from GitHub**, set *Root Directory* `backend` (the Dockerfile is detected). Add **PostgreSQL** and **Redis**, then in the service variables set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, `NODE_ENV=production`, `JWT_SECRET`, plus the variables below. Generate a public domain.

### AWS
ECR image → **ECS Fargate** service behind an **ALB** (HTTP/WebSocket target group, health check `/health`, idle timeout 120 s). **RDS PostgreSQL** and **ElastiCache Redis** in private subnets; security groups allow only the service. Secrets in **Secrets Manager / SSM** mapped to the task's environment. Run 2+ tasks: the Redis adapter shares Socket.IO broadcasts and leader election keeps a single poller. Clients use the `websocket` transport, so sticky sessions are not required.

### Environment variables (full template in `backend/.env.example`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` · `REDIS_URL` | yes | Postgres / Redis (`rediss://` supported) |
| `JWT_SECRET` | yes | ≥ 16 chars, e.g. `openssl rand -hex 32` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | first run | Creates the first admin |
| `FOOTBALL_PROVIDER` · `API_FOOTBALL_KEY` | for real data | `mock` or `apifootball` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | for push | Otherwise dry-run |
| `LIVE_POLL_INTERVAL_MS` | no | Default 30000 |
| `TODAY_FIXTURES_TTL_SEC` · `DAILY_QUOTA_RESERVE` | no | Cache TTL; stop polling below this quota |
| `RUN_WORKER` | no | `false` on API-only replicas |
| `CORS_ORIGINS` · `RATE_LIMIT_PER_MIN` | no | Hardening (rate limit is per device, anonymous calls per IP) |
| `TRUST_PROXY` | no | Proxies in front of the API (Render / Railway / ALB = 1) |
| `LEAGUE_IDS` | no | `default` (curated list), `all`, or ids like `39,140,2` |
| `SOCKET_MAX_CONN_PER_IP` | no | Default 100 (mobile carriers share IPs) |

### Production checklist
* Commit `prisma/migrations` (`npx prisma migrate dev --name init`) and `package-lock.json`.
* Production refuses weak secrets: use a random `JWT_SECRET` (32+ chars), a strong admin password (12+), restrict `CORS_ORIGINS` and set `TRUST_PROXY` to match your hosting.
* Pick an API-Football plan that fits your traffic (live polling is ~2,880 calls/day if a match is always on).
* Put the API behind a CDN or load balancer that supports WebSockets.
* Add Sentry (or similar) to `server.js` and uptime monitoring on `/health`.

## 10. Hardening, CI and checks

**Security**
* Logs never contain credentials (`Authorization` and cookies are redacted). Production refuses placeholder secrets.
* Roles are enforced and every admin request re-checks the account; a password change revokes that admin's tokens.
* Stream and banner URLs must be `https://`, and the app refuses to play non-HTTPS sources. Stream sources are only served to registered devices; an expired device token gets a 401 so the app silently re-registers.
* Rate limits are per **device** (verified token), not per IP, so users behind one carrier address are not throttled together. Login is limited per IP and per account. Sockets have a per-IP connection cap, a per-socket event throttle and a 10 KB payload limit.

**Performance**
* The schedule and the live engine cover a curated set of competitions (`LEAGUE_IDS`, default list in `config/leagues.js`). That replaces "every fixture in the world" with the leagues people follow, and shrinks live batches and push volume with it.
* The home list is built lazily (slivers). The safety refresh is 10 minutes; sockets do the real-time work.
* The live engine backs off exponentially (up to 5 minutes) when the provider fails and renews its leader lease within about 65 seconds.

**Checks**
* `npm test`: 36 unit and integration tests (cache, diffing, live-engine lifecycle, backoff, league filter, limits, roles, secret rules).
* `ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/smoke.js http://localhost:4000 --sockets`: 33 end-to-end checks on a running server (auth, roles, streams, flags, banners, push dry-run, password revocation, live socket).
* `.github/workflows/ci.yml` runs both on every push and then builds the Flutter app (`flutter analyze` and a release APK in the run's **Artifacts**). It is also the way to compile and check the Flutter code without installing anything locally. Set a repository variable `API_BASE_URL` for the APK.

## 11. Extending

* **Another data vendor (e.g. SportMonks):** implement the methods of `providers/base.js`, return the normalised shapes, register it in `providers/index.js`.
* **Languages / RTL (Arabic):** add `flutter_localizations` and an `l10n` set; dates already follow the device locale.
* **News screen:** the API and admin CRUD exist; add a Flutter screen against `GET /news`.

## 12. Rights and store policy

Stream links are entirely curated by you. Make sure you hold the rights to every source you add (official embeds, licensed or your own streams). Linking to unlicensed broadcasts of sports events is unlawful in many places, and Google Play and the App Store reject apps that facilitate it.
