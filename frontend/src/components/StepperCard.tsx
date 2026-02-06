import { type ReactNode, useMemo } from "react";
import ErrorBox from "./ErrorBox";

type StepKey = string;

export type Step<T extends StepKey> = {
  key: T;
  label?: ReactNode;
};

function cn(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

export default function StepperCard<T extends StepKey>(props: {
  steps: readonly Step<T>[];
  currentKey: T | null | undefined;
  finalKey?: T;
  errorText?: ReactNode | null;
  className?: string;
  action: ReactNode;
}) {
  const {
    steps,
    currentKey,
    finalKey,
    errorText,
    className,
    action,
  } = props;

  const currentIdx = useMemo(() => {
    if (!currentKey) return -1;
    return steps.findIndex((s) => s.key === currentKey);
  }, [steps, currentKey]);

  const effectiveErrorKey = errorText ? (currentKey ?? undefined) : undefined;

  const stateForIndex = (i: number) => {
    const step = steps[i];
    if (effectiveErrorKey && step.key === effectiveErrorKey) {
      return "error" as const;
    }
    if (currentIdx < 0) return "todo" as const;

    if (i < currentIdx) return "done" as const;

    if (i === currentIdx) {
      const isFinalByIndex = i === steps.length - 1;
      const isFinalByKey = finalKey && currentKey === finalKey;
      if (isFinalByIndex || isFinalByKey) return "done" as const;
      return "active" as const;
    }

    return "todo" as const;
  };

  return (
    <div
      className={cn(
        "mt-4 rounded-2xl border dark:border-neutral-800 p-3 bg-white/70 dark:bg-neutral-900/40",
        className,
      )}
      aria-live="polite"
    >
      <div className="space-y-3">
        {action}

        <div className="min-w-0">
          <div className="flex gap-2 min-w-0">
            {steps.map((s, i) => {
              const st = stateForIndex(i);
              return (
                <div key={s.key} className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "h-2 rounded-full",
                      st === "done" && "bg-green-500/70",
                      st === "active" && "bg-purple-500/80 animate-pulse",
                      st === "error" && "bg-red-500/70",
                      st === "todo" && "bg-neutral-200 dark:bg-neutral-800",
                    )}
                  />
                  {s.label
                    ? (
                      <div className="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                        {s.label}
                      </div>
                    )
                    : null}
                </div>
              );
            })}
          </div>

          {errorText && <ErrorBox text={errorText} />}
        </div>
      </div>
    </div>
  );
}
