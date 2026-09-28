import { useState } from "react";

export default function StatCard({ label, value, accent = false, copyable = false }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!value || value === "—") return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isLongValue = typeof value === "string" && value.length > 15;

  return (
    <div className="bg-white border border-[#D8D3C8] px-5 py-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[#5B6B7A] text-xs font-medium uppercase tracking-wider">{label}</p>
        {copyable && value && value !== "—" && (
          <button
            onClick={handleCopy}
            type="button"
            className="text-[11px] text-[#1F7A5C] hover:text-[#165a44] transition-colors font-medium flex items-center gap-1 cursor-pointer"
            title="Copy account number"
          >
            {copied ? (
              <span className="text-emerald-700 font-semibold">✓ Copied</span>
            ) : (
              <span>Copy</span>
            )}
          </button>
        )}
      </div>

      <p
        className={`font-mono ${
          isLongValue
            ? "text-sm sm:text-base break-all leading-snug py-1 font-semibold text-[#1A1A1A] select-all"
            : `text-2xl ${accent ? "text-[#1F7A5C]" : "text-[#1A1A1A]"}`
        }`}
      >
        {value}
      </p>
    </div>
  );
}
