import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { makeAuthSig } from "../auth.ts";
import {
  btn,
  CENSUS_URL,
  INPUT_CN,
  UNLOCK_TO_VIEW,
  useKeyringCtx,
} from "../App.tsx";
import { useNavigate } from "react-router";

const schema = z.object({
  title: z.string().min(1, "Title required").max(200),
  description: z.string().max(2000).optional(),
  members: z.array(
    z.object({ name: z.string().min(1, "Name required").max(200) }),
  ),
});

type FormValues = z.infer<typeof schema>;

export default function CensusCreatePage() {
  const KR = useKeyringCtx();
  const nav = useNavigate();
  const [err, setErr] = useState<string>("");
  const [stage, setStage] = useState<string>("");

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      members: [{ name: "" }, { name: "" }],
    },
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "members",
  });

  const canSubmit = useMemo(() => !KR.locked && !!KR.accounts[KR.active], [KR]);

  const onSubmit = async (data: FormValues) => {
    try {
      setStage("Signing…");
      setErr("");
      const acct = KR.accounts[KR.active];
      if (KR.locked || !acct) {
        throw new Error("Unlock ZK Accounts and select an account");
      }

      const sig = await makeAuthSig(acct.prv, acct.pub);
      setStage("Creating census…");
      const body = {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        members: data.members.map((m) => m.name.trim()).filter(Boolean),
      };

      const r = await fetch(`${CENSUS_URL}/census`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sig },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`create failed: ${await r.text()}`);
      const j = await r.json();
      setStage("Created successfully");
      setTimeout(() => nav(`/census/${j.census_id}`), 800);
    } catch (e: any) {
      console.error(e);
      setStage("");
      setErr("Error: " + String(e?.message || e));
    }
  };

  const disabled = !isValid || !canSubmit || isSubmitting;

  if (KR.locked) return UNLOCK_TO_VIEW;

  return (
    <div className="max-w-xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-3">Create Census</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input
            className={INPUT_CN}
            {...register("title")}
          />
          {errors.title && (
            <p className="text-red-600 text-xs">{errors.title.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium">
            Description (optional)
          </label>
          <textarea
            className={INPUT_CN}
            rows={3}
            {...register("description")}
          />
          {errors.description && (
            <p className="text-red-600 text-xs">{errors.description.message}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">Participants</label>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => append({ name: "" })}
            >
              + Add
            </button>
          </div>
          <div className="space-y-2 mt-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <input
                  className={INPUT_CN}
                  placeholder={`Name #${i + 1}`}
                  {...register(`members.${i}.name`)}
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
            {errors.members && (
              <p className="text-red-600 text-xs">Check participant names</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className={btn(!disabled)} disabled={disabled}>
            {isSubmitting ? "Working…" : "Create census"}
          </button>
          {stage && <span className="text-sm text-purple-600">{stage}</span>}
          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>
      </form>
    </div>
  );
}
