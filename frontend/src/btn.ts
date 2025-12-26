export const btn = (enabled: boolean) =>
  `shrink-0 px-4 py-2 rounded-lg text-white ${
    enabled
      ? "bg-neutral-900 dark:bg-neutral-900 border dark:border-gray-300 hover:bg-neutral-700 dark:hover:bg-neutral-800"
      : "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
  }`;
