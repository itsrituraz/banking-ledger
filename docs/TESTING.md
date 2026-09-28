# Automated Testing Architecture & Test Catalog

This document details the automated test architecture, coverage strategy, and test catalogs for the **Banking Ledger** platform. All tests execute against live database connections (MongoDB Atlas replica set) to verify real transactional and query execution behavior.

---

## 1. Test Suite Summary (91 / 91 Tests Passing)

| Suite # | Test Suite Name | Execution File | Test Count | Status |
| :---: | :--- | :--- | :---: | :---: |
| 1 | **Fintech Risk & Fraud Engine Suite** | [`test_risk_engine_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_risk_engine_suite.js) | 10 / 10 | **PASS** |
| 2 | **Admin Role-Based Access Control (RBAC) Suite** | [`test_admin_rbac_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_admin_rbac_suite.js) | 7 / 7 | **PASS** |
| 3 | **Admin Read-Only Monitoring APIs Suite** | [`test_admin_monitoring_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_admin_monitoring_suite.js) | 10 / 10 | **PASS** |
| 4 | **Immutable Audit Trail Suite** | [`test_audit_trail_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_audit_trail_suite.js) | 10 / 10 | **PASS** |
| 5 | **Rate Limiting & Security Hardening Suite** | [`test_security_hardening_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_security_hardening_suite.js) | 12 / 12 | **PASS** |
| 6 | **Observability & Structured Logging Suite** | [`test_observability_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_observability_suite.js) | 10 / 10 | **PASS** |
| 7 | **API Documentation & Contract Suite** | [`test_api_contract_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_api_contract_suite.js) | 10 / 10 | **PASS** |
| 8 | **Database & Performance Engineering Suite** | [`test_database_performance_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_database_performance_suite.js) | 10 / 10 | **PASS** |
| 9 | **Production Smoke Suite** | [`test_production_smoke_suite.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/test_production_smoke_suite.js) | 12 / 12 | **PASS** |
| **Total** | **Consolidated Unified Test Suite** | [`run_all_37_tests.js`](file:///c:/Users/RITU%20RAJ/OneDrive/Desktop/banking-ledger/backend/tests/run_all_37_tests.js) | **91 / 91** | **100% PASS** |

---

## 2. Test Suite Breakdown

### Suite 1: Risk & Fraud Engine Suite (10 Tests)
* **Test 1:** Baseline transaction (< 10k, familiar beneficiary) passes with score < 30 and `APPROVED`.
* **Test 2:** High transaction amount ($\ge 10,000$) triggers `HIGH_TRANSACTION_AMOUNT` (+20).
* **Test 3:** Transfer to unfamiliar recipient triggers `FIRST_TIME_BENEFICIARY` (+20).
* **Test 4:** Rapid transaction flood triggers `TRANSACTION_VELOCITY` ($\ge 3$ in 5m: +20; $\ge 5$: +40).
* **Test 5:** Large transaction on fresh account triggers `NEW_ACCOUNT_HIGH_VALUE` (+10).
* **Test 6:** Cumulative score accumulation correctly capped at 100 maximum.
* **Test 7:** Full integration transfer creates double-entry ledger and strips risk metadata from client response.
* **Test 8:** Extreme risk transaction ($\ge 80$) is blocked with HTTP 403 and records FAILED status.
* **Test 9:** Moderate risk transaction (30–59) completes but records `FLAGGED` status in transaction record.
* **Test 10:** Idempotent re-submission of flagged transaction preserves existing risk evaluation without re-triggering scoring.

### Suite 2: Admin RBAC Security Suite (7 Tests)
* **Test 1:** Admin user promotion verified in database.
* **Test 2:** Unauthenticated request to `/api/admin/*` rejected with HTTP 401.
* **Test 3:** Authenticated user with `USER` role receives HTTP 403 Forbidden.
* **Test 4:** Authenticated user with `ADMIN` role receives HTTP 200 OK.
* **Test 5:** Forged/tampered JWT payload claiming admin privileges rejected with HTTP 401.
* **Test 6:** Missing JWT cookie or bearer token rejected with HTTP 401.
* **Test 7:** Token blacklisting immediately revokes admin access.

### Suite 3: Admin Monitoring APIs Suite (10 Tests)
* **Test 1:** Dashboard statistics endpoint returns numeric aggregate totals.
* **Test 2:** Transaction list endpoint returns paginated results and pagination metadata.
* **Test 3:** Flagged transaction filtering isolates `FLAGGED` and `MANUAL_REVIEW` records.
* **Test 4:** Single transaction lookup returns populated user and account relations.
* **Test 5:** Ledger entries associated with a transaction are visible to admin.
* **Test 6:** User directory endpoint supports search filtering and pagination.
* **Test 7:** Date-range transaction query filters records between timestamp boundaries.
* **Test 8:** Status-based filtering correctly isolates `COMPLETED` and `FAILED` transfers.
* **Test 9:** Non-admin attempts to access monitoring endpoints blocked with 403.
* **Test 10:** Malformed query parameters handled gracefully with sensible defaults.

### Suite 4: Immutable Audit Trail Suite (10 Tests)
* **Test 1:** User registration creates `USER_REGISTERED` audit record.
* **Test 2:** User login creates `USER_LOGIN` audit record.
* **Test 3:** User logout creates `USER_LOGOUT` audit record.
* **Test 4:** Completed transfer records `TRANSACTION_COMPLETED` with transfer metadata.
* **Test 5:** Blocked transfer records `TRANSACTION_BLOCKED` audit event.
* **Test 6:** Admin reading risk data creates self-auditing `ADMIN_VIEWED_RISK_DATA` record.
* **Test 7:** Audit log entries cannot be modified via `updateOne` (immutability hook error).
* **Test 8:** Audit log entries cannot be deleted via `deleteOne` or `deleteMany`.
* **Test 9:** Request correlation ID (`requestId`) preserved across audit records.
* **Test 10:** Sensitive fields (passwords, tokens) are redacted from audit metadata.

### Suite 5: Rate Limiting & Security Hardening Suite (12 Tests)
* **Test 1:** Rapid login attempts from single IP trigger HTTP 429 Too Many Requests.
* **Test 2:** Rapid transaction creation requests trigger transaction rate limiter with HTTP 429.
* **Test 3:** Admin route rate limiter throttles excessive administrative queries.
* **Test 4:** Legitimate request under limit executes with HTTP 200/201.
* **Test 5:** Normal user receives HTTP 403 Forbidden on admin APIs.
* **Test 6:** Blacklisted JWT token returns HTTP 401 Unauthorized.
* **Test 7:** Invalid JWT signature returns HTTP 401 Unauthorized.
* **Test 8:** Helmet security headers (`X-Content-Type-Options: nosniff`) present in responses.
* **Test 9:** Unauthorized CORS origin blocked with HTTP 403.
* **Test 10:** Authorized CORS origin receives appropriate `Access-Control-Allow-Origin`.
* **Test 11:** Request body exceeding 50kb payload limit rejected with HTTP 413.
* **Test 12:** Centralized error handler masks internal stack traces from client responses.

### Suite 6: Observability & Structured Logging Suite (10 Tests)
* **Test 1:** Incoming request generates and attaches `X-Request-Id` correlation header.
* **Test 2:** Structured JSON log outputs valid timestamp, level, event, and correlation ID.
* **Test 3:** Response lifecycle log records duration in milliseconds and HTTP status code.
* **Test 4:** User registration produces structured operational telemetry.
* **Test 5:** Financial transfer logs double-entry debit and credit amounts.
* **Test 6:** Failed transfer produces operational telemetry with preserved correlation ID.
* **Test 7:** Administrative read operation logged with audit correlation.
* **Test 8:** Slow request threshold detector logs `SLOW_REQUEST` warning when duration > 1000ms.
* **Test 9:** Deep recursive log sanitizer redacts 11 sensitive keys across nested objects.
* **Test 10:** Server-side internal error logs stack trace while client receives generic sanitized message.

### Suite 7: API Documentation & Contract Suite (10 Tests)
* **Test 1:** Login response contract matches schema: `{ user: { _id, email, name, role }, token }`.
* **Test 2:** Transaction creation response matches contract: `{ message, transaction: { id, amount, status } }`.
* **Test 3:** Invalid transaction returns standard error envelope with status 400.
* **Test 4:** Missing authorization returns documented 401 envelope.
* **Test 5:** Forbidden admin access returns documented 403 envelope.
* **Test 6:** Idempotent replay response adheres to contract.
* **Test 7:** Risk-blocked transaction returns documented 403 envelope.
* **Test 8:** Admin dashboard stats response matches documented numeric fields.
* **Test 9:** Pagination envelope includes `page`, `limit`, `total`, and `totalPages`.
* **Test 10:** Audit log query response matches documented structure.

### Suite 8: Database & Performance Engineering Suite (10 Tests)
* **Test 1:** Ledger balance aggregation verified as index-covered scan (`account_1_type_1_amount_1`, `docsExamined: 0`).
* **Test 2:** Transaction listing query uses indexed B-tree sort without in-memory `SORT` stage.
* **Test 3:** Flagged transaction query routes through `riskStatus_1_createdAt_-1` compound index.
* **Test 4:** Audit log query by `requestId` uses targeted index without collection scans (`COLLSCAN`).
* **Test 5:** Admin dashboard facet aggregation completes under 250ms on live cluster.
* **Test 6:** User directory listing uses `createdAt_-1` index without memory sort overhead.
* **Test 7:** Pagination metadata math verified under varying limit/page bounds.
* **Test 8:** Balance invariant verified: API balance strictly equals $\sum \text{CREDIT} - \sum \text{DEBIT}$.
* **Test 9:** Parallel transfers on limited balance verify double-spend protection (1 succeeds, 1 fails).
* **Test 10:** Idempotent re-submission creates zero duplicate ledger records.

### Suite 9: Production Smoke Suite (12 Tests)
* **Test 1:** Unauthenticated liveness (`/health`) and readiness (`/health/ready`) probes return 200.
* **Test 2:** Missing and invalid JWT rejected with HTTP 401.
* **Test 3:** Normal USER cannot access admin endpoint (HTTP 403).
* **Test 4:** ADMIN user accesses admin endpoint with HTTP 200.
* **Test 5:** Standard legitimate transaction processed with HTTP 201.
* **Test 6:** Suspicious transaction flagged by risk engine blocked with HTTP 403.
* **Test 7:** Idempotent transaction replay returns cached response without duplicate debit.
* **Test 8:** Concurrent transaction double-spend protection blocks overdraw.
* **Test 9:** Helmet security headers active on responses.
* **Test 10:** Unauthorized CORS origin blocked with HTTP 403.
* **Test 11:** Request body exceeding 50kb rejected with HTTP 413 Payload Too Large.
* **Test 12:** Rapid requests engage rate limiting with HTTP 429 Too Many Requests.

---

## 3. Running the Test Suite

### Running the Full Master Suite (All 9 Suites / 91 Tests)
Ensure the backend server is active on `http://localhost:3000`, then run:
```bash
node backend/tests/run_all_37_tests.js
```

### Running Individual Test Suites
```bash
node backend/tests/test_risk_engine_suite.js
node backend/tests/test_admin_rbac_suite.js
node backend/tests/test_admin_monitoring_suite.js
node backend/tests/test_audit_trail_suite.js
node backend/tests/test_security_hardening_suite.js
node backend/tests/test_observability_suite.js
node backend/tests/test_api_contract_suite.js
node backend/tests/test_database_performance_suite.js
node backend/tests/test_production_smoke_suite.js
```
