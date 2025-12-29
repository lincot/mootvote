import * as Select from "@radix-ui/react-select";
import { useTranslation } from "react-i18next";

const LANGS = [
  { code: "en", long: "English", short: "EN" },
  { code: "ru", long: "Русский", short: "RU" },
];

export default function LanguageSelect(
  { className = "" }: { className?: string },
) {
  const { i18n, t } = useTranslation();
  const cur = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  const short = LANGS.find((l) => l.code === cur)?.short ?? cur.toUpperCase();

  return (
    <Select.Root value={cur} onValueChange={(v) => i18n.changeLanguage(v)}>
      <Select.Trigger
        aria-label={t("language")}
        className={[
          className,
          "items-center gap-2 px-3 py-1.5 text-sm rounded-lg",
          "border border-zinc-300",
          "dark:border-neutral-700",
          "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          "focus:outline-none focus:ring-2 focus:ring-zinc-400/40 dark:focus:ring-zinc-500/30",
        ].join(" ")}
      >
        <Select.Value aria-hidden>{short}</Select.Value>
        <Select.Icon aria-hidden>▾</Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className={[
            "z-[70]",
            "overflow-hidden rounded-lg border bg-white shadow-lg",
            "border-zinc-200 dark:border-neutral-700 dark:bg-neutral-900",
          ].join(" ")}
        >
          <Select.Viewport className="p-1">
            {LANGS.map((l) => (
              <Select.Item
                key={l.code}
                value={l.code}
                className={[
                  "relative flex items-center rounded px-3 py-1.5 text-sm",
                  "cursor-pointer select-none",
                  "text-zinc-900 dark:text-zinc-100",
                  "data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-neutral-800",
                ].join(" ")}
              >
                <Select.ItemText>{l.long}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
