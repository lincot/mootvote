import { useTranslation } from "react-i18next";

export default function UnlockToView() {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl mx-auto p-4">
      <p className="text-sm text-amber-700 dark:text-amber-500">
        {t("unlock_to_view")}
      </p>
    </div>
  );
}
