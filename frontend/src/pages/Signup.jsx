import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { signup } from "../redux/slices/authSlice";

export default function Signup() {
  const [name, setName] = useState("");
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
    if (!name || !email || !password) return;
    dispatch(signup({ name, email, password }));
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F7F5F0] p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm" noValidate>
        <h1 className="font-serif text-3xl text-[#1A1A1A] mb-1">
          Create your account
        </h1>
        <p className="text-[#5B6B7A] text-sm mb-8">
          Open a ledger account to start tracking transactions.
        </p>

        <label className="block text-sm text-[#1A1A1A] mb-1.5">Full name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ritu Raj"
          className="w-full mb-4 px-3 py-2.5 border border-[#D8D3C8] bg-white text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1F7A5C] focus:border-transparent"
        />

        <label className="block text-sm text-[#1A1A1A] mb-1.5">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full mb-4 px-3 py-2.5 border border-[#D8D3C8] bg-white text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1F7A5C] focus:border-transparent"
        />

        <label className="block text-sm text-[#1A1A1A] mb-1.5">Password</label>
        <input
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
          {status === "loading" ? "Creating account…" : "Create account"}
        </button>

        <p className="text-sm text-[#5B6B7A] mt-6 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-[#1F7A5C] hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
