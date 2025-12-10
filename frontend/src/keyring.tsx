import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { genBabyJubKeypair, prv2sk, randomScalar } from "../../helpers/key.ts";
import {
  arraysEqual,
  hexToBytes32,
  jsonReplacer,
  toBytesBE32Buf,
} from "../../helpers/utils.ts";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { decryptFromBlob, type EncryptedBlob, encryptToBlob } from "./blob.ts";
import { getBabyjub, getEddsa, getPoseidon } from "./circomMemo.ts";

const KEYRING_DB_KEY = "mootvote:keyring:v1";
const ACTIVE_IDX_KEY = "mootvote:keyring:active:v1";
const REVO_DB_KEY = "mootvote:revo:v1";

export type BabyJubKeypair = {
  name: string;
  prv: Uint8Array;
  sk: bigint;
  pub: [bigint, bigint];
  createdAt: number;
};

type KeyringApi = ReturnType<typeof useKeyring>;

const KeyringCtx = createContext<KeyringApi | null>(null);

export const useKeyringCtx = () => {
  const ctx = useContext(KeyringCtx);
  if (!ctx) {
    throw new Error("useKeyringCtx must be used within <KeyringProvider>");
  }
  return ctx;
};

export const KeyringProvider: React.FC<React.PropsWithChildren> = (
  { children },
) => {
  const kr = useKeyring();
  return <KeyringCtx.Provider value={kr}>{children}</KeyringCtx.Provider>;
};

export const idForAccount = (a: BabyJubKeypair) => `${a.pub[0]}:${a.pub[1]}`;

export async function keyToLeafHex([x, y]: [bigint, bigint]): Promise<string> {
  const P = await getPoseidon();
  const F = P.F;
  const leaf = F.toObject(P([x, y]));
  return Array.from(toBytesBE32Buf(leaf)).map((b) =>
    b.toString(16).padStart(2, "0")
  )
    .join("");
}

function useKeyring() {
  const [locked, setLocked] = useState(true);
  const [pass, setPass] = useState("");
  const [accounts, setAccounts] = useState<BabyJubKeypair[]>([]);
  const [active, setActive_] = useState<number>(0);
  const [hasKeyring, setHasKeyring] = useState<boolean | null>(null);
  const [importStatus, setImportStatus] = useState<
    null | { ok: boolean; msg: string }
  >(null);

  const clearImportStatus = useCallback(() => setImportStatus(null), []);

  const setActive = useCallback((idx: number) => {
    setActive_(idx);
    try {
      localStorage.setItem(ACTIVE_IDX_KEY, String(idx));
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const blob = (await idbGet(KEYRING_DB_KEY)) as
        | EncryptedBlob
        | undefined;
      setHasKeyring(!!blob);
    })();
  }, []);

  const unlock = useCallback(async () => {
    const blob = (await idbGet(KEYRING_DB_KEY)) as
      | EncryptedBlob
      | undefined;
    if (!blob) {
      const firstBlob = await encryptToBlob(pass, [] as BabyJubKeypair[]);
      await idbSet(KEYRING_DB_KEY, firstBlob);
      setAccounts([]);
      setLocked(false);
      setHasKeyring(true);
      setActive(0);
      return true;
    }
    try {
      const accs = await decryptFromBlob<BabyJubKeypair[]>(pass, blob);
      setAccounts(accs);
      setLocked(false);
      try {
        const saved = Number(localStorage.getItem(ACTIVE_IDX_KEY) ?? "0") || 0;
        setActive(Math.min(Math.max(0, saved), Math.max(0, accs.length - 1)));
      } catch {
        setActive(0);
      }
      return true;
    } catch (e: any) {
      alert("Wrong passphrase or corrupted keyring");
      console.error(e);
      return false;
    }
  }, [pass]);

  const persist = useCallback(async (next: BabyJubKeypair[]) => {
    const blob = await encryptToBlob(pass, next);
    await idbSet(KEYRING_DB_KEY, blob);
    setAccounts(next);
  }, [pass]);

  const addNew = useCallback(async (name: string) => {
    const k = await genBabyJubKeypair_(name);
    await persist([...accounts, k]);
  }, [accounts, persist]);

  const importPrv = useCallback(async (name: string, prvHex: string) => {
    setImportStatus(null);

    let hex = prvHex.trim().toLowerCase();
    if (name.length == 0) {
      setImportStatus({ ok: false, msg: "Name should not be empty." });
      return;
    }
    if (hex.startsWith("0x")) hex = hex.slice(2);
    if (!/^[0-9a-f]+$/.test(hex)) {
      setImportStatus({ ok: false, msg: "Invalid hex." });
      return;
    }
    if (hex.length > 64 || hex.length < 1) {
      setImportStatus({
        ok: false,
        msg: "Private key must fit in 32 bytes (64 hex chars).",
      });
      return;
    }
    if (accounts.some((a) => a.name === name)) {
      setImportStatus({
        ok: false,
        msg: `An account named “${name}” already exists.`,
      });
      return;
    }

    const eddsa = await getEddsa();
    const babyjub = await getBabyjub();
    const F = babyjub.F;
    const prv = hexToBytes32(hex);

    if (accounts.some((a) => arraysEqual(a.prv, prv))) {
      setImportStatus({
        ok: false,
        msg: `An account with this private key already exists.`,
      });
      return;
    }

    const sk = prv2sk(prv, eddsa);
    const pub = babyjub.mulPointEscalar(babyjub.Base8, sk);
    const k: BabyJubKeypair = {
      name,
      prv,
      sk,
      pub: [F.toObject(pub[0]), F.toObject(pub[1])],
      createdAt: Date.now(),
    };
    await persist([...accounts, k]);
    setImportStatus({ ok: true, msg: `Imported “${name}” successfully.` });
  }, [accounts, persist]);

  const removeAt = useCallback(async (idx: number) => {
    const a = accounts[idx];
    const ok = confirm(
      `Delete key "${a.name}"?\n\n` +
        `This will also orphan any re-voting keys associated with it.\n` +
        `You may lose the ability to vote in polls tied to this key.\n\n` +
        `This action cannot be undone.`,
    );
    if (!ok) return;
    const next = accounts.slice();
    next.splice(idx, 1);
    await persist(next);
    if (active >= next.length) setActive(Math.max(0, next.length - 1));
  }, [accounts, active, persist, setActive]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(accounts, jsonReplacer, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "babyjub-keyring.json";
    a.click();
  }, [accounts]);

  return {
    locked,
    pass,
    setPass,
    unlock,
    hasKeyring,
    accounts,
    addNew,
    importPrv,
    importStatus,
    clearImportStatus,
    removeAt,
    active,
    setActive,
    exportJson,
  };
}

type RevoKey = {
  sk: bigint;
  updatedAt: number;
  title: string;
};

type RevoKeysMapType = Record<
  string, /*accountId*/
  Record<string, /*pollId*/ RevoKey>
>;

type RevoKeysCtx = {
  loaded: boolean;
  map: RevoKeysMapType;
  reload: () => Promise<void>;
  getForPoll: (accountId: string, pollId: bigint) => RevoKey | null;
  generateForPoll: () => Promise<RevoKey>;
  setForPoll: (accountId: string, pollId: bigint, rk: RevoKey) => Promise<void>;
  removeForPoll: (accountId: string, pollId: bigint) => Promise<void>;
  exportJson: () => void;
  exportRevo: (accountId: string, filename?: string) => void;
};

const RevoKeysContext = createContext<RevoKeysCtx | null>(null);

export const RevoKeysProvider: React.FC<React.PropsWithChildren> = (
  { children },
) => {
  const KR = useKeyringCtx();
  const [map, setMap] = useState<RevoKeysMapType>({});
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (KR.locked) return;
    const blob = await idbGet<EncryptedBlob>(REVO_DB_KEY);
    if (!blob) {
      setMap({});
      setLoaded(true);
      return;
    }
    try {
      const obj = await decryptFromBlob<RevoKeysMapType>(KR.pass, blob);
      setMap(obj || {});
    } catch {
      setMap({});
    } finally {
      setLoaded(true);
    }
  }, [KR.locked, KR.pass]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(async (next: RevoKeysMapType) => {
    if (KR.locked) return;
    const blob = await encryptToBlob(KR.pass, next);
    await idbSet(REVO_DB_KEY, blob);
    setMap(next); // notify all consumers immediately
  }, [KR.locked, KR.pass]);

  const getForPoll = useCallback((accountId: string, pollId: bigint) => {
    const m = map[accountId] || {};
    return m[String(pollId)] ?? null;
  }, [map]);

  const generateForPoll = useCallback(async () => {
    const babyjub = await getBabyjub();
    const sk = randomScalar(babyjub.subOrder);
    return { sk, updatedAt: Date.now() } as RevoKey;
  }, []);

  const setForPoll = useCallback(
    async (accountId: string, pollId: bigint, rk: RevoKey) => {
      const m = { ...(map[accountId] || {}) };
      m[String(pollId)] = rk;
      const next = { ...map, [accountId]: m };
      await persist(next);
    },
    [map, persist],
  );

  const removeForPoll = useCallback(
    async (accountId: string, pollId: bigint) => {
      const m = { ...(map[accountId] || {}) };
      delete m[String(pollId)];
      const next = { ...map, [accountId]: m };
      await persist(next);
    },
    [map, persist],
  );

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(map, jsonReplacer, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "revo-keys.json";
    a.click();
  }, [map]);

  const exportRevo = useCallback((accountId: string, filename?: string) => {
    const payload = map[accountId] || {};
    const blob = new Blob([JSON.stringify(payload, jsonReplacer, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename ?? `revo-keys-${accountId.slice(0, 8)}.json`;
    a.click();
  }, [map]);

  return (
    <RevoKeysContext.Provider
      value={{
        loaded,
        map,
        reload,
        getForPoll,
        generateForPoll,
        setForPoll,
        removeForPoll,
        exportJson,
        exportRevo,
      }}
    >
      {children}
    </RevoKeysContext.Provider>
  );
};

export function useRevoKeysCtx() {
  const c = useContext(RevoKeysContext);
  if (!c) throw new Error("RevoKeysProvider missing");
  return c;
}

async function genBabyJubKeypair_(name: string): Promise<BabyJubKeypair> {
  const eddsa = await getEddsa();
  const babyjub = await getBabyjub();
  const F = babyjub.F;
  const { prv, sk, pub } = genBabyJubKeypair(babyjub, eddsa);
  return {
    name,
    prv,
    sk,
    pub: [F.toObject(pub[0]), F.toObject(pub[1])],
    createdAt: Date.now(),
  };
}
