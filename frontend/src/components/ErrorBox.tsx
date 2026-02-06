import type { ReactNode } from "react";

export default function ErrorBox(props: {
  text: ReactNode;
}) {
  return (
    <div className="mt-2 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 whitespace-pre-wrap break-words">
      {props.text}
    </div>
  );
}
