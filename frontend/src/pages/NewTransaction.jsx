import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { fetchAccount } from "../redux/slices/accountSlice";
import { createTransaction, resetCreateStatus } from "../redux/slices/transactionsSlice";

const DEFAULT_RECEIVER_ACCOUNT_ID = "6a931943fc5df43d6a7c6a37";

export default function NewTransaction() {
  const [amount, setAmount] = useState("");
  const [receiverAccount, setReceiverAccount] = useState(DEFAULT_RECEIVER_ACCOUNT_ID);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { createStatus, error: apiError } = useSelector((s) => s.transactions);
  const account = useSelector((s) => s.account.data);

  useEffect(() => {
    dispatch(resetCreateStatus());
    if (!account) {
      dispatch(fetchAccount());
    }
  }, [dispatch, account]);

  useEffect(() => {
    if (createStatus === "succeeded") {
      dispatch(fetchAccount());
      navigate("/transactions");
    }
  }, [createStatus, navigate, dispatch]);

  function handleSubmit(e) {
    e.preventDefault();
    setValidationError("");

    if (!account?._id) {
      setValidationError("Your account details are not loaded yet. Please wait.");
      return;
    }

    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setValidationError("Please enter a valid positive amount.");
      return;
    }

    if (account.balance != null && numAmount > account.balance) {
      setValidationError(`Insufficient balance. Current balance is ₹${account.balance}.`);
      return;
    }

    const trimmedReceiver = receiverAccount.trim();
    if (!trimmedReceiver) {
      setValidationError("Please provide a receiver account ID.");
      return;
    }

    if (trimmedReceiver === account._id) {
      setValidationError("Cannot transfer to the same account.");
      return;
    }

    if (!/^[0-9a-fA-F]{24}$/.test(trimmedReceiver)) {
      setValidationError("Receiver account ID must be a valid 24-character hexadecimal ID.");
      return;
    }

    dispatch(
      createTransaction({
        fromAccount: account._id,
        toAccount: trimmedReceiver,
        amount: numAmount,
        idempotencyKey: crypto.randomUUID(),
      })
    );
  }

  const displayError = validationError || apiError;

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <Navbar />

      <div className="max-w-md mx-auto px-6 py-10">
        <h1 className="font-serif text-3xl text-[#1A1A1A] mb-1">
          Send Money
        </h1>

        <p className="text-[#5B6B7A] text-sm mb-8">
          Transfer money securely to any ledger account.
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[#D8D3C8] p-6 shadow-sm"
        >
          {account && (
            <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded text-xs flex justify-between items-center">
              <span className="text-[#5B6B7A]">Available Balance:</span>
              <span className="font-semibold text-emerald-800 text-sm">
                ₹{account.balance != null ? account.balance.toLocaleString() : 0}
              </span>
            </div>
          )}

          <label className="block text-sm mb-2 font-medium text-[#1A1A1A]">
            Amount (₹)
          </label>

          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setValidationError("");
            }}
            className="w-full border border-[#D8D3C8] p-3 mb-5 focus:outline-none focus:ring-2 focus:ring-[#1F7A5C]"
            placeholder="e.g. 100"
            required
          />

          <label className="block text-sm mb-2 font-medium text-[#1A1A1A]">
            Receiver Account ID
          </label>

          <input
            value={receiverAccount}
            onChange={(e) => {
              setReceiverAccount(e.target.value);
              setValidationError("");
            }}
            className="w-full border border-[#D8D3C8] p-3 mb-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#1F7A5C]"
            placeholder="24-character Account ID"
            required
          />
          <p className="text-[11px] text-[#5B6B7A] mb-5">
            Default set to verified demo receiver account.
          </p>

          <label className="block text-sm mb-2 font-medium text-[#1A1A1A]">
            Note (optional)
          </label>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-[#D8D3C8] p-3 mb-5 focus:outline-none focus:ring-2 focus:ring-[#1F7A5C]"
            placeholder="e.g. Monthly settlement"
          />

          {displayError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 mb-4 rounded">
              {displayError}
            </div>
          )}

          <button
            type="submit"
            disabled={createStatus === "loading"}
            className="w-full bg-[#0F1E2E] text-white py-3 font-medium hover:bg-[#1A2E42] disabled:opacity-50 transition-colors"
          >
            {createStatus === "loading"
              ? "Processing transfer..."
              : "Confirm & Send"}
          </button>
        </form>
      </div>
    </div>
  );
}