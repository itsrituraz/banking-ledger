# Banking Ledger

A full-stack transaction processing system built with Node.js, Express, MongoDB Atlas, and React, implementing double-entry ledger accounting, concurrency-safe transfers, idempotency deduplication, rule-based risk screening, immutable audit trails, and administrative monitoring.

---

## Why I Built This

Most tutorial applications implement money transfers by directly mutating account rows:
```javascript
// The dangerous naive pattern
sender.balance -= amount;
receiver.balance += amount;
```
In real-world financial systems, this approach causes critical failures:
1. **Double-Spend Races:** If two concurrent transfer requests arrive at the same millisecond, uncoordinated reads will approve both, driving the account balance into the negative.
2. **Network Timeouts & Duplicate Charging:** When network drops occur after a debit executes but before the client receives the response, retrying the request without idempotency debits the customer twice.
3. **No Audit Ground Truth:** Overwriting a balance number makes it impossible to mathematically reconcile *how* an account reached its balance, or prove whether money was lost or fabricated.
4. **Fraud & Velocity Blindness:** High-volume automated transfers or unfamiliar recipients proceed without inspection unless a risk evaluation layer intercepts the request.

I built this platform to demonstrate how to solve these concurrency, consistency, and fraud challenges using software engineering principles and database-level transactional primitives.

---

## Core Features

### 1. Financial Integrity & Double-Entry Accounting
* **Zero Mutable Balance Columns:** Accounts do not store a static `balance` field. Account balances are dynamically derived from atomic debit and credit ledger pairs.
* **Double-Entry Invariant:** Every transfer produces exactly two immutable ledger records: one `DEBIT` on the sender and one `CREDIT` on the receiver ($\sum \text{Credits} - \sum \text{Debits} = 0$).
* **ACID Transactions:** Transfers execute within MongoDB multi-document transactions using WiredTiger snapshots. If any step fails, all operations roll back completely.

### 2. Concurrency & Double-Spend Protection
* **Document Write-Locks:** Inside the transaction boundary, an atomic version increment (`$inc: { __v: 1 }`) on the sender's account document forces WiredTiger to acquire an exclusive document write-lock.
* **Serialized Execution:** Concurrent requests from the same sender are serialized at the lock, re-evaluating derived balance only after prior transactions commit.

### 3. Idempotency & Deduplication
* **Cryptographic Keys:** Clients supply a unique `Idempotency-Key` header with each transfer.
* **Hardware Deduplication:** A unique B-tree index on `{ idempotencyKey: 1 }` prevents duplicate records at the database engine level.
* **Cached Safe Replay:** Re-submitting an identical request returns the cached transaction response with HTTP 200 without creating duplicate ledger records.

### 4. Deterministic Risk & Fraud Engine
* **Pre-Transaction Screening:** Transfers pass through a 4-dimension heuristic scoring engine before database sessions are initiated.
* **Weighted Rules:** Evaluates transfer amount, beneficiary history (first-time recipient), transaction velocity (last 5 minutes), and account maturity.
* **Tiered Action Thresholds:** 0–29 `APPROVED`, 30–59 `FLAGGED`, 60–79 `MANUAL_REVIEW` (blocked), 80–100 `BLOCKED` (rejected with HTTP 403).

### 5. Role-Based Access Control & Admin Monitoring
* **Server-Side RBAC:** Strict separation of privileges between `USER` and `ADMIN` roles enforced via server-side middleware (`adminMiddleware`).
* **Operational Dashboard:** Real-time metrics covering system volume, completed/failed transfers, flagged transactions, and user directory monitoring.

### 6. Immutable Audit Trail & Observability
* **Append-Only Store:** Mongoose pre-hooks throw runtime errors on any attempt to update or delete audit records.
* **Request Correlation:** Every incoming request receives an `X-Request-Id` UUID tracked across operational JSON logs and database audit entries.
* **PII & Secret Sanitization:** Deep recursive log sanitizer redacts 13 sensitive key patterns (`password`, `token`, `jwt`, `secret`, `cookie`, `authorization`, etc.).

### 7. Automated Testing
* **91 Automated Tests:** Verified across 9 dedicated test suites against a live MongoDB Atlas replica set with 100% pass rate.

---

## Architecture Overview

The system is structured as a decoupled client-server architecture with an Express.js API gateway, domain service layer, and MongoDB Atlas replica set with WiredTiger storage.

```
React 19 Frontend (Vite)
       │
       ▼ (HTTPS / JSON)
Express.js API Layer
       │── Security Headers (Helmet) & CORS Validation
       │── Layered Rate Limiters (Auth, Transactions, Admin, Global)
       │── Request Correlation & Structured Logging Middleware
       │── Dual Authentication (JWT via HTTP-Only Cookies + Bearer Header)
       │── Server-Side RBAC (adminMiddleware)
       │
       ▼
Domain Subsystem
       │── Deterministic Risk & Fraud Engine (Heuristic Scoring)
       │── Transaction Orchestration Controller
       │── Double-Entry Ledger Invariant Engine
       │── Immutable Audit Trail Service
       │
       ▼
MongoDB Atlas Replica Set (WiredTiger)
       │── Multi-Document ACID Transactions
       │── Document Write-Locks ($inc: __v)
       │── Unique Constraints & Covered Indexes (docsExamined: 0)
       └── Immutability Hooks (Block update/delete mutations)
```

For complete sequence diagrams, entity-relationship models, and lifecycle charts, see **[Architecture Documentation](docs/architecture.md)**.

---

## Transaction Lifecycle

When a client initiates a transfer via `POST /api/transactions`:

1. **Request Validation:** Validates field presence, verifies `amount > 0`, and rejects self-transfers (`fromAccount !== toAccount`).
2. **Authentication:** Extracts JWT from cookie or Bearer header; verifies signature and ensures token is not blacklisted.
3. **Account Pre-Checks:** Executes parallel queries for `fromAccount` and `toAccount` to verify sender ownership and `ACTIVE` status.
4. **Idempotency Pre-Check:** Checks if `idempotencyKey` already exists. If completed, immediately returns the cached transaction.
5. **Risk Screening:** Evaluates the 4 heuristic rules. If score $\ge 60$ (`MANUAL_REVIEW` or `BLOCKED`), records a `FAILED` transaction, logs an audit event, and returns HTTP 403 without touching account balances.
6. **MongoDB Session Start:** Begins an isolated multi-document ACID transaction.
7. **Document Write-Lock:** Increments `__v` on the sender's account document, acquiring an exclusive document write-lock in WiredTiger.
8. **Balance Derivation:** Computes $\sum \text{Credits} - \sum \text{Debits}$ from the ledger inside the transaction. If balance < amount, rolls back and returns HTTP 400.
9. **Ledger Entries:** Inserts the `transaction` (PENDING), creates a `DEBIT` ledger entry for the sender, and creates a `CREDIT` ledger entry for the receiver.
10. **Commit:** Marks transaction `COMPLETED` and commits the MongoDB session.
11. **Audit & Notification:** Asynchronously logs an immutable audit event and dispatches best-effort notification.

---

## Deterministic Risk & Fraud Rules

The risk engine uses transparent heuristic rules rather than a black-box machine learning model:

| Rule Code | Trigger Condition | Score Points | Resulting Action |
| :--- | :--- | :---: | :--- |
| `HIGH_TRANSACTION_AMOUNT` | Transfer amount $\ge ₹10,000$ | +20 | Score accumulates toward review |
| `VERY_HIGH_TRANSACTION_AMOUNT` | Transfer amount $\ge ₹50,000$ | +35 | Escalates toward manual review |
| `FIRST_TIME_BENEFICIARY` | Sender has never transferred to this receiver | +20 | Signals potential account takeover |
| `TRANSACTION_VELOCITY` | $\ge 3$ transfers in the last 5 minutes | +20 | Flags rapid automated draining |
| `VERY_HIGH_VELOCITY` | $\ge 5$ transfers in the last 5 minutes | +40 | Triggers near-certain block threshold |
| `NEW_ACCOUNT_HIGH_VALUE` | Account age $< 24$ hours AND amount $\ge ₹5,000$ | +10 | Flags burner account behavior |

**Score Ranges:**
* **0–29 (`APPROVED`):** Transfer processed automatically.
* **30–59 (`FLAGGED`):** Transfer processed, but flagged in the Admin Dashboard for auditing.
* **60–79 (`MANUAL_REVIEW`):** Transfer halted, HTTP 403 returned, pending administrative verification.
* **80–100 (`BLOCKED`):** Transfer rejected outright, HTTP 403 returned.

---

## Security Architecture

| Security Layer | Implementation Details |
| :--- | :--- |
| **Authentication** | 256-bit signed JWT with 3-day expiration; dual transport via HTTP-Only Secure cookies and Bearer headers. |
| **Token Revocation** | Dedicated `token_blacklists` collection with TTL indexing; checked on every authenticated request. |
| **Authorization** | Strict server-side RBAC (`adminMiddleware`) evaluating verified database identity. |
| **Rate Limiting** | Tiered `express-rate-limit`: Auth (20 req / 15m), Transactions (60 req / 1m), Admin (120 req / 1m), Global (1000 req / 15m). |
| **HTTP Hardening** | Helmet headers (`nosniff`, `frameguard`, DNS prefetch control) and dynamic CORS origin validation. |
| **Payload Protection** | Body parser capped at 50kb (`limit: "50kb"`); oversized requests rejected with HTTP 413. |
| **Information Disclosure** | Centralized error handler captures stack traces server-side while returning generic envelopes to clients. |

For the full security audit and threat mitigation matrix, see **[Security Architecture](docs/SECURITY.md)**.

---

## Automated Test Catalog (91 / 91 Tests Passing)

The test suite executes against live MongoDB Atlas replica set connections:

| Suite # | Suite Name | Tests | Focus Area |
| :---: | :--- | :---: | :--- |
| 1 | **Risk & Fraud Engine Suite** | 10 / 10 | Heuristic rules, score caps, automated blocking |
| 2 | **Admin RBAC Security Suite** | 7 / 7 | Role enforcement, privilege escalation prevention |
| 3 | **Admin Read-Only Monitoring Suite** | 10 / 10 | Dashboard statistics, filtered queries, pagination |
| 4 | **Immutable Audit Trail Suite** | 10 / 10 | Event logging, correlation IDs, update/delete rejection |
| 5 | **Rate Limiting & Security Suite** | 12 / 12 | 429 throttling, CORS, Helmet headers, payload bounds |
| 6 | **Observability & Logging Suite** | 10 / 10 | Structured JSON, duration telemetry, sensitive data redaction |
| 7 | **API Documentation & Contract Suite** | 10 / 10 | OpenAPI response schema verification, envelope validation |
| 8 | **Database & Performance Suite** | 10 / 10 | Covered index verification, zero in-memory sorting, balance invariant |
| 9 | **Production Smoke Suite** | 12 / 12 | Liveness/readiness probes, double-spend concurrency, idempotency |
| **Total** | **Consolidated Master Suite** | **91 / 91** | **100% Pass Rate Across All Suites** |

For the detailed test catalog and test breakdown, see **[Testing Documentation](docs/TESTING.md)**.

---

## Tech Stack

* **Backend:** Node.js, Express 5, Mongoose 9, jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, nodemailer
* **Frontend:** React 19, Vite 8, Redux Toolkit, React Router 7, Tailwind CSS, Lucide Icons
* **Database:** MongoDB Atlas (Replica Set with WiredTiger storage engine)
* **API Documentation:** OpenAPI 3.0.3, Swagger UI
* **Deployment Blueprint:** Render (`render.yaml` with web service and static site)

---

## Local Development & Setup

### 1. Prerequisites
* Node.js v18 or higher
* Active MongoDB Atlas cluster or local replica set (ACID transactions require replica sets)

### 2. Backend Setup
```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env and supply your MONGO_URI, JWT_SECRET, and FRONTEND_URL

# Start the server (default port: 3000)
node server.js
```

### 3. Frontend Setup
```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start Vite development server (default port: 5173)
npm run dev
```

### 4. Running Tests
```bash
# Run all 91 automated tests across all 9 suites
node backend/tests/run_all_37_tests.js
```

---

## Engineering Decisions

1. **Why MongoDB transactions over SQL?**
   MongoDB replica sets with WiredTiger snapshots provide multi-document ACID transactions while allowing flexible metadata schemas for transactions, audit trails, and risk evaluations without schema migrations.
2. **Why double-entry ledger over balance column?**
   Derived balances eliminate drift, enforce $\sum \text{Credits} - \sum \text{Debits} = 0$, and create an indisputable historical audit record.
3. **Why document write-locks over optimistic concurrency?**
   Optimistic concurrency (e.g. version checking at write time) causes high abort rates under heavy concurrent contention. A document write-lock queues concurrent debits cleanly, ensuring deterministic execution.
4. **Why in-memory rate limiting and no Redis?**
   To keep the infrastructure minimal and eliminate external dependency failures during early deployment. Rate limiters are implemented natively in Express.
5. **Why rule-based risk over machine learning?**
   Deterministic rules provide instant auditability, exact reason codes, and zero cold-start latency, satisfying regulatory explainability requirements.

---

## Known Limitations

* **In-Memory Rate Limiting:** Rate limit counters are tracked in Node.js process memory. In a multi-instance container deployment, limits apply per instance unless backed by a centralized store like Redis.
* **Deterministic Fraud Heuristics:** The fraud engine relies on static weighted rules. It does not learn or detect complex coordinated fraud rings across unrelated accounts.
* **Offset Pagination:** Administrative queries use `skip()` and `limit()`. While fully indexed, deep pagination ($>10,000$ pages) has $O(N)$ index-walking costs compared to keyset pagination.
* **Internal Ledger Only:** The platform models an internal double-entry banking ledger and does not interface with external banking rails (SWIFT, ACH, UPI).

---

## Future Improvements (Not Implemented)

* [ ] **Distributed Rate Limiting:** Redis-backed sliding window limiter for horizontal multi-instance scaling.
* [ ] **Cursor / Keyset Pagination:** `lastId` / `lastCreatedAt` pagination for constant-time $O(1)$ deep log browsing.
* [ ] **Prometheus Metrics:** Standard `/metrics` endpoint exporting HTTP request duration histograms and database connection pool gauges.
* [ ] **Webhook System:** HMAC-signed webhook dispatch for transaction lifecycle events (`TRANSACTION_COMPLETED`, `TRANSACTION_FLAGGED`).

---

## Documentation Index

* 📖 **[Developer API Guide](backend/docs/API.md)** — Comprehensive API reference and error codes.
* 📐 **[OpenAPI 3.0.3 Contract](backend/docs/openapi.yaml)** — Machine-readable OpenAPI specification.
* 🏛️ **[System Architecture](docs/architecture.md)** — Architectural diagrams, data flows, and sequence charts.
* 🛡️ **[Security Architecture](docs/SECURITY.md)** — Defensive model, threat mitigations, and controls.
* 🧪 **[Testing Architecture](docs/TESTING.md)** — Test catalog, test cases, and execution guide.
* 🗄️ **[Database Architecture](docs/DATABASE.md)** — Schema definitions, indexing strategy, and ER diagram.
* 💼 **[Recruiter Project Summary](docs/PROJECT_SUMMARY.md)** — Resume bullets and 30-second technical pitch.
* 🎯 **[Interview Preparation Guide](docs/INTERVIEW_PREP.md)** — 20 deep-dive questions and code-accurate answers.
* 🚀 **[Production Deployment Checklist](docs/PRODUCTION_CHECKLIST.md)** — Pre-flight operational readiness checklist.
