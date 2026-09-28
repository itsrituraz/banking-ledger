# Banking Ledger & FinTech Core Engine — API Documentation & Contract Guide

This document defines the authoritative API contract, schemas, and operational semantics for the **Banking Ledger** backend platform.

---

## 1. Architectural Principles & Invariants

The backend is engineered around strict financial engineering principles:

1. **Double-Entry Ledger:**
   - Money is never "edited" on an account record.
   - Every financial movement creates **exactly two immutable ledger entries**: one `DEBIT` from the source account and one `CREDIT` to the destination account.
   - The mathematical sum of all ledger entries for any transaction is **zero** ($\Delta = 0$).
2. **Dynamic Balance Derivation:**
   - Account balances are dynamically derived inside database transactions via cumulative ledger entries ($\sum \text{CREDIT} - \sum \text{DEBIT}$).
3. **Document-Level Write-Lock Serialization:**
   - A concurrency write-lock is anchored on the sender's account document (`findOneAndUpdate` with `status: ACTIVE`) inside a MongoDB ACID transaction.
   - Prevents double-spending and ensures serializability even under 100+ concurrent requests.
4. **Deterministic Risk & Fraud Engine:**
   - Every transaction is evaluated prior to debit creation against deterministic rules: transaction velocity, high amounts (>₹150,000 / >₹500,000), first-time beneficiaries, and new account age.
   - Elevated risk transactions receive `FLAGGED`, `MANUAL_REVIEW`, or `BLOCKED` status.
5. **Cryptographic Idempotency:**
   - Every transfer requires an `idempotencyKey`.
   - Network retries or replayed requests safely return the cached completed transaction (`200 OK`) without executing a second debit.
6. **Immutable Audit Trail:**
   - A dedicated, append-only operational store records *who* did *what*, *when*, and to *which resource*.
   - Strictly decoupled from financial ledger entries.
7. **Structured Observability:**
   - All HTTP requests, transitions, risk evaluations, and ledger postings emit structured JSON logs tagged with a correlation ID (`X-Request-Id`).

---

## 2. Authentication & Authorization

### 2.1 Credentials & Tokens
- **Mechanism:** Signed JSON Web Tokens (JWT) using HMAC-SHA256 (`HS256`).
- **Token Lifetime:** 3 days (`expiresIn: "3d"`).
- **Transport:** Supported via two concurrent channels:
  1. `Authorization: Bearer <JWT>` HTTP header (standard for programmatic/mobile clients).
  2. `token` HTTP-only, SameSite=Lax cookie (standard for web browser sessions).

### 2.2 Token Revocation & Blacklisting
- Upon logout (`POST /api/auth/logout`), the token's signature is written to the `tokenBlackListModel` in MongoDB.
- Every authenticated request checks the blacklist. Revoked tokens immediately receive `401 Unauthorized`.

### 2.3 Role-Based Access Control (RBAC)
- **`USER`**: Default role for customers. Can view own accounts, initiate transactions, and inspect personal history.
- **`ADMIN`**: Privileged operational role. Can view system dashboard statistics, platform-wide transactions, elevated risk feeds, customer directories, and immutable audit logs.
- **`systemUser`**: Internal service actor account reserved for system funding deposits.

### 2.4 Status Code Semantics
- **`401 Unauthorized`**: Missing token, expired token, malformed signature, or blacklisted token.
- **`403 Forbidden`**: Valid authentication, but caller lacks required permissions (e.g., standard `USER` calling `/api/admin/*`, or attempting to spend from another user's account).

---

## 3. Rate Limiting Bounds

| Limiter Scope | Target Routes | Window | Max Requests | Exceeded Response |
| :--- | :--- | :--- | :--- | :--- |
| **Global API** | `/api/*` | 15 minutes | 1000 requests | `429 Too Many Requests` |
| **Authentication** | `/api/auth/register`, `/api/auth/login` | 15 minutes | 20 requests | `429 Too Many Requests` |
| **Transactions** | `POST /api/transactions` | 1 minute | 60 requests | `429 Too Many Requests` |
| **Admin Operations** | `/api/admin/*` | 1 minute | 120 requests | `429 Too Many Requests` |

---

## 4. API Endpoints Reference

### 4.1 Authentication APIs

#### `POST /api/auth/register` (Alias: `POST /api/auth/signup`)
- **Access:** Public (Rate limited: 20 req / 15 min)
- **Request Body:**
  ```json
  {
    "name": "Alice Johnson",
    "email": "alice@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Validation:** `name`, `email`, `password` required; email must be unique.
- **Responses:**
  - `201 Created`: User and primary bank account created. Returns user profile, account info, and token.
  - `400 Bad Request`: Missing required fields.
  - `422 Unprocessable Entity`: Email already registered.
  - `429 Too Many Requests`: Exceeded auth rate limit.

#### `POST /api/auth/login`
- **Access:** Public (Rate limited: 20 req / 15 min)
- **Request Body:**
  ```json
  {
    "email": "alice@example.com",
    "password": "StrongPassword123!"
  }
  ```
- **Responses:**
  - `200 OK`: Sets `token` cookie and returns `{ user: { _id, email, name, role }, token }`.
  - `400 Bad Request`: Missing email or password.
  - `401 Unauthorized`: Invalid email or password (`{ message: "Email or password is INVALID" }`).
  - `429 Too Many Requests`: Exceeded auth rate limit.

#### `POST /api/auth/logout`
- **Access:** Public / Authenticated
- **Behavior:** Clears `token` cookie and inserts token into blacklist.
- **Responses:**
  - `200 OK`: `{ message: "User logged out successfully" }` (idempotent).

#### `GET /api/auth/me` (Alias: `GET /api/auth/profile`)
- **Access:** Authenticated (`authMiddleware`)
- **Responses:**
  - `200 OK`: `{ user: { _id, email, name, role, systemUser } }`.
  - `401 Unauthorized`: Token missing or blacklisted.

---

### 4.2 Account APIs

#### `POST /api/accounts`
- **Access:** Authenticated (`authMiddleware`)
- **Behavior:** Provisions an additional bank account for the authenticated user with an initial derived balance of `0.00`.
- **Responses:**
  - `201 Created`: `{ account: { _id, user, status, currency, accountNumber, balance } }`.
  - `401 Unauthorized`: Token invalid.

#### `GET /api/accounts`
- **Access:** Authenticated (`authMiddleware`)
- **Responses:**
  - `200 OK`: `{ accounts: [ { _id, user, status, currency, accountNumber, name, balance } ] }`.
  - `401 Unauthorized`: Token invalid.

#### `GET /api/accounts/balance/:accountId`
- **Access:** Authenticated (`authMiddleware`)
- **Path Parameter:** `accountId` (MongoDB ObjectId). Must belong to the calling user.
- **Responses:**
  - `200 OK`: `{ accountId, accountNumber, balance }`.
  - `400 Bad Request`: Invalid ObjectId format.
  - `401 Unauthorized`: Token invalid.
  - `404 Not Found`: Account not found or unauthorized access.

---

### 4.3 Transaction APIs

#### `GET /api/transactions`
- **Access:** Authenticated (`authMiddleware`)
- **Query Parameters:**
  - `type`: Optional (`"all"`, `"credit"`, `"debit"`).
  - `limit`: Optional positive integer.
- **Responses:**
  - `200 OK`: `{ items: [...], total: 42 }`.

#### `POST /api/transactions`
- **Access:** Authenticated (`authMiddleware`, Rate limited: 60 req / 1 min)
- **Headers:** `Content-Type: application/json`, `X-Request-Id` (optional correlation ID).
- **Request Body:**
  ```json
  {
    "fromAccount": "6ab770e47da3bfa88ffa31f9",
    "toAccount": "6ab770e47da3bfa88ffa31fa",
    "amount": 1500.00,
    "idempotencyKey": "unique-client-uuid-v4"
  }
  ```
- **Validation Pipeline:**
  1. `fromAccount`, `toAccount`, `amount`, `idempotencyKey` required.
  2. `amount` must be a positive number ($> 0$).
  3. `fromAccount !== toAccount` (self-transfers rejected with `400 Bad Request`).
  4. `fromAccount` and `toAccount` must be valid 24-character hex ObjectIds.
  5. `fromAccount` must belong to caller (`req.user._id`).
  6. `fromAccount` and `toAccount` status must be `"ACTIVE"`.
  7. **Idempotency Replay:** If `idempotencyKey` was already executed, returns cached transaction with `200 OK`.
  8. **Fraud & Risk Scoring:** Evaluates velocity, amount, beneficiary history. If `BLOCKED` or `MANUAL_REVIEW`, returns `403 Forbidden`.
  9. **Balance Check:** Inside the ACID write-lock session, derived balance must be $\ge \text{amount}$. If balance is insufficient, transaction fails with `400 Bad Request`.
  10. **Ledger Posting:** Inserts 1 `DEBIT` entry for `fromAccount` and 1 `CREDIT` entry for `toAccount`.
- **Responses:**
  - `201 Created`: `{ message: "Transaction completed successfully", transaction: {...} }`
  - `200 OK`: Idempotent replay: `{ message: "Transaction already processed", transaction: {...} }`
  - `400 Bad Request`: Validation failure (negative amount, self-transfer, insufficient balance).
  - `401 Unauthorized`: Token invalid.
  - `403 Forbidden`: Account ownership violation or transaction blocked by risk engine.
  - `404 Not Found`: Source or destination account does not exist.
  - `409 Conflict`: Transient write-conflict exhausted backoff retries.
  - `429 Too Many Requests`: Exceeded 60 transactions per minute.

---

### 4.4 Admin Monitoring APIs (ADMIN ONLY)

All admin routes require `authMiddleware` + `adminMiddleware` + `adminLimiter` (120 req / 1 min). Normal `USER` callers receive `403 Forbidden`.

#### `GET /api/admin/health`
- **Purpose:** Verifies admin credentials and RBAC clearance.
- **Responses:** `200 OK` (`{ message: "Admin access granted" }`), `401`, `403`.

#### `GET /api/admin/dashboard/stats`
- **Purpose:** Aggregates real-time platform KPIs.
- **Response Format:**
  ```json
  {
    "totalUsers": 212,
    "totalTransactions": 463,
    "completedTransactions": 242,
    "failedTransactions": 221,
    "flaggedTransactions": 195,
    "manualReviewTransactions": 0,
    "blockedTransactions": 21,
    "totalTransactionVolume": 3929296.61
  }
  ```

#### `GET /api/admin/transactions`
- **Purpose:** Paginated, multi-filter transaction inspection list.
- **Query Parameters:**
  - `page`: Integer $\ge 1$ (default `1`).
  - `limit`: Integer between `1` and `100` (default `20`).
  - `status`: Enum (`PENDING`, `COMPLETED`, `FAILED`, `REVERSED`).
  - `riskStatus`: Enum (`APPROVED`, `FLAGGED`, `MANUAL_REVIEW`, `BLOCKED`).
  - `minAmount`, `maxAmount`: Numbers $\ge 0$.
  - `fromAccount`, `toAccount`: Valid 24-character ObjectIds.
  - `dateFrom`, `dateTo`: ISO 8601 Date strings.
- **Response Format:** `{ transactions: [...], pagination: { page, limit, total, totalPages } }`.

#### `GET /api/admin/transactions/flagged`
- **Purpose:** Lists elevated risk transactions (`FLAGGED`, `MANUAL_REVIEW`, `BLOCKED`). Emits `ADMIN_VIEWED_RISK_DATA` self-audit log.
- **Query Parameters:** `page`, `limit`.

#### `GET /api/admin/transactions/:id`
- **Purpose:** Comprehensive transaction inspection. Returns transaction metadata, populated sender and receiver profiles, and associated double-entry `ledgerEntries` (`DEBIT` & `CREDIT`). Emits `ADMIN_VIEWED_TRANSACTION` self-audit log.
- **Path Parameter:** `id` (MongoDB ObjectId).

#### `GET /api/admin/users`
- **Purpose:** Paginated user registry. Emits `ADMIN_VIEWED_USER` self-audit log.
- **Query Parameters:** `page`, `limit`, `search` (case-insensitive search against name or email).
- **Security Projection:** Excludes password hashes and sensitive auth secrets. Returns `{ _id, name, email, role, createdAt, updatedAt }`.

---

### 4.5 Audit Trail APIs (ADMIN ONLY)

#### `GET /api/admin/audit-logs`
- **Purpose:** Paginated and filtered query of append-only audit trail documents.
- **Query Parameters:**
  - `page`, `limit`: Pagination parameters.
  - `action`: Audit action filter (e.g. `TRANSACTION_COMPLETED`, `USER_REGISTERED`, `LOGIN_FAILED`).
  - `resourceType`: Enum (`TRANSACTION`, `USER`, `ACCOUNT`, `AUTH`, `ADMIN`, `RISK`, `SYSTEM`).
  - `actorUser`: ObjectId of the initiating actor.
  - `transactionId`: ObjectId of associated transaction.
  - `dateFrom`, `dateTo`: ISO date boundaries.
- **Response Format:** `{ auditLogs: [...], pagination: { page, limit, total, totalPages } }`.

#### `GET /api/admin/audit-logs/:id`
- **Purpose:** Single audit log record detail.
- **Path Parameter:** `id` (MongoDB ObjectId).

---

## 5. Standard Error Contract

All error responses across controllers and middleware strictly follow the unified JSON error envelope:

```json
{
  "message": "Human-readable explanation of error"
}
```

### Common HTTP Status Codes:
- **`400 Bad Request`**: Client-side validation failure (e.g. self-transfer, non-positive amount, invalid pagination).
- **`401 Unauthorized`**: Authentication missing, invalid, expired, or blacklisted.
- **`403 Forbidden`**: Insufficient permissions (USER accessing ADMIN route, or transaction declined by risk policy).
- **`404 Not Found`**: Resource does not exist or caller does not have read access.
- **`409 Conflict`**: Concurrency write conflict retry exhausted.
- **`413 Payload Too Large`**: Request body exceeds 50kb security limit.
- **`422 Unprocessable Entity`**: Business constraint violation (e.g. email already exists).
- **`429 Too Many Requests`**: Rate limit exceeded for client IP.
- **`500 Internal Server Error`**: Unexpected server error. Internal error stack trace is logged server-side and never exposed to the client.

---

## 6. Local Development & Verification

### Prerequisites
- Node.js v18+
- MongoDB Atlas or local MongoDB replica set (ACID transactions require replica set)

### Environment Configuration (`backend/.env`)
```bash
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/backend-ledger
JWT_SECRET=your_super_secret_jwt_key_at_least_32_chars
LOG_LEVEL=INFO
SLOW_REQUEST_THRESHOLD_MS=1000
```

### Launching the Backend
```bash
cd backend
npm install
node server.js
```

### Executing the Unified Automated Test Suite
```bash
node backend/tests/run_all_37_tests.js
```
The test runner executes all 7 suites (Risk Engine, RBAC, Monitoring, Audit Trail, Security Hardening, Observability, and API Contract Verification).
