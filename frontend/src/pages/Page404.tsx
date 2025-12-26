import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

export default function Page404() {
  const { t } = useTranslation();

  useLayoutEffect(() => {
    document.title = t("not_found");
  });

  return (
    <div className="flex items-center justify-center">
      <h3>{t("not_found")}</h3>
    </div>
  );
}
