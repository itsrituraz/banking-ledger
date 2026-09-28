import { NavLink, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { logoutUser } from "../redux/slices/authSlice";

const linkClass = ({ isActive }) =>
  `text-sm px-3 py-2 transition-colors ${
    isActive ? "text-white" : "text-[#9FB0BE] hover:text-white"
  }`;

export default function Navbar() {
  const user = useSelector((s) => s.auth.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  async function handleLogout() {
    await dispatch(logoutUser());
    navigate("/login");
  }

  return (
    <nav className="bg-[#0F1E2E] px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <span className="font-serif text-lg text-white">Ledger</span>
        <div className="hidden sm:flex">
          <NavLink to="/dashboard" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/transactions" className={linkClass}>
            Transactions
          </NavLink>
          <NavLink to="/transactions/new" className={linkClass}>
            New entry
          </NavLink>
          {user?.role === "ADMIN" && (
            <NavLink
              to="/admin/dashboard"
              className={({ isActive }) =>
                `text-sm px-3 py-2 transition-colors flex items-center gap-1.5 ${
                  isActive ? "text-amber-300 font-semibold" : "text-amber-400/80 hover:text-amber-300"
                }`
              }
            >
              <span>Admin Console</span>
              <span className="text-[10px] uppercase font-mono px-1 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Admin
              </span>
            </NavLink>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {user?.name && (
          <div className="flex items-center gap-2">
            <span className="text-[#9FB0BE] text-sm hidden sm:inline">
              {user.name}
            </span>
            {user?.role === "ADMIN" && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 hidden sm:inline">
                ADMIN
              </span>
            )}
          </div>
        )}
        <button
          onClick={handleLogout}
          className="text-xs text-[#9FB0BE] hover:text-white transition-colors border border-[#2A3B4D] px-3 py-1.5"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
