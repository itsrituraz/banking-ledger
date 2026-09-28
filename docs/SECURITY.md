# Security Architecture & Threat Mitigation Model

This document outlines the defensive security architecture implemented in the **Banking Ledger** application, detailing the specific threat vectors addressed, mitigation strategies, and code-level enforcement mechanisms.

---

## 1. Security Architecture Matrix

| Defensive Layer | Threat Mitigated | Code-Level Implementation |
| :--- | :--- | :--- |
| **Dual JWT Authentication** | Session hijacking, client credential theft | Tokens signed via `jsonwebtoken` with 256-bit secret. Dispatched via HTTP-Only, Secure cookies and optional Bearer Authorization header. |
| **Token Blacklisting** | Replay of revoked tokens after user logout | Blacklist collection (`token_blacklists`) stores revoked tokens with TTL indexing. Checked in `authMiddleware` on every authenticated request. |
| **Server-Side RBAC** | Privilege escalation, IDOR, unauthorized admin actions | `adminMiddleware` validates `req.user.role === "ADMIN"` directly from database identity; frontend route guards are purely cosmetic. |
| **Account Write-Locks** | Race conditions, double-spend vulnerabilities | Inside MongoDB session, `$inc: { __v: 1 }` on `fromAccount` forces WiredTiger document-level write-lock, serializing parallel debits. |
| **Idempotency Deduplication** | Duplicate debits due to network retries or client double-clicks | Unique B-tree index on `idempotencyKey` in `transactions` collection. Controller pre-check returns cached transaction without re-execution. |
| **Deterministic Risk Engine** | Automated fraud, rapid draining, suspicious fund movement | Pre-transaction scoring on 4 heuristic dimensions (Amount, Velocity, Beneficiary History, Account Age). Blocks transfers scoring $\ge 60$. |
| **Audit Immutability Hooks** | Tampering with audit logs or financial ledgers | Mongoose schema pre-hooks intercept and reject `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `findOneAndUpdate`, and `save` mutations. |
| **HTTP Rate Limiting** | Brute-force credential stuffing, API denial-of-service | Layered `express-rate-limit` instances: Auth (20 req / 15m), Transactions (60 req / 1m), Admin (120 req / 1m), Global (1000 req / 15m). |
| **CORS Origin Filtering** | Cross-Origin Request Forgery, unauthorized web clients | Dynamic origin validation against `process.env.FRONTEND_URL`. Wildcards rejected; unauthorized origins receive HTTP 403 Forbidden. |
| **Security Headers (Helmet)** | MIME sniffing, clickjacking, protocol downgrade | Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `X-DNS-Prefetch-Control: off`. |
| **Request Payload Limits** | Memory exhaustion, JSON buffer overflows | Express body parsers capped at strict 50kb (`express.json({ limit: "50kb" })`). Oversized requests aborted with HTTP 413. |
| **Error Sanitization** | Information disclosure, stack trace leakage | Centralized error handler captures stack traces for server-side structured logs while returning generic error messages to clients. |
| **Log Sensitive Field Masking** | PII and secret leakage into log collectors | Recursive sanitization blacklists 13 sensitive regex keys (`password`, `jwt`, `token`, `secret`, `cookie`, `authorization`, etc.). |

---

## 2. Authentication & Session Security

### Dual Transport Authentication
* **HTTP-Only Cookies:** Tokens stored in cookies cannot be accessed or extracted via `document.cookie` in JavaScript, mitigating XSS token harvesting.
* **Bearer Header Fallback:** Client also stores the token in memory/localStorage and passes `Authorization: Bearer <token>`. This dual transport guarantees cross-origin API accessibility when strict third-party cookie restrictions are active.
* **Token Invalidation:** Because JWTs are stateless by default, calling `POST /api/auth/logout` explicitly records the token in the `token_blacklists` MongoDB collection. Subsequent requests using that token are rejected with HTTP 401 Unauthorized.

---

## 3. Financial Integrity & Concurrency Controls

### The Double-Spend Race Condition
In a naive implementation:
1. User with ₹1,000 fires Request A (₹600) and Request B (₹600) simultaneously.
2. Thread A reads balance: ₹1,000 $\ge$ ₹600 $\rightarrow$ Approved.
3. Thread B reads balance: ₹1,000 $\ge$ ₹600 $\rightarrow$ Approved.
4. Total debited: ₹1,200. Account balance drops to -₹200.

### Current Mitigation
The platform eliminates this race condition using MongoDB multi-document transactions combined with account-level write locks:
1. `session.startTransaction()` begins an isolated ACID transaction.
2. `accountModel.findOneAndUpdate({ _id: fromAccount }, { $inc: { __v: 1 } }, { session })` mutates the document version.
3. Under MongoDB's WiredTiger storage engine, writing to a document acquires an exclusive write lock on that specific document.
4. Request B attempting to execute concurrently blocks at the document write lock until Request A either commits or aborts.
5. When Request A commits, Request B gains the lock, derives the newly updated balance (₹400), determines that ₹400 < ₹600, aborts its session, and returns HTTP 400 Insufficient Balance.

---

## 4. Input Validation & Defense in Depth

* **Positive Amount Enforcement:** Schema validation requires `amount > 0` and `typeof amount === "number"`. Floating point inputs are validated before database submission.
* **Self-Transfer Prevention:** `fromAccount === toAccount` checks reject internal loopbacks.
* **Mongoose Object ID Casting:** Validates that account IDs conform to 24-character hexadecimal MongoDB ObjectIDs before querying the database, preventing NoSQL query injection via object queries (`{ $ne: null }`).

---

## 5. Security Limitations & Tradeoffs

1. **In-Memory Rate Limiting:** Rate limit counters are tracked in-process using Node.js memory. In a multi-instance load-balanced deployment, rate limits apply per container unless backed by a centralized store.
2. **Deterministic Risk Heuristics:** The fraud engine uses static weighted rules. While transparent and auditable, it does not detect novel anomalous behavioral patterns that an ML-based model might identify.
3. **Network Perimeter:** Complete protection against DDoS attacks requires upstream infrastructure (Cloudflare, AWS WAF) in front of the application layer.
