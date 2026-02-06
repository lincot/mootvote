import { useLayoutEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { makeAuthSig } from "../auth.ts";
import { useNavigate } from "react-router";
import { CENSUS_URL } from "../env.tsx";
import { useKeyringCtx } from "../keyring.tsx";
import { INPUT_CN } from "../input.ts";
import { btn } from "../btn.ts";
import { useTranslation } from "react-i18next";
import UnlockToView from "../components/UnlockToView.tsx";
import StepperCard from "../components/StepperCard.tsx";

const schema = z.object({
  title: z.string().min(1, "required").max(200),
  description: z.string().max(2000).optional(),
  members: z.array(z.object({ name: z.string().min(1) })),
});

type FormValues = z.infer<typeof schema>;

export default function CensusCreatePage() {
  const { t } = useTranslation();

  useLayoutEffect(() => {
    document.title = t("page_titles.new_census");
  });

  const KR = useKeyringCtx();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  const steps = useMemo(
    () =>
      [
        { key: "sign", label: t("census_creation.stage.signing") },
        { key: "send", label: t("census_creation.stage.sending") },
        { key: "done", label: t("census_creation.stage.created") },
      ] as const,
    [],
  );
  type Stage = (typeof steps)[number]["key"] | null;
  const [stage, setStage] = useState<Stage>(null);

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
      setErr(null);
      setStage("sign");
      const acct = KR.accounts[KR.active];
      if (KR.locked || !acct) {
        throw new Error("Unlock ZK Accounts and select an account");
      }

      const sig = await makeAuthSig(acct.prv, acct.pub);
      setStage("send");
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
      setStage("done");
      setTimeout(() => nav(`/census/${j.census_id}`), 800);
    } catch (e: any) {
      console.error(e);
      setErr("Error: " + String(e?.message || e));
    }
  };

  const disabled = !isValid || !canSubmit || isSubmitting;

  if (KR.locked) return <UnlockToView />;

  return (
    <div className="max-w-xl mx-auto p-4">
      <h2 className="text-xl font-semibold mb-3">
        {t("census_creation.create_census")}
      </h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">
            {t("census_creation.title")}
          </label>
          <input
            className={INPUT_CN}
            {...register("title")}
          />
          {errors.title?.message && (
            <p className="text-red-600 text-xs">
              {t("census_creation.form_error." + errors.title.message)}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium">
            {t("census_creation.description")}
          </label>
          <textarea
            className={INPUT_CN}
            rows={3}
            {...register("description")}
          />
          {errors.description?.message && (
            <p className="text-red-600 text-xs">
              {t("census_creation.form_error." + errors.description.message)}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">
              {t("census_creation.members")}
            </label>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => append({ name: "" })}
            >
              + {t("actions.add")}
            </button>
          </div>
          <div className="space-y-2 mt-2">
            {fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <input
                  className={INPUT_CN}
                  placeholder={t("census_creation.name", { num: i + 1 })}
                  {...register(`members.${i}.name`)}
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
            {errors.members && (
              <p className="text-red-600 text-xs">
                {t("census_creation.form_error.members")}
              </p>
            )}
          </div>
        </div>

        <StepperCard
          steps={steps}
          currentKey={stage}
          finalKey="done"
          errorText={err}
          action={
            <button className={btn(!disabled)} disabled={disabled}>
              {isSubmitting
                ? t("loading.working")
                : t("census_creation.create_census")}
            </button>
          }
        />
      </form>
    </div>
  );
}
