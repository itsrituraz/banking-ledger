import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import TransactionRow from "../components/TransactionRow";
import { fetchTransactions } from "../redux/slices/transactionsSlice";

const FILTERS = [
  { label: "All", value: "all" },
  { label: "Credits", value: "credit" },
  { label: "Debits", value: "debit" },
];

export default function Transactions() {
  const dispatch = useDispatch();
  const { items, status, total } = useSelector((s) => s.transactions);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    dispatch(fetchTransactions({ type: filter }));
  }, [dispatch, filter]);

  const visible = items.filter((tx) => {
    const matchesFilter =
      filter === "all" ? true : tx.type?.toLowerCase() === filter.toLowerCase();
    const matchesSearch = search
      ? tx.counterparty?.toLowerCase().includes(search.toLowerCase()) ||
        tx.note?.toLowerCase().includes(search.toLowerCase())
      : true;
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-serif text-3xl text-[#1A1A1A] mb-1">
              Transactions
            </h1>
            <p className="text-[#5B6B7A] text-sm">
              {total ? `${total} entries on record` : "Ledger entry history"}
            </p>
          </div>
          <Link
            to="/transactions/new"
            className="py-2 px-4 bg-[#1F7A5C] text-white text-sm font-medium hover:bg-[#1a684e] transition-colors"
          >
            New entry
          </Link>
        </div>

        {/* Filters + search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex border border-[#D8D3C8] bg-white">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-4 py-2 text-sm transition-colors ${
                  filter === f.value
                    ? "bg-[#0F1E2E] text-white"
                    : "text-[#5B6B7A] hover:text-[#1A1A1A]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by counterparty or note"
            className="flex-1 px-3 py-2 border border-[#D8D3C8] bg-white text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1F7A5C]"
          />
        </div>

        <div className="bg-white border border-[#D8D3C8] px-6 py-5">
          {status === "loading" && (
            <p className="text-[#5B6B7A] text-sm py-6">Loading entries…</p>
          )}

          {status !== "loading" && visible.length === 0 && (
            <p className="text-[#5B6B7A] text-sm py-6">
              No transactions match this view.
            </p>
          )}

          {status !== "loading" &&
            visible.map((tx) => <TransactionRow key={tx.id || tx._id} tx={tx} />)}
        </div>
      </div>
    </div>
  );
}
