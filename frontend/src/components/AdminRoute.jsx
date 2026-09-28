import { Navigate, Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { logoutUser } from "../redux/slices/authSlice";

export default function AdminRoute({ children }) {
  const user = useSelector((s) => s.auth.user);
  const hasToken = !!localStorage.getItem("ledger_token");
  const dispatch = useDispatch();

  if (!user && !hasToken) {
    return <Navigate to="/login" replace />;
  }

  // If user role is loaded and is not ADMIN, show clean 403 Forbidden state
  if (user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#D8D3C8] shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-700 flex items-center justify-center mx-auto mb-4 font-mono font-bold text-xl border border-red-200">
            !
          </div>
          <h1 className="font-serif text-2xl text-[#1A1A1A] mb-2">
            Admin Access Required
          </h1>
          <p className="text-sm text-[#5B6B7A] mb-6 leading-relaxed">
            Your account ({user.email}) has standard <strong className="text-[#1A1A1A]">USER</strong> privileges. The Admin Monitoring Console is restricted to authenticated administrative personnel.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/dashboard"
              className="px-4 py-2 bg-[#0F1E2E] text-white text-sm font-medium hover:bg-[#1A2E42] transition-colors"
            >
              Return to User Dashboard
            </Link>
            <button
              onClick={() => dispatch(logoutUser())}
              className="px-4 py-2 border border-[#D8D3C8] text-[#5B6B7A] text-sm hover:text-[#1A1A1A] hover:bg-neutral-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
