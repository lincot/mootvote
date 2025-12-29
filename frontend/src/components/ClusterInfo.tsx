import { CLUSTER, OTHER_CLUSTER_URL } from "../env.tsx";
import { useTranslation } from "react-i18next";

export default function ClusterInfo(
  { className = "" }: { className?: string },
) {
  const { t } = useTranslation();

  return (
    <div className={"flex items-center gap-1 " + className}>
      {CLUSTER === "devnet" && (
        <span
          className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
          title={t("devnet_info")}
        >
          DEVNET
        </span>
      )}
      {OTHER_CLUSTER_URL && (
        <a
          href={OTHER_CLUSTER_URL}
          className="text-xs underline opacity-80 hover:opacity-100"
          target="_self"
        >
          {CLUSTER === "devnet" ? "Go to mainnet" : "Go to devnet"}
        </a>
      )}
    </div>
  );
}
