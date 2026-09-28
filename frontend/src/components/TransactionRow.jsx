function formatAmount(amount, type) {
  const sign = type === "credit" ? "+" : "−";
  const abs = Math.abs(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign} ₹${abs}`;
}

function formatDate(iso) {
  if (!iso) return "Just now";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function TransactionRow({ tx }) {
  const isCredit = tx.type === "credit";
  const status = tx.status || "COMPLETED";

  return (
    <div className="flex items-center justify-between py-3 border-b border-[#D8D3C8] last:border-b-0">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[#1A1A1A]">
            {tx.counterparty || (isCredit ? "Deposit" : "Transfer")}
          </p>
          {status !== "COMPLETED" && (
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                status === "FAILED"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {status}
            </span>
          )}
        </div>
        <p className="text-xs text-[#5B6B7A]">
          {formatDate(tx.createdAt)}
          {tx.note ? ` · ${tx.note}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p
          className={`font-mono text-sm font-semibold ${
            isCredit ? "text-[#1F7A5C]" : "text-[#1A1A1A]"
          }`}
        >
          {formatAmount(tx.amount, tx.type)}
        </p>
        {tx.balanceAfter != null && (
          <p className="text-xs text-[#5B6B7A] font-mono">
            Bal ₹{tx.balanceAfter.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
