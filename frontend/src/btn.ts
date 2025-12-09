export const btn = (enabled: boolean) =>
  `px-4 py-2 rounded-lg text-white ${
    enabled
      ? "dark:bg-neutral-900 hover:bg-neutral-800"
      : "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
  }`;
