import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Connection, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { randomScalar } from "../../../helpers/key.ts";
import {
  bytes32ToBig,
  hexToBytes32,
  toBytesBE32,
  toHex32,
} from "../../../helpers/utils.ts";
import { makeAuthSig } from "../auth.ts";
import { ChooseCensusModal } from "../components/ChooseCensusModal.tsx";
import {
  createPoll,
  cuLimitInstruction,
  type InstructionWithCu,
  setProvider as setMootProvider,
} from "@lincot/mootvote-sdk";
import { getMerkleRoot } from "../../../helpers/merkletree.ts";
import { useKeyringCtx } from "../keyring.tsx";
import { CENSUS_URL, CLUSTER, RPC_URL } from "../env.tsx";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { btn } from "../btn.ts";
import { Help } from "../components/Help.tsx";
import { CENSUS_DEPTH, MAX_CHOICES } from "../consts.ts";
import { turboBatchUpload } from "../arweave.ts";
import { INPUT_CN } from "../input.ts";
import { useTranslation } from "react-i18next";
import ConnectSolana from "../components/ConnectSolana.tsx";
import StepperCard from "../components/StepperCard.tsx";
import { formatLamportsAsSol } from "../utils.ts";

const MAX_POLL_DURATION = 365 * 24 * 60 * 60;

const HEX = /^0x?[0-9a-fA-F]*$/;

const schemaBase = z.object({
  title: z.string().min(1, "required").max(200, "title_too_long"),
  choices: z.array(
    z.object({ value: z.string().min(1, "required") }),
  ).min(1).max(MAX_CHOICES),
  tallierMode: z.enum(["active", "manual"]),
  tallierX: z.string().optional(),
  tallierY: z.string().optional(),
  start: z.string().min(1, "required"),
  end: z.string().min(1, "required"),
  feeLamports: z.string().regex(/^\d+$/, "positive_integer"),
  censusSource: z.enum(["upload", "existing"]),
  censusBytes: z.instanceof(Uint8Array),
  censusCount: z.number().int().positive("census_empty")
    .optional(),
  censusRootHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  selectedCensusId: z.number().int().positive().optional(),
  selectedCensusTitle: z.string().optional(),
}).superRefine((d, ctx) => {
  const startMs = Date.parse(d.start);
  const endMs = Date.parse(d.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    ctx.addIssue({ code: "custom", message: "invalid_date", path: ["end"] });
    return;
  }
  if (endMs <= startMs) {
    ctx.addIssue({
      code: "custom",
      message: "end_after_start",
      path: ["end"],
    });
    return;
  }
  if (endMs - startMs > MAX_POLL_DURATION * 1000) {
    ctx.addIssue({
      code: "custom",
      message: "poll_duration",
      path: ["end"],
    });
  }
});

const schema = z.discriminatedUnion("tallierMode", [
  schemaBase.safeExtend({
    tallierMode: z.literal("active"),
  }),
  schemaBase.safeExtend({
    tallierMode: z.literal("manual"),
    tallierX: z.string().regex(HEX, "hex32"),
    tallierY: z.string().regex(HEX, "hex32"),
  }),
]);

type FormValues = z.infer<typeof schema>;

type ParsedCensus = {
  leaves: bigint[];
  labels?: Array<
    {
      i: number;
      pkX?: string;
      pkY?: string;
      label?: string;
      labelHash?: string;
    }
  >;
};

async function parseUploadedCensus(buf: Uint8Array): Promise<ParsedCensus> {
  if (buf.length % 32 !== 0) {
    throw new Error("census.bin must be multiple of 32 bytes");
  }
  const leaves: bigint[] = [];
  for (let i = 0; i < buf.length; i += 32) leaves.push(bytes32ToBig(buf, i));
  return { leaves };
}

function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${
    p(d.getHours())
  }:${p(d.getMinutes())}`;
}

function localInputToUnixSeconds(s: string): number {
  const [date, time] = s.split("T");
  const [y, m, dd] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Math.floor(
    new Date(y, (m || 1) - 1, dd || 1, hh || 0, mm || 0, 0, 0).getTime() / 1000,
  );
}

export const PollCreatePage: React.FC<{}> = () => {
  const { t } = useTranslation();
  useLayoutEffect(() => {
    document.title = t("page_titles.new_poll");
  });

  const wallet = useWallet();
  const KR = useKeyringCtx();
  const connection = new Connection(RPC_URL, { commitment: "confirmed" });

  useEffect(() => {
    if (!wallet.publicKey || !connection) return;
    const provider = new anchor.AnchorProvider(
      connection,
      wallet as any,
      anchor.AnchorProvider.defaultOptions(),
    );
    setMootProvider(provider);
  }, [wallet.publicKey, connection]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FormValues>({
    mode: "onChange",
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      choices: [{ value: "" }, { value: "" }],
      tallierMode: "active",
      tallierX: undefined,
      tallierY: undefined,
      start: toLocalInputValue(new Date(Date.now() + 60_000)),
      end: toLocalInputValue(new Date(Date.now() + 3_660_000)),
      feeLamports: "0",
      censusBytes: undefined,
      censusCount: 0,
      censusRootHex: "0x" + "0".repeat(64),
      censusSource: "existing",
    },
  });
  const tallierMode = watch("tallierMode");
  const censusSource = watch("censusSource");
  const censusCount = watch("censusCount");
  const selectedCensusId = watch("selectedCensusId");
  const selectedCensusTitle = watch("selectedCensusTitle");
  const feeLamportsStr = watch("feeLamports");

  const feeSolPreview = useMemo(() => {
    if (!feeLamportsStr) return null;
    return formatLamportsAsSol(BigInt(feeLamportsStr));
  }, [feeLamportsStr]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: "choices",
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const steps = useMemo(
    () =>
      [
        { key: "upload", label: t("poll_creation.stage.arweave") },
        { key: "tx", label: t("loading.sending_tx") },
        { key: "done", label: t("poll_creation.stage.created") },
      ] as const,
    [t],
  );
  type Stage = (typeof steps)[number]["key"] | null;
  const [stage, setStage] = useState<Stage>(null);

  const onSubmit = async (data: FormValues) => {
    try {
      setErrMsg(null);
      setStage("upload");

      if (!wallet.publicKey || !wallet.signMessage || !wallet.signTransaction) {
        throw new Error("Connect your Solana wallet first");
      }

      const cleanedChoices = data.choices.map((c) => c.value.trim()).filter((
        c,
      ) => c.length > 0);
      const descJson = JSON.stringify({
        title: data.title.trim(),
        choices: cleanedChoices,
      });
      const descBytes = new TextEncoder().encode(descJson);

      const [descUrl, censusUrl] = await turboBatchUpload(
        {
          publicKey: wallet.publicKey,
          signMessage: wallet.signMessage,
          signTransaction: wallet.signTransaction,
        },
        [
          { data: Buffer.from(descBytes), contentType: "application/json" },
          {
            data: Buffer.from(data.censusBytes),
            contentType: "application/octet-stream",
          },
        ],
        { devnet: CLUSTER === "devnet", rpc: RPC_URL },
      );
      console.log("Description URL:", descUrl);
      console.log("Census URL:", censusUrl);

      setStage("tx");

      const start = localInputToUnixSeconds(data.start);
      const end = localInputToUnixSeconds(data.end);
      const fee = BigInt(data.feeLamports);

      let tallierKey: { x: number[]; y: number[] };
      if (data.tallierMode === "active") {
        const acc = KR.accounts[KR.active];
        if (!acc) throw new Error("No active ZK account selected");
        const [px, py] = acc.pub;
        tallierKey = {
          x: toBytesBE32(px),
          y: toBytesBE32(py),
        };
      } else {
        tallierKey = {
          x: Array.from(hexToBytes32(data.tallierX!)),
          y: Array.from(hexToBytes32(data.tallierY!)),
        };
      }

      const ix: InstructionWithCu = await createPoll({
        payer: wallet.publicKey!,
        id: randomScalar(1n << 32n),
        censusRoot: Array.from(hexToBytes32(data.censusRootHex)),
        tallierKey,
        nChoices: cleanedChoices.length,
        votingStartTime: new anchor.BN(start),
        votingEndTime: new anchor.BN(end),
        fee,
        feeDestination: wallet.publicKey!,
        nVoters: BigInt(data.censusCount!),
        descriptionUrl: descUrl,
        censusUrl: censusUrl,
      });

      const tx = new Transaction().add(
        cuLimitInstruction([ix]),
        ...[ix].map((x) => x.instruction),
      );
      tx.recentBlockhash = (await connection!.getLatestBlockhash()).blockhash;
      tx.feePayer = wallet.publicKey!;

      await wallet.sendTransaction(tx, connection!, { maxRetries: 3 });

      setStage("done");
    } catch (e: any) {
      console.error(e);
      setErrMsg("Error: " + String(e?.message || e));
    }
  };

  const onCensusFile = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const { leaves } = await parseUploadedCensus(bytes);
    const root = await getMerkleRoot(CENSUS_DEPTH, leaves);
    setValue("censusBytes", bytes, { shouldValidate: true });
    setValue("censusCount", leaves.length, { shouldValidate: true });
    setValue("censusRootHex", "0x" + toHex32(root), { shouldValidate: true });

    /// XXX: Otherwise it won't show date errors until census is uploaded
    // and date is changed again...
    await trigger(["start", "end"]);
  };

  const [openChoose, setOpenChoose] = useState(false);
  const handlePickExisting = async (picked: { id: number; title: string }) => {
    const acct = KR.accounts[KR.active];
    if (!acct) throw new Error("Unlock ZK Accounts");
    const sig = await makeAuthSig(acct.prv, acct.pub);
    const r = await fetch(`${CENSUS_URL}/census/${picked.id}/export`, {
      method: "GET",
      headers: { ...sig },
    });
    if (!r.ok) throw new Error(await r.text());
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length === 0) {
      throw new Error(t("poll_creation.error.census_is_empty"));
    }
    const { leaves } = await parseUploadedCensus(buf);
    const root = await getMerkleRoot(CENSUS_DEPTH, leaves);
    setValue("selectedCensusId", picked.id, { shouldValidate: true });
    setValue("selectedCensusTitle", picked.title, { shouldValidate: true });
    setValue("censusBytes", buf, { shouldValidate: true });
    setValue("censusCount", leaves.length, { shouldValidate: true });
    setValue("censusRootHex", "0x" + toHex32(root), { shouldValidate: true });
    setOpenChoose(false);
  };

  const disabled = isSubmitting || !isValid || !wallet.publicKey ||
    (tallierMode === "active" && !KR.accounts[KR.active]);
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-xl mx-auto p-4"
    >
      <h2 className="text-xl font-semibold mb-3">
        {t("poll_creation.create_poll")}
      </h2>

      <div className="flex-col gap-4">
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            {t("poll_creation.title")}
          </label>
          <input className={INPUT_CN} {...register("title")} />
          {errors.title?.message && (
            <p className="text-red-500 text-xs">
              {t("poll_creation.form_error." + errors.title.message)}
            </p>
          )}

          <label className="block text-sm font-medium">
            {t("poll_creation.start")}
          </label>
          <input
            type="datetime-local"
            className={INPUT_CN}
            {...register("start")}
          />
          {errors.start?.message && (
            <p className="text-red-500 text-xs">
              {t("poll_creation.form_error." + errors.start.message)}
            </p>
          )}

          <label className="block text-sm font-medium">
            {t("poll_creation.end")}
          </label>
          <input
            type="datetime-local"
            className={INPUT_CN}
            {...register("end")}
          />
          {errors.end?.message && (
            <p className="text-red-500 text-xs">
              {t("poll_creation.form_error." + errors.end.message)}
            </p>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              {t("poll_creation.tallier_key")}
            </label>
            <div className="flex gap-3 items-center">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value="active"
                  {...register("tallierMode")}
                  defaultChecked
                />
                {t("poll_creation.use_keyring")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value="manual"
                  {...register("tallierMode")}
                />
                {t("poll_creation.enter_manually")}
              </label>
            </div>
            {}
            {tallierMode !== "manual" ? <ActiveTallierSummary /> : (
              <div>
                <input
                  placeholder="0x… (X)"
                  className={INPUT_CN}
                  {...register("tallierX")}
                />
                {errors.tallierX?.message && (
                  <p className="text-red-600 text-xs">
                    {t("poll_creation.form_error." + errors.tallierX.message)}
                  </p>
                )}
                <input
                  placeholder="0x… (Y)"
                  className={INPUT_CN}
                  {...register("tallierY")}
                />
                {errors.tallierY?.message && (
                  <p className="text-red-600 text-xs">
                    {t("poll_creation.form_error." + errors.tallierY.message)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">
              {t("poll_creation.poll_fee")}
            </label>
            <input
              placeholder="e.g. 200000"
              className={INPUT_CN}
              {...register("feeLamports")}
            />
            {feeSolPreview && (
              <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                = {feeSolPreview} SOL
              </div>
            )}
            {errors.feeLamports?.message && (
              <p className="text-red-500 text-xs">
                {t("poll_creation.form_error." + errors.feeLamports.message)}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              {t("poll_creation.choices")}
            </label>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => append({ value: "" })}
              disabled={fields.length >= MAX_CHOICES}
            >
              + {t("actions.add")}
            </button>
          </div>

          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <input
                  className={INPUT_CN + " flex-1"}
                  {...register(`choices.${i}.value` as const)}
                  placeholder={t("poll_creation.choice", { num: i + 1 })}
                />
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => remove(i)}
                  disabled={fields.length <= 1}
                >
                  {t("actions.remove")}
                </button>
              </div>
            ))}
            {errors.choices?.message && (
              <p className="text-red-500 text-xs">
                {t("poll_creation.form_error." + errors.choices.message)}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <label className="block text-sm font-medium">
              {t("poll_creation.census_source")}
            </label>
            <div className="flex items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  value="existing"
                  {...register("censusSource")}
                  onChange={() =>
                    setValue("censusSource", "existing", {
                      shouldValidate: true,
                    })}
                />
                {t("poll_creation.use_existing_census")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  value="upload"
                  {...register("censusSource")}
                  onChange={() =>
                    setValue("censusSource", "upload", {
                      shouldValidate: true,
                    })}
                />
                {t("poll_creation.upload_file")}
              </label>
            </div>
            {errors.censusSource?.message && (
              <p className="text-red-600 text-xs">
                {t("poll_creation.form_error." + errors.censusSource.message)}
              </p>
            )}
          </fieldset>

          {censusSource === "upload" && (
            <div className="mt-3">
              <div className="flex gap-2">
                <label className="mb-2 block text-sm font-medium">
                  {t("poll_creation.census_bin")}
                </label>

                <Help
                  title={t("poll_creation.census_format.what_is_census_bin")}
                  below={false}
                  content={
                    <div>
                      <p className="mb-1 font-medium">
                        {t("poll_creation.census_format.census_file_format")}
                      </p>
                      <ul className="list-disc ml-4 space-y-1">
                        <li>{t("poll_creation.census_format.binary_file")}</li>
                        <li>
                          {t(
                            "poll_creation.census_format.concatenation_of_leaves",
                          )} <b>{t("poll_creation.census_format.bytes32")}</b>
                          {" "}
                          ({t("poll_creation.census_format.be")}).
                        </li>
                        <li>
                          {t("poll_creation.census_format.each_leaf_is")}{" "}
                          <code>Poseidon(pubX, pubY)</code>{" "}
                          {t("poll_creation.census_format.over_baby")}
                        </li>
                      </ul>
                    </div>
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="rounded p-1 border-gray-300 dark:bg-neutral-800"
                  type="file"
                  accept=".bin"
                  onChange={(e) =>
                    e.target.files && onCensusFile(e.target.files[0])}
                />
              </div>
              {errors.censusCount?.message && (
                <p className="text-red-600 text-xs">
                  {t("poll_creation.form_error." + errors.censusCount.message)}
                </p>
              )}
              {errors.censusRootHex?.message && (
                <p className="text-red-600 text-xs">
                  {t(
                    "poll_creation.form_error." + errors.censusRootHex.message,
                  )}
                </p>
              )}
            </div>
          )}

          {censusSource === "existing" && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenChoose(true)}
                  className="shrink-0 rounded-lg px-3 py-2 border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("poll_creation.choose_census")}
                </button>
                {selectedCensusId && (
                  <div className="text-sm">
                    {t("poll_creation.chosen")}{" "}
                    <span className="font-medium">
                      {selectedCensusTitle}
                    </span>
                  </div>
                )}
              </div>
              {errors.censusRootHex?.message && (
                <p className="text-red-600 text-xs">
                  {t(
                    "poll_creation.form_error." + errors.censusRootHex.message,
                  )}
                </p>
              )}
            </div>
          )}

          {censusCount ? <CensusHints censusCount={censusCount} /> : null}
        </div>
      </div>

      <ConnectSolana />
      <StepperCard
        steps={steps}
        currentKey={stage}
        finalKey="done"
        errorText={errMsg}
        action={
          <button className={btn(!disabled)} disabled={disabled}>
            {isSubmitting
              ? t("loading.working")
              : t("poll_creation.create_poll")}
          </button>
        }
      />

      {openChoose && (
        <ChooseCensusModal
          onClose={() => setOpenChoose(false)}
          onPick={handlePickExisting}
          open={openChoose}
        />
      )}
    </form>
  );
};

const ActiveTallierSummary: React.FC = () => {
  const { t } = useTranslation();
  const KR = useKeyringCtx();
  const acc = KR.accounts[KR.active];
  if (!acc) {
    return (
      <div className="text-xs text-amber-700 dark:text-amber-500">
        {t("poll_creation.no_zk_account")}
      </div>
    );
  }
  const pkx = "0x" + acc.pub[0].toString(16).padStart(64, "0");
  const pky = "0x" + acc.pub[1].toString(16).padStart(64, "0");
  return (
    <div className="rounded-lg border p-2 bg-gray-50 dark:bg-zinc-800/50 text-xs">
      {t("poll_creation.using_account") + " "}
      <span className="font-medium">{acc.name}</span>
      <div className="font-mono break-all mt-1">X: {pkx}</div>
      <div className="font-mono break-all">Y: {pky}</div>
    </div>
  );
};

const CensusHints = ({ censusCount }: { censusCount: number }) => {
  const { t } = useTranslation();
  return (
    <div className="text-xs mt-1 text-neutral-600 dark:text-neutral-300">
      <div>{t("poll_creation.voter_count")} {censusCount}</div>
    </div>
  );
};
