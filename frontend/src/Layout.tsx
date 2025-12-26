import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import { CLUSTER, GITHUB_URL, OTHER_CLUSTER_URL } from "./env.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { ZkAccountsButton } from "./components/ZkAccountsButton.tsx";
import LanguageSelect from "./components/LanguageSelect.tsx";
import { useTranslation } from "react-i18next";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  [
    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    "hover:bg-gray-200 hover:text-black dark:hover:bg-zinc-800 dark:hover:text-white",
    isActive
      ? "bg-gray-200 text-black dark:bg-zinc-800 dark:text-white"
      : "text-gray-700 dark:text-zinc-300",
  ].join(" ");

export const Layout: React.FC<
  { setShowAccounts: (showAccounts: boolean) => void }
> = (
  { setShowAccounts },
) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState<number>(72);

  useEffect(() => {
    if (!headerRef.current) return;
    setHeaderH(headerRef.current.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height;
      if (h) setHeaderH(h);
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-stone-900 dark:to-stone-800 text-gray-900 dark:text-zinc-100">
      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-gray-200/60 dark:border-zinc-800/60 bg-white/70 dark:bg-zinc-800/70 backdrop-blur"
      >
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden rounded-lg border px-2 py-1 text-sm"
              onClick={() => setOpen((v) => !v)}
              aria-label={t("nav.aria.toggle")}
            >
              ☰
            </button>
            <h1 className="text-xl font-bold leading-none">
              <Link
                to="/"
                aria-label={t("nav.aria.home")}
              >
                MootVote
              </Link>
            </h1>
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

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSelect />
            <ZkAccountsButton onClick={() => setShowAccounts(true)} />
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 flex gap-4">
        {/* Sidebar (desktop) */}
        <aside
          className="hidden md:flex w-60 shrink-0 pt-4 sticky flex-col justify-between"
          style={{ top: headerH, height: `calc(100vh - ${headerH + 1}px)` }}
        >
          <nav className="space-y-1">
            <NavLink to="/polls" className={navItemClass}>
              {t("nav.polls")}
            </NavLink>
            <NavLink to="/censuses" className={navItemClass}>
              {t("nav.censuses")}
            </NavLink>
          </nav>

          {/* Socials footer */}
          <div className="mt-auto pt-4 border-t border-gray-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg p-2 hover:bg-gray-200 dark:hover:bg-zinc-800"
                aria-label="GitHub"
                title="GitHub"
              >
                <img
                  src="/icons/github-mark.svg"
                  alt="GitHub"
                  className="h-5 w-5 block dark:hidden"
                />
                <img
                  src="/icons/github-mark-white.svg"
                  alt="GitHub"
                  className="h-5 w-5 hidden dark:block"
                />
              </a>
            </div>
          </div>
        </aside>

        {/* Drawer (mobile) */}
        {open && (
          <div
            className="md:hidden fixed inset-x-0 bottom-0 z-30"
            style={{ top: headerH }}
            onClick={() => setOpen(false)}
          >
            <div
              className="absolute inset-0 bg-black/30"
              aria-hidden="true"
            />
            <div
              className="absolute left-0 top-0 h-full w-64 bg-white dark:bg-zinc-950 border-r border-gray-200 dark:border-zinc-800 p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-full flex-col">
                <nav className="space-y-1">
                  <NavLink
                    to="/polls"
                    className={navItemClass}
                    onClick={() => setOpen(false)}
                  >
                    {t("nav.polls")}
                  </NavLink>
                  <NavLink
                    to="/censuses"
                    className={navItemClass}
                    onClick={() => setOpen(false)}
                  >
                    {t("nav.censuses")}
                  </NavLink>
                </nav>

                {/* Socials footer (mobile) */}
                <div className="mt-auto pt-3 border-t border-gray-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <a
                      href={GITHUB_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center rounded-lg p-2 hover:bg-gray-200 dark:hover:bg-zinc-800"
                      aria-label="GitHub"
                      title="GitHub"
                    >
                      <img
                        src="/icons/github-mark.svg"
                        alt="GitHub"
                        className="h-5 w-5 block dark:hidden"
                      />
                      <img
                        src="/icons/github-mark-white.svg"
                        alt="GitHub"
                        className="h-5 w-5 hidden dark:block"
                      />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 py-4">
          <Outlet />
          <div
            id="content-overlay-root"
            className="absolute inset-0 pointer-events-none z-30"
          />
        </main>
      </div>
    </div>
  );
};
