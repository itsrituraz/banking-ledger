import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../redux/slices/authSlice";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { status, error, user } = useSelector((s) => s.auth);

  useEffect(() => {
    if (user) navigate("/dashboard");
  }, [user, navigate]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;
    dispatch(login({ email, password }));
  }

  return (
    <div className="min-h-screen w-full flex bg-[#F7F5F0]">
      <div className="hidden md:flex md:w-5/12 bg-[#0F1E2E] text-[#F7F5F0] flex-col justify-between p-12">
        <div className="font-serif text-2xl tracking-tight">Ledger</div>
        <div>
          <p className="font-serif text-4xl leading-tight mb-4">
            Every entry,
            <br />
            accounted for.
          </p>
          <p className="text-[#9FB0BE] text-sm leading-relaxed max-w-sm">
            Double-entry accuracy, reconciled in real time. Sign in to see
            where your accounts stand.
          </p>
        </div>
        <div className="text-[#5B6B7A] text-xs font-mono">
          Statement generated on login
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-sm" noValidate>
          <h1 className="font-serif text-3xl text-[#1A1A1A] mb-1">Sign in</h1>
          <p className="text-[#5B6B7A] text-sm mb-8">
            Access your ledger and account balances.
          </p>

          <label className="block text-sm text-[#1A1A1A] mb-1.5" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full mb-4 px-3 py-2.5 border border-[#D8D3C8] bg-white text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1F7A5C] focus:border-transparent"
          />

          <label className="block text-sm text-[#1A1A1A] mb-1.5" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full mb-2 px-3 py-2.5 border border-[#D8D3C8] bg-white text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1F7A5C] focus:border-transparent"
          />

          {error && (
            <p className="text-sm text-[#B3413A] mt-2 mb-2" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full mt-6 py-2.5 bg-[#1F7A5C] text-white font-medium hover:bg-[#1a684e] disabled:opacity-60 transition-colors"
          >
            {status === "loading" ? "Signing in…" : "Sign in"}
          </button>

          <p className="text-sm text-[#5B6B7A] mt-6 text-center">
            New here?{" "}
            <Link to="/signup" className="text-[#1F7A5C] hover:underline">
              Create an account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
