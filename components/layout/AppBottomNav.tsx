type Tab = "dashboard" | "capture" | "transactions" | "accounts";

interface AppBottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function AppBottomNav({ activeTab, onTabChange }: AppBottomNavProps) {
  return (
    <nav className="fixed bottom-0 w-full z-50 rounded-t-xl border-t border-outline-variant/30 bg-surface-container/90 backdrop-blur-xl flex justify-around items-center h-16 px-4">
      <button
        className={`flex flex-col items-center justify-center rounded-lg transition-colors active:scale-90 transition-all duration-200 px-3 py-1 ${
          activeTab === "dashboard"
            ? "text-primary"
            : "text-on-surface-variant hover:bg-surface-variant/50"
        }`}
        onClick={() => onTabChange("dashboard")}
      >
        <span>dashboard</span>
        <span className="text-xs font-semibold uppercase tracking-wider">Dashboard</span>
      </button>
      <button
        className={`flex flex-col items-center justify-center rounded-full px-4 py-1 active:scale-90 transition-all duration-200 ${
          activeTab === "capture"
            ? "bg-secondary-container text-on-secondary-container"
            : "text-on-surface-variant"
        }`}
        onClick={() => onTabChange("capture")}
      >
        <span style={{ fontVariationSettings: "'FILL' 1" }}>center_focus_strong</span>
        <span className="text-xs font-semibold uppercase tracking-wider">Capture</span>
      </button>
      <button
        className={`flex flex-col items-center justify-center rounded-lg transition-colors active:scale-90 transition-all duration-200 px-3 py-1 ${
          activeTab === "transactions"
            ? "text-primary"
            : "text-on-surface-variant hover:bg-surface-variant/50"
        }`}
        onClick={() => onTabChange("transactions")}
      >
        <span>receipt_long</span>
        <span className="text-xs font-semibold uppercase tracking-wider">Transactions</span>
      </button>
      <button
        className={`flex flex-col items-center justify-center rounded-lg transition-colors active:scale-90 transition-all duration-200 px-3 py-1 ${
          activeTab === "accounts"
            ? "text-primary"
            : "text-on-surface-variant hover:bg-surface-variant/50"
        }`}
        onClick={() => onTabChange("accounts")}
      >
        <span>account_balance_wallet</span>
        <span className="text-xs font-semibold uppercase tracking-wider">Accounts</span>
      </button>
    </nav>
  );
}
