import { useKeyringCtx } from "../keyring.tsx";

export const ZkAccountsButton: React.FC<{ onClick: () => void }> = (
  { onClick },
) => {
  const KR = useKeyringCtx();
  let label = "ZK Accounts";
  if (!KR.locked && KR.accounts.length) {
    const a = KR.accounts[KR.active] ?? KR.accounts[0];
    label = a.name;
  }
  return (
    <button
      type="button"
      className="rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      onClick={onClick}
    >
      {label}
    </button>
  );
};
