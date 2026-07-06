interface AppHeaderProps {
  privacyOn: boolean;
  onTogglePrivacy: () => void;
}

export function AppHeader({ privacyOn, onTogglePrivacy }: AppHeaderProps) {
  return (
    <header className="w-full top-0 sticky z-50 bg-background/80 backdrop-blur-md flex justify-between items-center px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center border border-outline-variant">
          <span className="text-primary" style={{ fontSize: "20px" }}>
            account_circle
          </span>
        </div>
        <span className="text-2xl font-bold text-primary">FinanceOS</span>
      </div>
      <button
        className="text-on-surface-variant p-2 hover:text-primary transition-colors"
        aria-label="Hide balances"
        onClick={onTogglePrivacy}
      >
        {privacyOn ? "visibility_off" : "visibility"}
      </button>
    </header>
  );
}
