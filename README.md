# HCM Lite - AI-assisted Human Capital Management (Saylani Hackathon)

Admin / HR / Employee web app: first-run setup, employees (auto-created logins), attendance (web + optional camera/GPS), leave,
payroll with tax slabs and payslips, dashboards, AI assistant (tool calling), announcements, notifications and an immutable audit log.
**The database starts empty. There are no default accounts, no demo data and no demo buttons.**

> See the "Not done / not verified" section below.

## Stack
React 19 + Vite + Tailwind (frontend) - Node 22 + Express + TypeScript (backend, `tsx`) - SQLite via Node's built-in `node:sqlite`
(WAL, transactional writes) - JWT + bcrypt (cost 12) - Google Gemini via `@google/genai` for tool calling - jsPDF payslips (client side).

## Run locally (under 10 minutes)
```bash
node -v            # must be >= 22.13
cp .env.example .env
npm install
npm run dev        # http://localhost:3000  -> opens the First-Run Setup wizard
```
Production: `npm run build && npm start`.

## First run
1. Open the app. On an empty database you get the two-step wizard: **Company** (name, email, address, office start, grace, weekend, office lat/lng, radius) then **Admin** (name, work email, password + confirmation).
2. The wizard works exactly once. After an Admin exists `POST /api/system/setup` returns 403. Concurrent first requests cannot create two Admins.
3. Admin -> Users: create an HR login (a random temporary password is shown once; must be changed on first sign-in).
4. HR -> Employees: register an employee. This creates the employee record, unique code, login and a **random temporary password shown once to HR** (hand it over securely). The employee is forced to change it on first login; until then every API except change-password/me returns 403 `PASSWORD_CHANGE_REQUIRED`.
5. Forgot password: login screen -> "Forgot password?" -> request. No email service is bundled, so a one-time code (10 hex chars, 30 min, single use, stored hashed) is delivered as an in-app notification to Admins, who relay it to the user. Set `RESET_CODE_TO_CONSOLE=true` for local development to also print it.

## AI assistant
Set `AI_API_KEY` (Gemini key) in the backend environment only. Without a key the chat still answers a few questions from the database through the same tools, but the answer is prefixed `[Rule-based answer from live database - AI provider unavailable]` and `is_ai_generated` is `false`. Limits: 15 s timeout, 20 requests/user/hour, every call logged in `ai_logs`. The model only sees tool results; tools run with the caller's role and scope.

## Database
SQLite file at `$DATA_DIR/hcm.sqlite` (default `./data`). Collections are stored as one JSON row each in table `collections`; `save()` writes only changed collections inside a single `BEGIN IMMEDIATE ... COMMIT` transaction. Mutating requests are serialised by an in-process mutex and in-memory state is reloaded (rolled back) if a request fails with 5xx. **Single server instance only.** No migrations are needed; the table is created on boot. Back up by copying the file (use `sqlite3 .backup` while running).

## Deployment
* **Docker / Render:** `Dockerfile` and `render.yaml` included. Mount a persistent disk at `/data` (`DATA_DIR=/data`). Free tiers without a disk lose data on redeploy.
* **Railway / Fly / VPS:** `npm ci && npm run build && npm start` with a persistent volume for `DATA_DIR`; set `AI_API_KEY`, `OFFICE_TZ`, optionally `JWT_SECRET`. Terminate TLS at the platform (the app sets `trust proxy`).
* The deployed fresh database must open on the First-Run Setup screen.

## Security summary
RBAC and employee data-scope are enforced in the backend (`requireRole`, `enforceDataScope`, per-route filters). bcrypt cost 12; JWT 8 h with a random per-installation secret (no hardcoded key); login throttling (8/15 min per email), reset throttling; forced first-login password change; deactivated/resigned employees cannot sign in; finalized payroll is locked; audit log is append-only with a SHA-256 hash chain (`GET /api/audit-logs/verify`) and `PATCH/PUT/DELETE /api/audit-logs/:id` return 405; AI key only on the backend.

## Role matrix (server enforced)
| Capability | Admin | HR | Employee |
|---|---|---|---|
| Setup, settings, departments, designations, holidays, create HR, deactivate/reset logins | yes | - | - |
| Register/edit employees, CSV import, salary | view | manage | own phone/address |
| Attendance board, corrections approve | view | approve | own, request |
| Leave approve/reject | view | approve | apply/cancel own |
| Payroll draft | view | manage | - |
| **Finalize payroll** | yes | - | - |
| Payslips | all | all | own |
| Audit log | view | - | - |
| AI | all data | HR data | own data |

## API (all under `/api`, JSON, Bearer JWT unless noted)
`GET system/status`, `POST system/setup` (once) - `POST auth/login`, `auth/change-password`, `auth/forgot-password`, `auth/reset-password`, `GET auth/me` - `GET/PUT settings` - `GET/POST organization/{departments,designations,holidays}` - `GET users`, `POST users/hr`, `PATCH users/:id/status`, `POST users/:id/reset-password` - `GET/POST employees`, `GET employees/:id/360`, `PATCH employees/:id`, `POST employees/csv-import/{dry-run,commit}` - `POST attendance/{check-in,check-out}`, `GET attendance`, `GET/POST attendance/corrections`, `PATCH attendance/corrections/:id` - `GET leaves`, `GET leaves/balance`, `POST leaves`, `PATCH leaves/:id/{cancel,decision}` - `GET payroll/runs`, `POST payroll/{draft,finalize}`, `GET payroll/payslips` - `GET analytics/{admin,hr,employee}` - `POST ai/{chat,dashboard-summary,smart-leave}` - `GET/POST announcements`, `GET notifications`, `PATCH notifications/:id/read` - `GET audit-logs`, `GET audit-logs/verify`.
Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404, 405 immutable, 409 duplicate check-in / already decided, 422 leave/camera rule violations, 429 throttled.

## Tests
`npm run test:unit` (18, executed) and `npm test` (adds the 16 HTTP workflows).

## Not done / not verified (explicit)
* HTTP workflow tests (16) are written but **not executed**; frontend was never built or opened in a browser in the authoring sandbox; no frontend (React) tests; `tsc --noEmit` not run.
* Database is SQLite document-per-collection, **not PostgreSQL/Prisma**, not normalised: no foreign keys or migrations. Fine for one instance, not for horizontal scaling.
* No server-side payslip PDF endpoint: PDFs are generated in the browser (jsPDF); the server only returns scoped payslip data.
* Password reset has no email/SMS delivery (Admin relays the code).
* AI: real Gemini path and tool-permission behaviour verified by code review only, not by an executed test; Roman Urdu understanding not verified; only Gemini is supported.
* Input validation is hand-written (no Zod); no server-side logout/JWT revocation (stateless 8 h tokens); rate limits are in-memory.
* Leave types/quotas are settings fields, not a separate `leave_types` table; Admin full name is stored in settings, not on the user row.
* Current-month payroll drafts count not-yet-elapsed working days as absent - run payroll after month end.
* Camera attendance (face-api, GPS, enrolment, liveness) exists in the repo; server rules are unit-tested, the browser camera flow is untested. CSV export and dark-mode/PWA bonuses are unverified.


---

## Face recognition attendance (HCM Lite 2.0)

**How it works**
- Browser: `@vladmandic/face-api` (TensorFlow.js) with the pretrained TinyFaceDetector, 68-point landmark net and FaceRecognitionNet. Model files ship inside the npm package and are copied to `/models` by `scripts/copy-models.mjs` (runs on `npm run build` / `npm run dev`).
- Enrollment (`/api/face/enroll`): employee must be logged in, give consent, capture 4 quality-checked samples (front, both sides, front) and blink once. Server checks the samples belong to one person and stores them **AES-256-GCM encrypted** in the `face_templates` collection. No photos are stored.
- Check-in (`/api/attendance/check-in`, `source: camera`): the server issues a single-use challenge (`/api/attendance/challenge`), the browser sends a fresh 128-number descriptor + blink flag + GPS, and the **server** compares the descriptor to the authenticated employee's template (threshold `FACE_MATCH_THRESHOLD`, default 0.5), applies the GPS accuracy (<=100 m) and Haversine geofence rules, and writes at most one record per day. The employee ID always comes from the login token.
- Admin setting `require_face_attendance` (default on) disables plain web check-in. HR/Admin can delete a template (`DELETE /api/face/:employeeId`, "Reset" in the employee list).
- Old fake enrollments (8-number descriptors from earlier builds) are invalidated automatically at startup; those employees must enroll again.

**Limitations (be honest at the demo)**
- Blink liveness stops a plain still photo in many cases but NOT a replayed video, a mask or a determined attacker. It is not biometric-grade anti-spoofing.
- The descriptor is computed in the browser. A modified client that obtains a victim's descriptor could replay it (the nonce limits replay of one request, not forgery of a new one). Server-side re-detection on an uploaded frame is the next hardening step.
- The match threshold and the image-quality limits (`src/lib/face-engine.ts`) are reasonable defaults, not values validated on your population. Test with real employees and tune.
- Camera and GPS require HTTPS (SnapDeploy provides it) or `localhost`.

**Backup before upgrading an existing deployment:** copy `DATA_DIR/hcm.sqlite*` (all three files: `.sqlite`, `-wal`, `-shm`) somewhere safe. The upgrade only adds a `face_templates` collection and clears legacy fake face flags; nothing else is deleted.
