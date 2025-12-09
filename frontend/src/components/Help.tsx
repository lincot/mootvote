import { useState } from "react";

export const Help: React.FC<{ title: string; content: any; below: boolean }> = (
  { title, content, below },
) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center border border-gray-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        title={title}
      >
        ?
      </button>
      {open && (
        <div
          className={`absolute z-10 w-80 p-3 text-xs rounded-lg border bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 shadow ${
            below ? "mt-2" : "bottom-full mb-2 left-1/2 -translate-x-1/2"
          }`}
        >
          {content}
        </div>
      )}
    </div>
  );
};
