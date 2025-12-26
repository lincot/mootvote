import { useTranslation } from "react-i18next";
import { useKeyringCtx } from "../keyring.tsx";

export const ZkAccountsButton: React.FC<{ onClick: () => void }> = (
  { onClick },
) => {
  const { t } = useTranslation();
  const KR = useKeyringCtx();
  let label = t("keyring.zk_accounts");
  if (!KR.locked && KR.accounts.length) {
    const a = KR.accounts[KR.active] ?? KR.accounts[0];
    label = a.name;
  }
  return (
    <button
      type="button"
      className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      onClick={onClick}
    >
      {label}
    </button>
  );
};
