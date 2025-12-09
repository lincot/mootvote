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
import { ChooseCensusDialog } from "../components/ChooseCensusDialog.tsx";
import {
  createPoll,
  cuLimitInstruction,
  type InstructionWithCu,
  setProvider as setAnonProvider,
} from "@lincot/anon-vote-sdk";
import { getMerkleRoot } from "../../../helpers/merkletree.ts";
import { useKeyringCtx } from "../keyring.tsx";
import { CENSUS_URL, CLUSTER, RPC_URL } from "../env.tsx";
import { useEffect, useState } from "react";
import { btn } from "../btn.ts";
import { Help } from "../components/Help.tsx";
import { CENSUS_DEPTH, MAX_CHOICES } from "../consts.ts";
import { irysBatchUpload } from "../irys.ts";
import { INPUT_CN } from "../input.ts";

const MAX_POLL_DURATION = 365 * 24 * 60 * 60;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const HEX = /^0x?[0-9a-fA-F]*$/;

const schemaBase = z.object({
  title: z.string().min(1, "Title is required").max(200, "Keep it short"),
  choices: z.array(z.object({ value: z.string().min(1, "Required") }))
    .min(1, "At least one choice").max(
      MAX_CHOICES,
      `Max ${MAX_CHOICES} choices`,
    ),
  coordMode: z.enum(["active", "manual"]),
  coordX: z.string().optional(),
  coordY: z.string().optional(),
  start: z.string().min(1, "Start required"),
  end: z.string().min(1, "End required"),
  feeLamports: z.string().regex(/^\d+$/, "Integer lamports"),
  censusSource: z.enum(["upload", "existing"]),
  censusBytes: z.instanceof(Uint8Array),
  censusCount: z.number().int().positive("Census empty").optional(),
  censusRootHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  selectedCensusId: z.number().int().positive().optional(),
  selectedCensusTitle: z.string().optional(),
}).superRefine((d, ctx) => {
  const startMs = Date.parse(d.start);
  const endMs = Date.parse(d.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    ctx.addIssue({ code: "custom", message: "Invalid date", path: ["end"] });
    return;
  }
  if (endMs <= startMs) {
    ctx.addIssue({
      code: "custom",
      message: "End must be after start",
      path: ["end"],
    });
    return;
  }
  if (CLUSTER == "devnet") {
    // This ensures availability of census on Irys devnet.
    const limit = Date.now() + 60 * ONE_DAY_MS;
    if (endMs > limit) {
      ctx.addIssue({
        code: "custom",
        message: "On devnet, polls must end within 60 days from now.",
        path: ["end"],
      });
    }
  } else {
    if (endMs - startMs > MAX_POLL_DURATION * 1000) {
      ctx.addIssue({
        code: "custom",
        message: "Poll duration must be ≤ 365 days.",
        path: ["end"],
      });
    }
  }
});

const schema = z.discriminatedUnion("coordMode", [
  schemaBase.safeExtend({
    coordMode: z.literal("active"),
  }),
  schemaBase.safeExtend({
    coordMode: z.literal("manual"),
    coordX: z.string().regex(HEX, "32-byte hex"),
    coordY: z.string().regex(HEX, "32-byte hex"),
  }),
]);

type FormValues = z.infer<typeof schema>;
type Stage =
  | "idle"
  | "uploading data to Irys"
  | "creating poll"
  | "done"
  | "error";

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
    setAnonProvider(provider);
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
      coordMode: "active",
      coordX: undefined,
      coordY: undefined,
      start: toLocalInputValue(new Date(Date.now() + 60_000)),
      end: toLocalInputValue(new Date(Date.now() + 3_660_000)),
      feeLamports: "0",
      censusBytes: undefined,
      censusCount: 0,
      censusRootHex: "0x" + "0".repeat(64),
      censusSource: "existing",
    },
  });
  const coordMode = watch("coordMode");

  const { fields, append, remove } = useFieldArray({
    control,
    name: "choices",
  });
  const [stage, setStage] = useState<Stage>("idle");
  const [errMsg, setErrMsg] = useState("");

  const onSubmit = async (data: FormValues) => {
    try {
      setErrMsg("");
      setStage("uploading data to Irys");

      const cleanedChoices = data.choices.map((c) => c.value.trim()).filter((
        c,
      ) => c.length > 0);
      const descJson = JSON.stringify({
        title: data.title.trim(),
        choices: cleanedChoices,
      });
      const descBytes = new TextEncoder().encode(descJson);

      const [descUrl, censusUrl] = await irysBatchUpload(
        wallet,
        [
          { data: Buffer.from(descBytes), contentType: "application/json" },
          {
            data: Buffer.from(data.censusBytes),
            contentType: "application/octet-stream",
            tags: [{ name: "App-Name", value: "anon-vote-census" }, {
              name: "Leaves",
              value: String(data.censusCount),
            }],
          },
        ],
        { devnet: CLUSTER === "devnet", rpc: RPC_URL },
      );

      setStage("creating poll");

      const start = localInputToUnixSeconds(data.start);
      const end = localInputToUnixSeconds(data.end);
      const fee = BigInt(data.feeLamports);

      let coordinatorKey: { x: number[]; y: number[] };
      if (data.coordMode === "active") {
        const acc = KR.accounts[KR.active];
        if (!acc) throw new Error("No active ZK account selected");
        const [px, py] = acc.pub;
        coordinatorKey = {
          x: toBytesBE32(px),
          y: toBytesBE32(py),
        };
      } else {
        coordinatorKey = {
          x: Array.from(hexToBytes32(data.coordX!)),
          y: Array.from(hexToBytes32(data.coordY!)),
        };
      }

      const ix: InstructionWithCu = await createPoll({
        payer: wallet.publicKey!,
        id: randomScalar(1n << 32n),
        censusRoot: Array.from(hexToBytes32(data.censusRootHex)),
        coordinatorKey,
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
      setStage("error");
    }
  };

  const onCensusFile = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const { leaves } = await parseUploadedCensus(bytes);
    const root = await getMerkleRoot(CENSUS_DEPTH, leaves);
    setValue("censusBytes", bytes, { shouldValidate: true });
    setValue("censusCount", leaves.length, { shouldValidate: true });
    setValue("censusRootHex", toHex32(root), { shouldValidate: true });

    /// XXX: Otherwise it won't show date errors until census is uploaded
    // and date is changed again...
    await trigger(["start", "end"]);
  };

  const [openChoose, setOpenChoose] = useState(false);
  const handlePickExisting = async (picked: { id: number; title: string }) => {
    try {
      const acct = KR.accounts[KR.active];
      if (!acct) throw new Error("Unlock ZK Accounts");
      const sig = await makeAuthSig(acct.prv, acct.pub);
      const r = await fetch(`${CENSUS_URL}/census/${picked.id}/export`, {
        method: "GET",
        headers: { ...sig },
      });
      if (!r.ok) throw new Error(await r.text());
      const buf = new Uint8Array(await r.arrayBuffer());
      const { leaves } = await parseUploadedCensus(buf);
      const root = await getMerkleRoot(CENSUS_DEPTH, leaves);
      setValue("selectedCensusId", picked.id, { shouldValidate: true });
      setValue("selectedCensusTitle", picked.title, { shouldValidate: true });
      setValue("censusBytes", buf, { shouldValidate: true });
      setValue("censusCount", leaves.length, { shouldValidate: true });
      setValue("censusRootHex", toHex32(root), { shouldValidate: true });
      setOpenChoose(false);
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message || String(e));
    }
  };

  const disabled = isSubmitting || !isValid || !wallet.publicKey ||
    (stage !== "idle" && stage !== "done" && stage !== "error") ||
    (coordMode === "active" && !KR.accounts[KR.active]);
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-xl mx-auto p-4"
    >
      <h2 className="text-xl font-semibold mb-3">Create Poll</h2>

      <div className="flex-col gap-4">
        <div className="space-y-3">
          <label className="block text-sm font-medium">Poll title</label>
          <input className={INPUT_CN} {...register("title")} />
          {errors.title && (
            <p className="text-red-500 text-xs">{errors.title.message}</p>
          )}

          <label className="block text-sm font-medium">Start</label>
          <input
            type="datetime-local"
            className={INPUT_CN}
            {...register("start")}
          />
          {errors.start && (
            <p className="text-red-500 text-xs">{errors.start.message}</p>
          )}

          <label className="block text-sm font-medium">End</label>
          <input
            type="datetime-local"
            className={INPUT_CN}
            {...register("end")}
          />
          {errors.end && (
            <p className="text-red-500 text-xs">{errors.end.message}</p>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium">Tallier key</label>
            <div className="flex gap-3 items-center">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  value="active"
                  {...register("coordMode")}
                  defaultChecked
                />
                Use keyring
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="manual" {...register("coordMode")} />
                Enter manually
              </label>
            </div>
            {}
            {coordMode !== "manual" ? <ActiveCoordinatorSummary /> : (
              <div>
                <input
                  placeholder="0x… (X)"
                  className={INPUT_CN}
                  {...register("coordX")}
                />
                {errors.coordX && (
                  <p className="text-red-600 text-xs">
                    {errors.coordX.message}
                  </p>
                )}
                <input
                  placeholder="0x… (Y)"
                  className={INPUT_CN}
                  {...register("coordY")}
                />
                {errors.coordY && (
                  <p className="text-red-600 text-xs">
                    {errors.coordY.message}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium">
              Poll fee (lamports)
            </label>
            <input
              placeholder="e.g. 200000"
              className={INPUT_CN}
              {...register("feeLamports")}
            />
            {errors.feeLamports && (
              <p className="text-red-500 text-xs">
                {errors.feeLamports.message}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              Choices (1–{MAX_CHOICES})
            </label>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => append({ value: "" })}
              disabled={fields.length >= MAX_CHOICES}
            >
              + Add
            </button>
          </div>

          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <input
                  className={INPUT_CN + " flex-1"}
                  {...register(`choices.${i}.value` as const)}
                  placeholder={`Choice #${i + 1}`}
                />
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => remove(i)}
                  disabled={fields.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            {errors.choices && (
              <p className="text-red-500 text-xs">
                {errors.choices.message as string}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <label className="block text-sm font-medium">Census source</label>
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
                Use existing census
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
                Upload file
              </label>
            </div>
            {errors.censusSource && (
              <p className="text-red-600 text-xs">
                {errors.censusSource.message as string}
              </p>
            )}
          </fieldset>

          {(control._formValues as FormValues).censusSource === "upload" && (
            <div className="mt-3">
              <div className="flex gap-2">
                <label className="mb-2 block text-sm font-medium">
                  Census (.bin)
                </label>

                <Help
                  title="What is census.bin?"
                  below={false}
                  content={
                    <div>
                      <p className="mb-1 font-medium">Census file format</p>
                      <ul className="list-disc ml-4 space-y-1">
                        <li>Binary file, no header.</li>
                        <li>
                          Concatenation of leaves, one per voter, each exactly
                          {" "}
                          <b>32 bytes</b> (big-endian).
                        </li>
                        <li>
                          Each leaf is <code>Poseidon(pubX, pubY)</code>{" "}
                          over BabyJub, encoded as a field element (BE).
                        </li>
                        <li>No padding; file size must be divisible by 32.</li>
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
              {errors.censusBytes && (
                <p className="text-red-600 text-xs">
                  {errors.censusBytes.message}
                </p>
              )}
              {errors.censusCount && (
                <p className="text-red-600 text-xs">
                  {errors.censusCount.message}
                </p>
              )}
              {errors.censusRootHex && (
                <p className="text-red-600 text-xs">
                  {errors.censusRootHex.message}
                </p>
              )}
            </div>
          )}

          {(control._formValues as FormValues).censusSource === "existing" && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenChoose(true)}
                  className="shrink-0 rounded-lg px-3 py-2 border dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Choose census…
                </button>
                {(control._formValues as FormValues).selectedCensusId && (
                  <div className="text-sm">
                    Chosen:{" "}
                    <span className="font-medium">
                      {(control._formValues as FormValues).selectedCensusTitle}
                    </span>
                  </div>
                )}
              </div>
              {errors.censusRootHex && (
                <p className="text-red-600 text-xs">
                  {errors.censusRootHex.message}
                </p>
              )}
            </div>
          )}

          {(control._formValues as FormValues).censusCount
            ? <ComputedCensusHints control={control} />
            : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className={btn(!disabled)}
          disabled={disabled}
        >
          {isSubmitting ? "Working…" : "Create poll"}
        </button>
        {stage !== "idle" && (
          <span className="text-sm text-purple-600">{stage}</span>
        )}
      </div>

      {errMsg && (
        <div className="mt-3 text-sm text-red-500 whitespace-pre-wrap">
          {errMsg}
        </div>
      )}

      {openChoose && (
        <ChooseCensusDialog
          onClose={() => setOpenChoose(false)}
          onPick={handlePickExisting}
          open={openChoose}
        />
      )}
    </form>
  );
};

const ActiveCoordinatorSummary: React.FC = () => {
  const KR = useKeyringCtx();
  const acc = KR.accounts[KR.active];
  if (!acc) {
    return (
      <div className="text-xs text-amber-700 dark:text-amber-500">
        No active ZK account. Open “ZK Accounts” and create/select one.
      </div>
    );
  }
  const pkx = "0x" + acc.pub[0].toString(16).padStart(64, "0");
  const pky = "0x" + acc.pub[1].toString(16).padStart(64, "0");
  return (
    <div className="rounded-lg border p-2 bg-gray-50 dark:bg-zinc-800/50 text-xs">
      Using account: <span className="font-medium">{acc.name}</span>
      <div className="font-mono break-all mt-1">X: {pkx}</div>
      <div className="font-mono break-all">Y: {pky}</div>
    </div>
  );
};

const ComputedCensusHints = ({ control }: { control: any }) => {
  const values = control._formValues as FormValues;
  return (
    <div className="text-xs mt-1 text-neutral-600 dark:text-neutral-300">
      {values?.censusCount
        ? <div>Entry count: {values.censusCount}</div>
        : null}
    </div>
  );
};
