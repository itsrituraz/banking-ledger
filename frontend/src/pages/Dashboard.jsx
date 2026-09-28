import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import StatCard from "../components/StatCard";
import TransactionRow from "../components/TransactionRow";
import { fetchAccount } from "../redux/slices/accountSlice";
import { fetchTransactions } from "../redux/slices/transactionsSlice";

function formatLastLogin(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const account = useSelector((s) => s.account.data);
  const { items: transactions } = useSelector((s) => s.transactions);

  useEffect(() => {
    dispatch(fetchAccount());
    dispatch(fetchTransactions({ limit: 5 }));
  }, [dispatch]);

  const recent = transactions.slice(0, 5);
  const lastLogin = formatLastLogin(account?.lastLogin);

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Welcome banner */}
        <div className="bg-white border border-[#D8D3C8] mb-8">
          <div className="px-6 py-4 border-b border-[#D8D3C8] bg-[#0F1E2E] text-[#F7F5F0] flex items-center justify-between">
            <span className="font-serif text-lg">Ledger</span>
            {lastLogin && (
              <span className="text-xs text-[#9FB0BE]">
                Last sign-in: {lastLogin}
              </span>
            )}
          </div>
          <div className="px-6 py-6">
            <p className="text-[#5B6B7A] text-sm mb-1">Welcome back,</p>
            <h1 className="font-serif text-3xl text-[#1A1A1A]">
              {account?.name || user?.name || "there"}
            </h1>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Current balance"
            value={
              account?.balance != null
                ? `₹${account.balance.toLocaleString()}`
                : "—"
            }
            accent
          />
          <StatCard
            label="Account number"
            value={account?.accountNumber || account?._id || "—"}
            copyable={true}
          />
          <StatCard label="Currency" value={account?.currency || "INR"} />
        </div>

        {/* Recent transactions */}
        <div className="bg-white border border-[#D8D3C8] px-6 py-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-xl text-[#1A1A1A]">
              Recent activity
            </h2>
            <Link
              to="/transactions"
              className="text-sm text-[#1F7A5C] hover:underline"
            >
              View all
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="text-[#5B6B7A] text-sm py-6">
              No transactions yet. New entries you record will appear here.
            </p>
          ) : (
            <div>
              {recent.map((tx) => (
                <TransactionRow key={tx.id || tx._id} tx={tx} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
