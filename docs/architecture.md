# System Architecture & Technical Specifications

This document details the software architecture, data flow pipelines, security boundaries, and transaction processing lifecycle of the **Banking Ledger** platform.

---

## 1. High-Level System Architecture

The application is structured as a decoupled client-server architecture consisting of a React Single-Page Application (SPA), an Express.js REST API layer, and a MongoDB Atlas replica set with ACID transaction support.

```mermaid
graph TD
    Client["React 19 + Vite SPA (Client Browser)"]
    Proxy["Reverse Proxy / Cloudflare / Load Balancer"]
    
    subgraph ExpressAPI["Node.js / Express Backend Layer"]
        Security["Security Middleware (Helmet, CORS, Body Limits)"]
        RateLimiter["Rate Limiting (Auth, Tx, Admin, Global)"]
        Context["Request ID & Structured Logging Middleware"]
        AuthMid["Authentication Middleware (JWT & Token Blacklist)"]
        RBACMid["Authorization Middleware (RBAC: USER / ADMIN)"]
        
        subgraph Controllers["Controller Subsystem"]
            AuthController["Auth Controller"]
            TxController["Transaction Controller"]
            AccountController["Account Controller"]
            AdminController["Admin Controller"]
        end
        
        subgraph CoreServices["Domain Engine Subsystem"]
            RiskEngine["Deterministic Risk & Fraud Engine"]
            LedgerEngine["Double-Entry Ledger Invariant Engine"]
            AuditService["Immutable Audit Trail Service"]
            EmailService["Asynchronous Notification Service"]
        end
    end
    
    subgraph DatabaseLayer["MongoDB Atlas Replica Set Layer"]
        UsersCol[("users")]
        AccountsCol[("accounts")]
        TxsCol[("transactions")]
        LedgerCol[("ledgers")]
        AuditCol[("audit_logs")]
        BlacklistCol[("token_blacklists")]
    end

    Client -->|HTTPS + JSON| Proxy
    Proxy --> Security
    Security --> RateLimiter
    RateLimiter --> Context
    Context --> AuthMid
    AuthMid --> RBACMid
    
    RBACMid --> Controllers
    AuthController --> UsersCol
    AuthController --> BlacklistCol
    AccountController --> AccountsCol
    AccountController --> LedgerCol
    AdminController --> CoreServices
    
    TxController --> RiskEngine
    RiskEngine --> TxsCol
    TxController --> LedgerEngine
    LedgerEngine -->|WiredTiger ACID Session| AccountsCol
    LedgerEngine -->|WiredTiger ACID Session| TxsCol
    LedgerEngine -->|WiredTiger ACID Session| LedgerCol
    TxController --> AuditService
    AuditService --> AuditCol
    TxController --> EmailService
```

---

## 2. Transaction Processing Lifecycle

Money transfers execute through a 15-step sequence enforcing pre-flight validation, deterministic risk screening, account-level write locks, double-entry bookkeeping, and post-commit auditing.

```mermaid
sequenceDiagram
    autonumber
    actor Sender as Sender Client
    participant API as Transaction Controller
    participant Risk as Risk & Fraud Engine
    participant DB as MongoDB Atlas (WiredTiger)
    participant Audit as Audit Service

    Sender->>API: POST /api/transactions (payload + Idempotency-Key)
    API->>API: 1. Request Schema Validation (amount > 0, from != to)
    API->>API: 2. Authenticate req.user via JWT & Blacklist check
    API->>DB: 3. Parallel Pre-flight Account Lookup (fromAccount & toAccount)
    API->>API: 4. Verify Account Ownership & ACTIVE status
    API->>DB: 5. Idempotency Check (idempotencyKey)
    alt Idempotency Key Exists
        API-->>Sender: Return Cached Transaction (200 OK)
    end
    
    API->>Risk: 6. Evaluate Risk Score (Amount, Velocity, Beneficiary, Age)
    Risk-->>API: Risk Assessment (Score, Reasons, Status)
    
    alt Status is BLOCKED or MANUAL_REVIEW
        API->>DB: Record Failed Transaction (status: FAILED)
        API->>Audit: Log AUDIT_TRANSACTION_BLOCKED
        API-->>Sender: 403 Forbidden (Transaction Held/Blocked)
    else Status is APPROVED or FLAGGED
        API->>DB: 7. Start MongoDB Multi-Document Session (ACID)
        API->>DB: 8. Acquire Write Lock on fromAccount ($inc: __v)
        API->>DB: 9. Derive Balance from Ledger (sum CREDIT - sum DEBIT)
        alt Balance < Amount
            API->>DB: Abort Session
            API-->>Sender: 400 Bad Request (Insufficient Balance)
        else Balance >= Amount
            API->>DB: 10. Insert Transaction (status: PENDING)
            API->>DB: 11. Insert DEBIT Ledger Record (fromAccount)
            API->>DB: 12. Insert CREDIT Ledger Record (toAccount)
            API->>DB: 13. Update Transaction (status: COMPLETED)
            API->>DB: 14. Commit MongoDB Session
            API->>Audit: 15. Log AUDIT_TRANSACTION_COMPLETED
            API-->>Sender: 201 Created (Sanitized Transaction Envelope)
        end
    end
```

---

## 3. Authentication & Authorization Architecture

The platform implements dual-transport JWT authentication (HTTP-only secure cookies and `Authorization: Bearer <token>` headers) with database-backed token blacklisting for stateful revocations.

```mermaid
flowchart TD
    Req["Incoming HTTP Request"] --> CookieCheck{"Cookie 'token' or Bearer Header Present?"}
    CookieCheck -- No --> Ret401A["401 Unauthorized: Token Missing"]
    CookieCheck -- Yes --> ExtToken["Extract JWT Token"]
    
    ExtToken --> BlacklistCheck{"Exists in token_blacklists Collection?"}
    BlacklistCheck -- Yes --> Ret401B["401 Unauthorized: Token Revoked / Logged Out"]
    BlacklistCheck -- No --> VerifyJWT{"jwt.verify(token, JWT_SECRET)"}
    
    VerifyJWT -- Invalid / Expired --> Ret401C["401 Unauthorized: Invalid Signature / Expired"]
    VerifyJWT -- Valid --> LoadUser["Query users Collection by userId"]
    
    LoadUser --> UserExists{"User Exists in Database?"}
    UserExists -- No --> Ret401D["401 Unauthorized: User Not Found"]
    UserExists -- Yes --> AttachUser["Attach req.user = user"]
    
    AttachUser --> RouteCheck{"Target Route Requires Admin Role?"}
    RouteCheck -- No --> NextHandler["Proceed to Route Controller"]
    RouteCheck -- Yes --> RoleCheck{"req.user.role === 'ADMIN'?"}
    
    RoleCheck -- No --> Ret403["403 Forbidden: Admin Access Required"]
    RoleCheck -- Yes --> NextAdminHandler["Proceed to Admin Controller"]
```

---

## 4. Deterministic Risk & Fraud Evaluation Flow

Risk evaluation runs entirely synchronously prior to transaction boundary initialization. It uses rule-based heuristic weights rather than opaque machine-learning models, providing immediate transparency and auditability.

```mermaid
flowchart TD
    Init["Transaction Context (User, Sender, Receiver, Amount)"] --> R1["Rule 1: Transaction Amount Check"]
    Init --> R2["Rule 2: Beneficiary History Check"]
    Init --> R3["Rule 3: Short-Term Velocity Check"]
    Init --> R4["Rule 4: Account Maturity Check"]
    
    R1 -->|"Amount >= 50,000 (+35) OR >= 10,000 (+20)"| Accumulate["Accumulate Score & Collect Reason Codes"]
    R2 -->|"Sender has never transferred to Receiver (+20)"| Accumulate
    R3 -->|"Txs in last 5 min >= 5 (+40) OR >= 3 (+20)"| Accumulate
    R4 -->|"Account age < 24h AND Amount >= 5,000 (+10)"| Accumulate
    
    Accumulate --> CapCheck["Cap Score at Maximum 100"]
    CapCheck --> ScoreEvaluation{"Evaluate Final Score Range"}
    
    ScoreEvaluation -->|"0 - 29"| StApproved["Status: APPROVED<br>Action: Immediate Execution"]
    ScoreEvaluation -->|"30 - 59"| StFlagged["Status: FLAGGED<br>Action: Allow Execution + Flag in Admin Portal"]
    ScoreEvaluation -->|"60 - 79"| StReview["Status: MANUAL_REVIEW<br>Action: Halt Execution + Return HTTP 403"]
    ScoreEvaluation -->|"80 - 100"| StBlocked["Status: BLOCKED<br>Action: Reject Transfer + Return HTTP 403"]
```

---

## 5. Immutable Audit Trail Flow

All state transitions, administrative inspections, and authentication lifecycles record an immutable audit entry linked by request correlation IDs.

```mermaid
flowchart LR
    subgraph EventSources["Event Triggers"]
        direction TB
        Ev1["User Registration"]
        Ev2["User Login / Logout"]
        Ev3["Transfer Completed"]
        Ev4["Transfer Blocked"]
        Ev5["Admin Read Operations"]
    end
    
    subgraph Pipeline["Audit Service Pipeline"]
        direction TB
        Corr["Attach req.requestId"]
        IP["Resolve Client IP (Proxy Aware)"]
        Sanitize["Recursive Sensitive Field Masking"]
        Prep["Assemble Audit Document"]
    end
    
    subgraph ImmutabilityEnforcement["Mongoose Collection Guard"]
        direction TB
        Hook1["pre('updateOne') -> Reject"]
        Hook2["pre('updateMany') -> Reject"]
        Hook3["pre('deleteOne') -> Reject"]
        Hook4["pre('deleteMany') -> Reject"]
        Hook5["pre('save') (non-new) -> Reject"]
    end

    EventSources --> Corr
    Corr --> IP
    IP --> Sanitize
    Sanitize --> Prep
    Prep -->|insert() only| ImmutabilityEnforcement
    ImmutabilityEnforcement --> DB[("audit_logs Collection")]
```
