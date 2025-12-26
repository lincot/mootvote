import { bytesToHex } from "@noble/hashes/utils";
import { idForAccount, useKeyringCtx, useRevoKeysCtx } from "../keyring.tsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const cn = (...x: Array<string | false | null | undefined>) =>
  x.filter(Boolean).join(" ");

export const AccountDrawer: React.FC<{ open: boolean; onClose: () => void }> = (
  { open, onClose },
) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 transition",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {/* backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      {/* panel */}
      <div
        className={cn(
          "absolute right-0 top-0 h-full w-full max-w-md",
          "bg-white dark:bg-neutral-900 border-l border-gray-200 dark:border-neutral-800",
          "shadow-xl transform transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-neutral-800">
          <h3 className="text-lg font-semibold">{t("keyring.zk_accounts")}</h3>
          <button
            className="rounded px-2 py-1 border dark:border-neutral-700"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-4 overflow-y-auto h-[calc(100%-56px)]">
          <KeyringPanel open={open} />
        </div>
      </div>
    </div>
  );
};

const KeyringPanel: React.FC<{ open: boolean }> = ({ open }) => {
  const { t } = useTranslation();
  const KR = useKeyringCtx();
  const [newName, setNewName] = useState("");
  const [importName, setImportName] = useState("");
  const [importPrv, setImportPrv] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const creating = KR.hasKeyring === false;
  const RK = useRevoKeysCtx();

  useEffect(() => {
    if (!open) {
      KR.clearImportStatus();
      setNewName("");
      setImportName("");
      setImportPrv("");
    }
  }, [open, KR]);

  if (KR.locked) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-3">
          {creating ? t("keyring.create") : t("keyring.unlock")}
        </h2>
        <div className="space-y-2">
          <input
            type="password"
            value={KR.pass}
            onChange={(e) => KR.setPass(e.target.value)}
            placeholder={creating
              ? t("keyring.set_passphrase")
              : t("keyring.passphrase")}
            className="w-full rounded border px-3 py-2 border-gray-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
          />
          {creating && (
            <input
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="Confirm passphrase"
              className="w-full rounded border px-3 py-2 border-gray-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
            />
          )}
          <button
            onClick={async () => {
              if (creating) {
                if (!KR.pass || KR.pass.length < 4) {
                  alert("Use a passphrase at least 4 characters long.");
                  return;
                }
                if (KR.pass !== confirmPass) {
                  alert("Passphrases do not match.");
                  return;
                }
              }
              await KR.unlock();
            }}
            className="mt-1 rounded-lg px-4 py-2 bg-black text-white hover:bg-neutral-800"
          >
            {creating ? t("keyring.create") : t("keyring.unlock")}
          </button>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {creating
              ? t("keyring.sets_passphrase")
              : t("keyring.is_encrypted")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium">
            {t("keyring.label")}
          </label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded border px-3 py-2 border-gray-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
          />
        </div>
        <button
          onClick={() => KR.addNew(newName || `acct-${KR.accounts.length + 1}`)}
          className="rounded-lg px-4 py-2 bg-black text-white hover:bg-neutral-800"
        >
          {t("keyring.new")}
        </button>
        <button
          className="rounded-lg px-4 py-2 border dark:border-neutral-700"
          onClick={KR.exportJson}
        >
          {t("keyring.export")}
        </button>
      </div>

      <div className="mt-4 flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium">
            {t("keyring.import_name")}
          </label>
          <input
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            className="w-full rounded border px-3 py-2 border-gray-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
          />
        </div>
        <div className="flex-[2]">
          <label className="block text-sm font-medium">
            {t("keyring.private_seed")}
          </label>
          <input
            value={importPrv}
            onChange={(e) => setImportPrv(e.target.value)}
            className="w-full rounded border px-3 py-2 font-mono border-gray-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
          />
        </div>
        <button
          onClick={() => KR.importPrv(importName, importPrv)}
          className="rounded-lg px-4 py-2 border dark:border-neutral-700"
        >
          {t("keyring.import")}
        </button>
      </div>
      {KR.importStatus && (
        <div
          className={`mt-2 text-sm ${
            KR.importStatus.ok ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {KR.importStatus.msg}
        </div>
      )}

      <div className="mt-4">
        {KR.accounts.length === 0 && (
          <p className="text-sm italic text-neutral-600 dark:text-neutral-300">
            {t("keyring.no_accounts")}
          </p>
        )}
        <div className="space-y-2">
          {KR.accounts.map((a, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl border p-3 border-gray-200 dark:border-neutral-800",
                i === KR.active && "border-gray-900 dark:border-white",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{a.name}</div>
                <div className="flex gap-2">
                  <button
                    className="text-xs underline"
                    onClick={() => KR.setActive(i)}
                  >
                    {t("keyring.use")}
                  </button>
                  <button
                    className="text-xs underline text-red-600"
                    onClick={() => KR.removeAt(i)}
                  >
                    {t("keyring.delete")}
                  </button>
                </div>
              </div>
              <div className="text-xs font-mono break-all mt-2">
                pkX: 0x{a.pub[0].toString(16)}
              </div>
              <div className="text-xs font-mono break-all">
                pkY: 0x{a.pub[1].toString(16)}
              </div>
              <details className="mt-1">
                <summary className="text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
                  {t("keyring.show_private_key")}
                </summary>
                <div className="text-xs font-mono break-all">
                  0x{bytesToHex(a.prv)}
                </div>
              </details>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {t("keyring.revoting_keys")}
            {KR.accounts[KR.active]?.name
              ? ` for ${KR.accounts[KR.active]?.name}`
              : ""}
          </h3>
          <button
            className="text-xs underline"
            onClick={() => {
              const acct = KR.accounts[KR.active];
              if (!acct) return;
              const id = idForAccount(acct);
              RK.exportRevo(id, `revo-keys-${acct.name}.json`);
            }}
            disabled={!RK.loaded || !KR.accounts[KR.active]}
            title={t("keyring.export_title")}
          >
            {t("keyring.export")}
          </button>
        </div>
        {!RK.loaded
          ? (
            <div className="text-sm opacity-70 mt-2">
              {t("loading.loading")}
            </div>
          )
          : (
            <div className="mt-2">
              {(() => {
                const acct = KR.accounts[KR.active];
                if (!acct) {
                  return (
                    <div className="text-sm opacity-70">
                      {t("keyring.no_active")}
                    </div>
                  );
                }
                const accountId = idForAccount(acct);
                const entries = Object.entries(RK.map[accountId] || {}).sort(
                  (a, b) => {
                    if (a[0] > b[0]) {
                      return 1;
                    } else if (a < b) {
                      return -1;
                    } else {
                      return 0;
                    }
                  },
                );
                if (entries.length === 0) {
                  return (
                    <div className="text-sm opacity-70">
                      {t("keyring.no_revoting")}
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {entries.map(([pollId, k]) => (
                      <div key={pollId} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium truncate">
                            {k.title}
                          </div>
                          <div className="text-xs opacity-70 ml-2 shrink-0">
                            #{pollId}
                          </div>
                        </div>
                        <details className="mt-1">
                          <summary className="text-xs text-gray-600 cursor-pointer select-none">
                            {t("keyring.show_secret")}
                          </summary>
                          <div className="text-xs font-mono break-all">
                            {t("keyring.secret")} 0x{k.sk.toString(16)}
                          </div>
                        </details>
                        <div className="mt-2 flex gap-2">
                          <RevoDeleteButton
                            accountId={accountId}
                            pollId={BigInt(pollId)}
                            title={k.title}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
      </div>
    </div>
  );
};

const RevoDeleteButton: React.FC<
  { accountId: string; pollId: bigint; title: string }
> = ({ accountId, pollId, title }) => {
  const { t } = useTranslation();
  const RK = useRevoKeysCtx();
  const onClick = async () => {
    const ok = confirm(t("keyring.revo_delete_confirm", { pollId, title }));
    if (!ok) return;
    await RK.removeForPoll(accountId, BigInt(pollId));
  };
  return (
    <button
      className="rounded-lg px-3 py-1 border text-xs text-red-600"
      onClick={onClick}
      title={t("keyring.delete_this_revo")}
    >
      {t("keyring.delete")}
    </button>
  );
};
