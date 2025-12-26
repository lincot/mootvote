import { useWallet } from "@solana/wallet-adapter-react";
import { useTranslation } from "react-i18next";

export default function ConnectSolana() {
  const { t } = useTranslation();
  const wallet = useWallet();

  return (
    <>
      {!wallet.publicKey && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          {t("connect_solana")}
        </div>
      )}
    </>
  );
}
