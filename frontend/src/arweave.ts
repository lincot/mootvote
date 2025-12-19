import {
  ExistingBalanceFunding,
  OnDemandFunding,
  type SolanaWalletAdapter,
  TurboFactory,
} from "@ardrive/turbo-sdk/web";

const FREE_LIMIT = 100 * 1024;

type TurboData = {
  data: Uint8Array;
  contentType: string;
};

export async function turboBatchUpload(
  walletAdapter: SolanaWalletAdapter,
  items: TurboData[],
  opts?: { devnet?: boolean; rpc?: string },
): Promise<string[]> {
  if (items.length === 0) return [];

  const turboClient = TurboFactory.authenticated({
    walletAdapter,
    token: "solana",
    gatewayUrl: opts?.rpc,
  });

  const anyBigFiles = items.some((x) => x.data.length > FREE_LIMIT);
  if (opts?.devnet && anyBigFiles) {
    throw new Error("Data too large for devnet uploads");
  }

  // if OnDemandFunding is used with small files, it still requires a top up...
  const fundingMode = anyBigFiles
    ? new OnDemandFunding({ topUpBufferMultiplier: 1.1 })
    : new ExistingBalanceFunding();

  const promises = [];
  for (const item of items) {
    promises.push((async () => {
      const res = await turboClient.upload({
        data: item.data,
        dataItemOpts: {
          tags: [{ name: "Content-Type", value: item.contentType }],
        },
        fundingMode,
      });

      return `https://arweave.net/${res.id}`;
    })());
  }

  return await Promise.all(promises);
}
