import { useState, useEffect, useCallback } from "react";
import Navbar from "../components/Navbar";
import { api } from "../api/client";

// Formatter utilities
function formatCurrency(val) {
  if (val == null || isNaN(val)) return "₹0.00";
  return `₹${Number(val).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatVolumeCompact(val) {
  if (val == null || isNaN(val)) return "₹0";
  const num = Number(val);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}k`;
  return `₹${num.toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getRiskBadge(status, score) {
  switch (status) {
    case "BLOCKED":
      return { bg: "bg-red-100 border-red-300 text-red-800", label: "BLOCKED" };
    case "MANUAL_REVIEW":
      return { bg: "bg-amber-100 border-amber-300 text-amber-900", label: "MANUAL REVIEW" };
    case "FLAGGED":
      return { bg: "bg-yellow-100 border-yellow-300 text-yellow-800", label: "FLAGGED" };
    case "APPROVED":
    default:
      return { bg: "bg-emerald-100 border-emerald-300 text-emerald-800", label: "APPROVED" };
  }
}

function getTxStatusBadge(status) {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "FAILED":
      return "bg-red-50 text-red-700 border-red-200";
    case "PENDING":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "REVERSED":
      return "bg-purple-50 text-purple-700 border-purple-200";
    default:
      return "bg-neutral-100 text-neutral-700 border-neutral-200";
  }
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "flagged" | "transactions" | "users"

  // 1. Stats State
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);

  // 2. Flagged Transactions State
  const [flaggedData, setFlaggedData] = useState({ transactions: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
  const [flaggedLoading, setFlaggedLoading] = useState(false);
  const [flaggedError, setFlaggedError] = useState(null);
  const [flaggedPage, setFlaggedPage] = useState(1);

  // 3. All Transactions State
  const [txData, setTxData] = useState({ transactions: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState(null);
  const [txPage, setTxPage] = useState(1);
  const [txStatusFilter, setTxStatusFilter] = useState("");
  const [txRiskFilter, setTxRiskFilter] = useState("");

  // 4. Users State
  const [usersData, setUsersData] = useState({ users: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } });
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState(null);
  const [usersPage, setUsersPage] = useState(1);
  const [userSearch, setUserSearch] = useState("");

  // 5. Selected Transaction Modal State
  const [selectedTxId, setSelectedTxId] = useState(null);
  const [selectedTxDetail, setSelectedTxDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Load KPI Stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await api.getAdminStats();
      setStats(data);
    } catch (err) {
      setStatsError(err.message || "Failed to load dashboard statistics");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Load Flagged Transactions
  const loadFlagged = useCallback(async (page = 1) => {
    setFlaggedLoading(true);
    setFlaggedError(null);
    try {
      const data = await api.getAdminFlaggedTransactions({ page, limit: 10 });
      setFlaggedData(data);
      if (data?.pagination?.page) setFlaggedPage(data.pagination.page);
    } catch (err) {
      setFlaggedError(err.message || "Failed to load flagged transactions");
    } finally {
      setFlaggedLoading(false);
    }
  }, []);

  // Load All Transactions
  const loadTransactions = useCallback(async (page = 1, status = txStatusFilter, riskStatus = txRiskFilter) => {
    setTxLoading(true);
    setTxError(null);
    try {
      const params = { page, limit: 10 };
      if (status) params.status = status;
      if (riskStatus) params.riskStatus = riskStatus;
      const data = await api.getAdminTransactions(params);
      setTxData(data);
      if (data?.pagination?.page) setTxPage(data.pagination.page);
    } catch (err) {
      setTxError(err.message || "Failed to load transactions");
    } finally {
      setTxLoading(false);
    }
  }, [txStatusFilter, txRiskFilter]);

  // Load Users
  const loadUsers = useCallback(async (page = 1, search = userSearch) => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const params = { page, limit: 10 };
      if (search && search.trim()) params.search = search.trim();
      const data = await api.getAdminUsers(params);
      setUsersData(data);
      if (data?.pagination?.page) setUsersPage(data.pagination.page);
    } catch (err) {
      setUsersError(err.message || "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, [userSearch]);

  // Explicit pagination change handlers
  const handleTxPageChange = (newPage) => {
    const maxPages = txData.pagination.totalPages || 1;
    const target = Math.max(1, Math.min(maxPages, newPage));
    setTxPage(target);
    loadTransactions(target, txStatusFilter, txRiskFilter);
  };

  const handleUsersPageChange = (newPage) => {
    const maxPages = usersData.pagination.totalPages || 1;
    const target = Math.max(1, Math.min(maxPages, newPage));
    setUsersPage(target);
    loadUsers(target, userSearch);
  };

  const handleFlaggedPageChange = (newPage) => {
    const maxPages = flaggedData.pagination.totalPages || 1;
    const target = Math.max(1, Math.min(maxPages, newPage));
    setFlaggedPage(target);
    loadFlagged(target);
  };

  // Load Transaction Detail
  const openTransactionDetail = async (id) => {
    setSelectedTxId(id);
    setSelectedTxDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await api.getAdminTransactionById(id);
      setSelectedTxDetail(data.transaction);
    } catch (err) {
      setDetailError(err.message || "Failed to load transaction details");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedTxId(null);
    setSelectedTxDetail(null);
  };

  // Initial load
  useEffect(() => {
    loadStats();
    loadFlagged(1);
  }, [loadStats, loadFlagged]);

  // Tab change triggers
  useEffect(() => {
    if (activeTab === "transactions") {
      loadTransactions(txPage, txStatusFilter, txRiskFilter);
    } else if (activeTab === "users") {
      loadUsers(usersPage, userSearch);
    } else if (activeTab === "flagged") {
      loadFlagged(flaggedPage);
    }
  }, [activeTab]);

  const handleRefreshAll = () => {
    loadStats();
    if (activeTab === "flagged") loadFlagged(flaggedPage);
    else if (activeTab === "transactions") loadTransactions(txPage, txStatusFilter, txRiskFilter);
    else if (activeTab === "users") loadUsers(usersPage, userSearch);
  };

  // Derived approved count
  const approvedCount = stats
    ? Math.max(0, (stats.completedTransactions || 0) - ((stats.flaggedTransactions || 0) + (stats.manualReviewTransactions || 0)))
    : 0;

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header Bar */}
        <div className="bg-white border border-[#D8D3C8] p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-[#5B6B7A] uppercase tracking-wider">
                Financial Operations
              </span>
              <span className="text-[#D8D3C8]">/</span>
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 border border-amber-200">
                ADMIN CONSOLE
              </span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl text-[#1A1A1A]">
              Risk & Transaction Monitoring
            </h1>
            <p className="text-xs sm:text-sm text-[#5B6B7A] mt-1">
              Real-time audit trail, double-entry verification, and deterministic fraud detection.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRefreshAll}
              disabled={statsLoading}
              className="px-3.5 py-2 border border-[#D8D3C8] text-xs font-medium text-[#1A1A1A] hover:bg-neutral-50 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span className={statsLoading ? "animate-spin" : ""}>↻</span>
              <span>Refresh Metrics</span>
            </button>
            <span className="text-xs text-[#5B6B7A] font-mono hidden sm:inline">
              Authoritative DB Sync
            </span>
          </div>
        </div>

        {/* SECTION 1: KPI CARDS */}
        {statsLoading && !stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white border border-[#D8D3C8] p-4 animate-pulse h-24" />
            ))}
          </div>
        ) : statsError ? (
          <div className="bg-red-50 border border-red-200 p-4 text-red-700 text-sm mb-8 flex items-center justify-between">
            <span>Unable to load dashboard statistics: {statsError}</span>
            <button onClick={loadStats} className="underline font-semibold ml-4">Retry</button>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-[#5B6B7A] uppercase tracking-wider">Total Users</span>
              <p className="font-mono text-2xl font-semibold text-[#1A1A1A] mt-2">{stats.totalUsers.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-[#5B6B7A] uppercase tracking-wider">Total Transfers</span>
              <p className="font-mono text-2xl font-semibold text-[#1A1A1A] mt-2">{stats.totalTransactions.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-[#5B6B7A] uppercase tracking-wider">Completed</span>
              <p className="font-mono text-2xl font-semibold text-emerald-700 mt-2">{stats.completedTransactions.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-[#5B6B7A] uppercase tracking-wider">Failed / Declined</span>
              <p className="font-mono text-2xl font-semibold text-red-600 mt-2">{stats.failedTransactions.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-[#5B6B7A] uppercase tracking-wider">Gross Volume</span>
              <p className="font-mono text-xl sm:text-2xl font-semibold text-[#1A1A1A] mt-2" title={formatCurrency(stats.totalTransactionVolume)}>
                {formatVolumeCompact(stats.totalTransactionVolume)}
              </p>
            </div>
            <div className="bg-white border border-[#D8D3C8] p-4 flex flex-col justify-between bg-amber-50/40">
              <span className="text-[11px] font-medium text-amber-800 uppercase tracking-wider">Flagged Risk</span>
              <p className="font-mono text-2xl font-semibold text-amber-700 mt-2">
                {(stats.flaggedTransactions + stats.manualReviewTransactions + stats.blockedTransactions).toLocaleString()}
              </p>
            </div>
          </div>
        ) : null}

        {/* SECTION 2: RISK OVERVIEW */}
        {stats && (
          <div className="bg-white border border-[#D8D3C8] p-5 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-[#D8D3C8] gap-2">
              <div>
                <h2 className="font-serif text-lg text-[#1A1A1A]">Risk Screening Engine Overview</h2>
                <p className="text-xs text-[#5B6B7A]">
                  Categorization based on deterministic risk scores (0–100) and evaluation rules.
                </p>
              </div>
              <span className="text-xs font-mono text-[#5B6B7A]">
                Velocity & Beneficiary Screening Active
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-emerald-800">APPROVED (0–29)</span>
                  <span className="text-[10px] text-emerald-700 font-mono">Low Risk</span>
                </div>
                <p className="font-mono text-2xl font-semibold text-emerald-900">{approvedCount}</p>
                <p className="text-[11px] text-emerald-700 mt-1">Processed without friction</p>
              </div>

              <div className="border border-yellow-200 bg-yellow-50/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-yellow-800">FLAGGED (30–59)</span>
                  <span className="text-[10px] text-yellow-700 font-mono">Elevated</span>
                </div>
                <p className="font-mono text-2xl font-semibold text-yellow-900">{stats.flaggedTransactions}</p>
                <p className="text-[11px] text-yellow-700 mt-1">Logged for anomaly tracking</p>
              </div>

              <div className="border border-amber-200 bg-amber-50/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-amber-800">MANUAL REVIEW (60–79)</span>
                  <span className="text-[10px] text-amber-700 font-mono">Hold</span>
                </div>
                <p className="font-mono text-2xl font-semibold text-amber-900">{stats.manualReviewTransactions}</p>
                <p className="text-[11px] text-amber-700 mt-1">Halted prior to ledger entries</p>
              </div>

              <div className="border border-red-200 bg-red-50/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-red-800">BLOCKED (80–100)</span>
                  <span className="text-[10px] text-red-700 font-mono">Declined</span>
                </div>
                <p className="font-mono text-2xl font-semibold text-red-900">{stats.blockedTransactions}</p>
                <p className="text-[11px] text-red-700 mt-1">Hard blocked; zero ledger impact</p>
              </div>
            </div>
          </div>
        )}

        {/* SECTION NAVIGATION TABS */}
        <div className="flex border-b border-[#D8D3C8] mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === "overview"
                ? "border-[#0F1E2E] text-[#0F1E2E] font-semibold"
                : "border-transparent text-[#5B6B7A] hover:text-[#1A1A1A]"
            }`}
          >
            Flagged & Risky Activity
          </button>
          <button
            onClick={() => setActiveTab("transactions")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === "transactions"
                ? "border-[#0F1E2E] text-[#0F1E2E] font-semibold"
                : "border-transparent text-[#5B6B7A] hover:text-[#1A1A1A]"
            }`}
          >
            All Ledger Transactions
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === "users"
                ? "border-[#0F1E2E] text-[#0F1E2E] font-semibold"
                : "border-transparent text-[#5B6B7A] hover:text-[#1A1A1A]"
            }`}
          >
            Registered Users
          </button>
        </div>

        {/* SECTION 3: FLAGGED TRANSACTIONS TAB */}
        {activeTab === "overview" && (
          <div className="bg-white border border-[#D8D3C8] p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 pb-3 border-b border-[#D8D3C8] gap-2">
              <div>
                <h3 className="font-serif text-lg text-[#1A1A1A]">Elevated Risk Transactions</h3>
                <p className="text-xs text-[#5B6B7A]">
                  Transactions triggering risk flags (FLAGGED, MANUAL REVIEW, BLOCKED). Click row to inspect ledger.
                </p>
              </div>
              <span className="text-xs font-mono text-[#5B6B7A]">
                Showing page {flaggedData.pagination.page} of {flaggedData.pagination.totalPages} ({flaggedData.pagination.total} total)
              </span>
            </div>

            {flaggedLoading ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm animate-pulse">
                Loading flagged transactions...
              </div>
            ) : flaggedError ? (
              <div className="bg-red-50 border border-red-200 p-4 text-red-700 text-sm flex items-center justify-between">
                <span>{flaggedError}</span>
                <button onClick={() => loadFlagged(flaggedPage)} className="underline font-semibold">Retry</button>
              </div>
            ) : flaggedData.transactions.length === 0 ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm">
                No elevated risk or flagged transactions on record.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#D8D3C8] bg-neutral-50 text-[11px] uppercase tracking-wider text-[#5B6B7A]">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Risk Score / Status</th>
                      <th className="py-2.5 px-3">Triggered Risk Reasons</th>
                      <th className="py-2.5 px-3">Tx Status</th>
                      <th className="py-2.5 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D8D3C8]">
                    {flaggedData.transactions.map((tx) => {
                      const badge = getRiskBadge(tx.riskStatus, tx.riskScore);
                      return (
                        <tr
                          key={tx.id || tx._id}
                          onClick={() => openTransactionDetail(tx.id || tx._id)}
                          className="hover:bg-neutral-50/80 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-3 text-xs text-[#5B6B7A] font-mono whitespace-nowrap">
                            {formatDate(tx.createdAt)}
                          </td>
                          <td className="py-3 px-3 font-mono font-semibold text-[#1A1A1A] whitespace-nowrap">
                            {formatCurrency(tx.amount)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold w-6 text-right">
                                {tx.riskScore}
                              </span>
                              <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 border ${badge.bg}`}>
                                {badge.label}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1 max-w-md">
                              {tx.riskReasons && tx.riskReasons.length > 0 ? (
                                tx.riskReasons.map((r, i) => (
                                  <span key={i} className="text-[10px] font-mono bg-neutral-100 text-neutral-700 px-1.5 py-0.2 border border-neutral-200">
                                    {r}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-[#5B6B7A]">—</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`text-[10px] font-mono px-2 py-0.5 border ${getTxStatusBadge(tx.transactionStatus)}`}>
                              {tx.transactionStatus}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openTransactionDetail(tx.id || tx._id);
                              }}
                              className="text-xs text-[#1F7A5C] hover:underline font-medium"
                            >
                              Inspect →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {flaggedData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#D8D3C8] text-xs">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleFlaggedPageChange(1)}
                    disabled={flaggedPage <= 1 || flaggedLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="First page"
                  >
                    « First
                  </button>
                  <button
                    onClick={() => handleFlaggedPageChange(flaggedPage - 1)}
                    disabled={flaggedPage <= 1 || flaggedLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    ← Previous
                  </button>
                </div>
                <span className="font-mono text-[#5B6B7A]">
                  Page {flaggedPage} of {flaggedData.pagination.totalPages} ({flaggedData.pagination.total} flagged)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleFlaggedPageChange(flaggedPage + 1)}
                    disabled={flaggedPage >= flaggedData.pagination.totalPages || flaggedLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => handleFlaggedPageChange(flaggedData.pagination.totalPages)}
                    disabled={flaggedPage >= flaggedData.pagination.totalPages || flaggedLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="Last page"
                  >
                    Last »
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 4: ALL TRANSACTIONS TAB */}
        {activeTab === "transactions" && (
          <div className="bg-white border border-[#D8D3C8] p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 pb-3 border-b border-[#D8D3C8] gap-3">
              <div>
                <h3 className="font-serif text-lg text-[#1A1A1A]">Complete Transaction Ledger Stream</h3>
                <p className="text-xs text-[#5B6B7A]">
                  Authoritative record of all money transfers and balance state transitions.
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={txStatusFilter}
                  onChange={(e) => {
                    setTxStatusFilter(e.target.value);
                    setTxPage(1);
                    loadTransactions(1, e.target.value, txRiskFilter);
                  }}
                  className="text-xs border border-[#D8D3C8] px-2.5 py-1.5 bg-white text-[#1A1A1A]"
                >
                  <option value="">All Statuses</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="PENDING">PENDING</option>
                  <option value="REVERSED">REVERSED</option>
                </select>

                <select
                  value={txRiskFilter}
                  onChange={(e) => {
                    setTxRiskFilter(e.target.value);
                    setTxPage(1);
                    loadTransactions(1, txStatusFilter, e.target.value);
                  }}
                  className="text-xs border border-[#D8D3C8] px-2.5 py-1.5 bg-white text-[#1A1A1A]"
                >
                  <option value="">All Risk Tiers</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="FLAGGED">FLAGGED</option>
                  <option value="MANUAL_REVIEW">MANUAL REVIEW</option>
                  <option value="BLOCKED">BLOCKED</option>
                </select>

                <button
                  onClick={() => {
                    setTxStatusFilter("");
                    setTxRiskFilter("");
                    setTxPage(1);
                    loadTransactions(1, "", "");
                  }}
                  className="text-xs text-[#5B6B7A] hover:text-[#1A1A1A] underline px-1"
                >
                  Reset
                </button>
              </div>
            </div>

            {txLoading ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm animate-pulse">
                Loading transaction records...
              </div>
            ) : txError ? (
              <div className="bg-red-50 border border-red-200 p-4 text-red-700 text-sm flex items-center justify-between">
                <span>{txError}</span>
                <button onClick={() => loadTransactions(txPage)} className="underline font-semibold">Retry</button>
              </div>
            ) : txData.transactions.length === 0 ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm">
                No transactions match the selected criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#D8D3C8] bg-neutral-50 text-[11px] uppercase tracking-wider text-[#5B6B7A]">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Sender</th>
                      <th className="py-2.5 px-3">Receiver</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Risk Assessment</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D8D3C8]">
                    {txData.transactions.map((tx) => {
                      const badge = getRiskBadge(tx.riskStatus, tx.riskScore);
                      return (
                        <tr
                          key={tx.id || tx._id}
                          onClick={() => openTransactionDetail(tx.id || tx._id)}
                          className="hover:bg-neutral-50/80 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-3 text-xs text-[#5B6B7A] font-mono whitespace-nowrap">
                            {formatDate(tx.createdAt)}
                          </td>
                          <td className="py-3 px-3 text-xs whitespace-nowrap">
                            <p className="font-medium text-[#1A1A1A]">{tx.fromAccount?.user?.name || "Sender"}</p>
                            <p className="text-[11px] text-[#5B6B7A] font-mono">{tx.fromAccount?._id ? tx.fromAccount._id.slice(-8) : "—"}</p>
                          </td>
                          <td className="py-3 px-3 text-xs whitespace-nowrap">
                            <p className="font-medium text-[#1A1A1A]">{tx.toAccount?.user?.name || "Receiver"}</p>
                            <p className="text-[11px] text-[#5B6B7A] font-mono">{tx.toAccount?._id ? tx.toAccount._id.slice(-8) : "—"}</p>
                          </td>
                          <td className="py-3 px-3 font-mono font-semibold text-[#1A1A1A] whitespace-nowrap">
                            {formatCurrency(tx.amount)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`text-[10px] font-mono px-2 py-0.5 border ${getTxStatusBadge(tx.status)}`}>
                              {tx.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-semibold">{tx.riskScore ?? 0}</span>
                              <span className={`text-[10px] font-mono px-1.5 py-0.2 border ${badge.bg}`}>
                                {tx.riskStatus || "APPROVED"}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openTransactionDetail(tx.id || tx._id);
                              }}
                              className="text-xs text-[#1F7A5C] hover:underline font-medium"
                            >
                              Inspect →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {txData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#D8D3C8] text-xs">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTxPageChange(1)}
                    disabled={txPage <= 1 || txLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="First page"
                  >
                    « First
                  </button>
                  <button
                    onClick={() => handleTxPageChange(txPage - 1)}
                    disabled={txPage <= 1 || txLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    ← Previous
                  </button>
                </div>
                <span className="font-mono text-[#5B6B7A]">
                  Page {txPage} of {txData.pagination.totalPages} ({txData.pagination.total} records)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTxPageChange(txPage + 1)}
                    disabled={txPage >= txData.pagination.totalPages || txLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => handleTxPageChange(txData.pagination.totalPages)}
                    disabled={txPage >= txData.pagination.totalPages || txLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="Last page"
                  >
                    Last »
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 6: USERS TAB */}
        {activeTab === "users" && (
          <div className="bg-white border border-[#D8D3C8] p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 pb-3 border-b border-[#D8D3C8] gap-3">
              <div>
                <h3 className="font-serif text-lg text-[#1A1A1A]">Registered User Directory</h3>
                <p className="text-xs text-[#5B6B7A]">
                  User authentication profiles and RBAC role assignments.
                </p>
              </div>

              {/* User Search */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setUsersPage(1);
                  loadUsers(1, userSearch);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  placeholder="Search name or email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="text-xs border border-[#D8D3C8] px-3 py-1.5 bg-white text-[#1A1A1A] w-52 focus:outline-none focus:border-[#0F1E2E]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#0F1E2E] text-white text-xs hover:bg-[#1A2E42] transition-colors"
                >
                  Search
                </button>
                {userSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserSearch("");
                      setUsersPage(1);
                      loadUsers(1, "");
                    }}
                    className="text-xs text-[#5B6B7A] hover:text-[#1A1A1A] underline"
                  >
                    Clear
                  </button>
                )}
              </form>
            </div>

            {usersLoading ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm animate-pulse">
                Loading users...
              </div>
            ) : usersError ? (
              <div className="bg-red-50 border border-red-200 p-4 text-red-700 text-sm flex items-center justify-between">
                <span>{usersError}</span>
                <button onClick={() => loadUsers(usersPage)} className="underline font-semibold">Retry</button>
              </div>
            ) : usersData.users.length === 0 ? (
              <div className="py-12 text-center text-[#5B6B7A] text-sm">
                No users found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#D8D3C8] bg-neutral-50 text-[11px] uppercase tracking-wider text-[#5B6B7A]">
                      <th className="py-2.5 px-3">User ID</th>
                      <th className="py-2.5 px-3">Name</th>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Role</th>
                      <th className="py-2.5 px-3">Registered At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D8D3C8]">
                    {usersData.users.map((u) => (
                      <tr key={u.id || u._id} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono text-xs text-[#5B6B7A] select-all">
                          {u.id || u._id}
                        </td>
                        <td className="py-3 px-3 font-medium text-[#1A1A1A]">
                          {u.name}
                        </td>
                        <td className="py-3 px-3 text-xs text-[#5B6B7A] font-mono">
                          {u.email}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 border ${
                              u.role === "ADMIN"
                                ? "bg-amber-100 text-amber-900 border-amber-300 font-semibold"
                                : "bg-neutral-100 text-neutral-700 border-neutral-200"
                            }`}
                          >
                            {u.role || "USER"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-[#5B6B7A] font-mono whitespace-nowrap">
                          {formatDate(u.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {usersData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#D8D3C8] text-xs">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleUsersPageChange(1)}
                    disabled={usersPage <= 1 || usersLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="First page"
                  >
                    « First
                  </button>
                  <button
                    onClick={() => handleUsersPageChange(usersPage - 1)}
                    disabled={usersPage <= 1 || usersLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    ← Previous
                  </button>
                </div>
                <span className="font-mono text-[#5B6B7A]">
                  Page {usersPage} of {usersData.pagination.totalPages} ({usersData.pagination.total} users)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleUsersPageChange(usersPage + 1)}
                    disabled={usersPage >= usersData.pagination.totalPages || usersLoading}
                    className="px-3 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => handleUsersPageChange(usersData.pagination.totalPages)}
                    disabled={usersPage >= usersData.pagination.totalPages || usersLoading}
                    className="px-2.5 py-1.5 border border-[#D8D3C8] hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
                    title="Last page"
                  >
                    Last »
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 5: TRANSACTION DETAILS MODAL / DRAWER */}
        {selectedTxId && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border border-[#D8D3C8] max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl p-6">
              <div className="flex items-center justify-between pb-4 border-b border-[#D8D3C8] mb-4">
                <div>
                  <span className="text-[11px] font-mono text-[#5B6B7A] uppercase tracking-wider">
                    Transaction Audit Inspection
                  </span>
                  <h3 className="font-serif text-xl text-[#1A1A1A]">
                    {formatCurrency(selectedTxDetail?.amount)}
                  </h3>
                </div>
                <button
                  onClick={closeDetail}
                  className="w-8 h-8 flex items-center justify-center text-[#5B6B7A] hover:text-[#1A1A1A] hover:bg-neutral-100 text-lg"
                >
                  ✕
                </button>
              </div>

              {detailLoading ? (
                <div className="py-12 text-center text-[#5B6B7A] text-sm animate-pulse">
                  Fetching ledger audit details...
                </div>
              ) : detailError ? (
                <div className="p-4 bg-red-50 text-red-700 text-sm border border-red-200">
                  {detailError}
                </div>
              ) : selectedTxDetail ? (
                <div className="space-y-5 text-sm">
                  {/* General Metadata */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-neutral-50 p-3.5 border border-[#D8D3C8]">
                    <div>
                      <span className="text-[10px] text-[#5B6B7A] uppercase tracking-wider block font-mono">Status</span>
                      <span className={`text-[11px] font-mono px-2 py-0.5 border inline-block mt-0.5 ${getTxStatusBadge(selectedTxDetail.status)}`}>
                        {selectedTxDetail.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#5B6B7A] uppercase tracking-wider block font-mono">Created At</span>
                      <span className="font-mono text-xs text-[#1A1A1A] block mt-0.5">
                        {formatDate(selectedTxDetail.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#5B6B7A] uppercase tracking-wider block font-mono">First-Time Beneficiary</span>
                      <span className="font-mono text-xs text-[#1A1A1A] block mt-0.5">
                        {selectedTxDetail.isFirstTimeBeneficiary ? "Yes (Flagged +20)" : "No (Established)"}
                      </span>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-[10px] text-[#5B6B7A] uppercase tracking-wider block font-mono">Transaction ID</span>
                      <span className="font-mono text-xs text-[#1A1A1A] break-all select-all block mt-0.5">
                        {selectedTxDetail.id || selectedTxDetail._id}
                      </span>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-[10px] text-[#5B6B7A] uppercase tracking-wider block font-mono">Idempotency Key</span>
                      <span className="font-mono text-xs text-[#5B6B7A] break-all select-all block mt-0.5">
                        {selectedTxDetail.idempotencyKey}
                      </span>
                    </div>
                  </div>

                  {/* Risk Engine Assessment */}
                  <div className="border border-[#D8D3C8] p-4 bg-amber-50/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider font-mono">
                        Fraud & Risk Engine Assessment
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold">
                          Score: {selectedTxDetail.riskScore} / 100
                        </span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 border ${getRiskBadge(selectedTxDetail.riskStatus, selectedTxDetail.riskScore).bg}`}>
                          {selectedTxDetail.riskStatus}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <span className="text-[11px] text-[#5B6B7A] block mb-1">Triggered Risk Rule Codes:</span>
                      {selectedTxDetail.riskReasons && selectedTxDetail.riskReasons.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedTxDetail.riskReasons.map((r, i) => (
                            <span key={i} className="text-xs font-mono bg-white px-2 py-0.5 border border-[#D8D3C8] text-amber-900 font-medium">
                              • {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-emerald-700 italic">No risk rules triggered (Score 0)</span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-2 border-t border-[#D8D3C8] text-[11px] text-[#5B6B7A] font-mono">
                      <div>IP: {selectedTxDetail.clientIp || "—"}</div>
                      <div className="truncate">Agent: {selectedTxDetail.userAgent || "—"}</div>
                    </div>
                  </div>

                  {/* Counterparties */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="border border-[#D8D3C8] p-3.5 bg-neutral-50">
                      <span className="text-[10px] uppercase font-mono text-[#5B6B7A] tracking-wider block mb-1">Sender Account</span>
                      <p className="font-medium text-[#1A1A1A]">{selectedTxDetail.fromAccount?.user?.name || "System"}</p>
                      <p className="text-xs text-[#5B6B7A] font-mono">{selectedTxDetail.fromAccount?.user?.email || "—"}</p>
                      <p className="text-[11px] text-[#5B6B7A] font-mono mt-2 break-all select-all">
                        Account: {selectedTxDetail.fromAccount?._id || "—"}
                      </p>
                      <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 mt-1 inline-block">
                        Status: {selectedTxDetail.fromAccount?.status || "ACTIVE"}
                      </span>
                    </div>

                    <div className="border border-[#D8D3C8] p-3.5 bg-neutral-50">
                      <span className="text-[10px] uppercase font-mono text-[#5B6B7A] tracking-wider block mb-1">Receiver Account</span>
                      <p className="font-medium text-[#1A1A1A]">{selectedTxDetail.toAccount?.user?.name || "Recipient"}</p>
                      <p className="text-xs text-[#5B6B7A] font-mono">{selectedTxDetail.toAccount?.user?.email || "—"}</p>
                      <p className="text-[11px] text-[#5B6B7A] font-mono mt-2 break-all select-all">
                        Account: {selectedTxDetail.toAccount?._id || "—"}
                      </p>
                      <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 mt-1 inline-block">
                        Status: {selectedTxDetail.toAccount?.status || "ACTIVE"}
                      </span>
                    </div>
                  </div>

                  {/* Double-Entry Ledger Records */}
                  <div className="border border-[#D8D3C8] p-4 bg-white">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[#1A1A1A] uppercase tracking-wider font-mono">
                        Double-Entry Ledger Audit Records
                      </span>
                      <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5">
                        Balance Invariant: ₹0.00 Net
                      </span>
                    </div>

                    {selectedTxDetail.ledgerEntries && selectedTxDetail.ledgerEntries.length > 0 ? (
                      <div className="space-y-2 mt-2">
                        {selectedTxDetail.ledgerEntries.map((l) => (
                          <div
                            key={l._id}
                            className={`p-2.5 border text-xs font-mono flex items-center justify-between ${
                              l.type === "DEBIT"
                                ? "bg-red-50/50 border-red-200"
                                : "bg-emerald-50/50 border-emerald-200"
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.2 font-bold ${
                                    l.type === "DEBIT" ? "bg-red-200 text-red-900" : "bg-emerald-200 text-emerald-900"
                                  }`}
                                >
                                  {l.type}
                                </span>
                                <span className="text-[#1A1A1A]">
                                  Account: {l.account ? String(l.account).slice(-8) : "—"}
                                </span>
                              </div>
                              <span className="text-[10px] text-[#5B6B7A] block mt-0.5">
                                Ledger ID: {l._id} · {formatDate(l.createdAt)}
                              </span>
                            </div>
                            <span
                              className={`text-sm font-semibold ${
                                l.type === "DEBIT" ? "text-red-700" : "text-emerald-700"
                              }`}
                            >
                              {l.type === "DEBIT" ? "−" : "+"} {formatCurrency(l.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#5B6B7A] italic py-3 text-center bg-neutral-50 border border-dashed border-[#D8D3C8]">
                        No ledger entries generated (Transaction was halted or blocked prior to financial execution).
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="mt-6 pt-3 border-t border-[#D8D3C8] text-right">
                <button
                  onClick={closeDetail}
                  className="px-4 py-2 bg-[#0F1E2E] text-white text-xs font-medium hover:bg-[#1A2E42] transition-colors cursor-pointer"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
