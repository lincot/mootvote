import { WebUploader } from "@irys/web-upload";
import { WebSolana } from "@irys/web-upload-solana";
import type BaseWebIrys from "@irys/web-upload/esm/base";

type IrysData = {
  data: Buffer;
  contentType: string;
  tags?: Array<{ name: string; value: string }>;
};

async function getIrysForBrowserSolana(
  wallet: any,
  options?: { devnet?: boolean; rpc?: string },
): Promise<BaseWebIrys> {
  let irys = WebUploader(WebSolana).withProvider(wallet);
  if (options?.rpc) irys = irys.withRpc(options.rpc);
  if (options?.devnet) irys = irys.devnet();
  return await irys;
}

export async function irysBatchUpload(
  wallet: any,
  data: IrysData[],
  opts?: { devnet?: boolean; rpc?: string },
): Promise<string[]> {
  if (data.length === 0) return [];
  const irys = await getIrysForBrowserSolana(wallet, {
    devnet: opts?.devnet,
    rpc: opts?.rpc,
  });
  const total = data.reduce((sum, d) => sum + d.data.byteLength, 0);
  const price = await irys.getPrice(total);
  await irys.fund(price);
  const urls: string[] = [];
  for (const item of data) {
    const resp = await irys.upload(item.data, {
      tags: [
        { name: "Content-Type", value: item.contentType },
        ...(item.tags || []),
      ],
    });
    urls.push(`https://gateway.irys.xyz/${resp.id}`);
  }
  return urls;
}
