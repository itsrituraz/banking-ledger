// Thin fetch wrapper. Point BASE_URL at your backend.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

function getToken() {
  return localStorage.getItem("ledger_token");
}

// Track if a refresh call is currently pending to prevent redundant simultaneous requests
let isRefreshing = null;

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = await res.json().catch(() => null);

  // --- AUTOMATIC REFRESH INTERCEPTOR ---
  // If unauthorized (expired token) and this wasn't already a login/refresh request
  if (res.status === 401 && auth && path !== "/auth/refresh") {
    try {
      // Deduplicate refresh requests if multiple components fire requests at once
      if (!isRefreshing) {
        isRefreshing = fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", // Sends the HTTP-only refresh token cookie
        }).then(async (refreshRes) => {
          if (!refreshRes.ok) throw new Error("Refresh expired");
          return refreshRes.json();
        });
      }

      // Wait for the new token
      const refreshData = await isRefreshing;
      isRefreshing = null; // Clear lock

      if (refreshData?.token) {
        // Save the new access token
        localStorage.setItem("ledger_token", refreshData.token);
        
        // Re-build headers with the new valid token
        headers.Authorization = `Bearer ${refreshData.token}`;
        
        // Retry the original request
        res = await fetch(`${BASE_URL}${path}`, {
          method,
          headers,
          credentials: "include",
          body: body ? JSON.stringify(body) : undefined,
        });
        data = await res.json().catch(() => null);
      }
    } catch (refreshErr) {
      isRefreshing = null;
      // The refresh token itself is expired or invalid. Wipe session and boot to login.
      localStorage.removeItem("ledger_token");
      window.location.href = "/login";
      throw new Error("Session expired. Please log in again.");
    }
  }
  // -------------------------------------

  if (!res.ok) {
    const message = data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  // --- Auth ---
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password }, auth: false }),

  signup: (payload) =>
    request("/auth/register", { method: "POST", body: payload, auth: false }),

  logout: () => {
    localStorage.removeItem("ledger_token"); // Clean up local storage on logout
    return request("/auth/logout", { method: "POST" });
  },

  getMe: () =>
    request("/auth/me"),

  // --- Account ---
  getAccount: () => request("/accounts"),

  // --- Transactions ---
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/transactions${qs ? `?${qs}` : ""}`);
  },

  createTransaction: (payload) =>
    request("/transactions", { method: "POST", body: payload }),

  // --- Admin Monitoring ---
  getAdminStats: () =>
    request("/admin/dashboard/stats"),

  getAdminTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/transactions${qs ? `?${qs}` : ""}`);
  },

  getAdminFlaggedTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/transactions/flagged${qs ? `?${qs}` : ""}`);
  },

  getAdminTransactionById: (id) =>
    request(`/admin/transactions/${id}`),

  getAdminUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/users${qs ? `?${qs}` : ""}`);
  },
};

export { getToken, BASE_URL };
