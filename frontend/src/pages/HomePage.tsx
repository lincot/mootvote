import { Link } from "react-router";
import { btn } from "../btn";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

export default function HomePage() {
  const { t } = useTranslation();

  useLayoutEffect(() => {
    document.title = "MootVote";
  });

  return (
    <>
      <section>
        <div className="absolute bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900" />
        <div className="max-w-6xl mx-auto px-4 pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="mt-3 text-3xl md:text-5xl font-extrabold leading-tight">
                {t("home.headline") + " "}
                <span className="text-[#9945FF]">Solana</span>
              </h1>
              <p className="mt-4 max-w-2xl text-zinc-600 dark:text-zinc-300">
                {t("home.subhead_line1")}
                <br />
                {t("home.subhead_line2")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-8">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold mb-4">{t("home.how")}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.census_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.census_body")}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.poll_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.poll_body")}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.vote_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.vote_body")}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.tally_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.tally_body")}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.results_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.results_body")}
              </p>
            </div>
            <div className="rounded-2xl border p-4">
              <h3 className="font-semibold">{t("home.security_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
                {t("home.security_body")}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-6">
        <div className="max-w-6xl mx-auto px-4">
          <div className="rounded-2xl border p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">{t("home.cta_title")}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {t("home.cta_body")}
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                to="/censuses"
                className={btn(true)}
              >
                {t("home.cta_census")}
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            {t("home.disclaimer")}
          </p>
        </div>
      </section>
    </>
  );
}
