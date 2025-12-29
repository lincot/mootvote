import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export default function MobileWalletButton() {
  const { setVisible } = useWalletModal();
  return (
    <button
      type="button"
      onClick={() => setVisible(true)}
      className="sm:hidden inline-flex items-center justify-center rounded-lg border px-2 py-1 text-sm
                   border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <img
        src="/icons/solana-logo-mark-black.svg"
        className="h-5 block dark:hidden"
      >
      </img>
      <img
        src="/icons/solana-logo-mark-white.svg"
        className="h-5 hidden dark:block"
      >
      </img>
    </button>
  );
}
