import * as anchor from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet.js";
import { toTransaction, updateConfig } from "@lincot/zk-relayer-sdk";
import { sendAndConfirmVersionedTx } from "../../helpers/utils.ts";
import { PublicKey } from "@solana/web3.js";

async function main(): Promise<void> {
  if (process.argv.length < 2 + 3) {
    console.error("Usage: updateConfig <fee> <feeKey> <endpoint>");
    process.exit(1);
  }

  const fee = BigInt(process.argv[2]);
  const relayerFeeKey = new PublicKey(process.argv[3]);
  const relayerEndpoint = process.argv[4];

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as NodeWallet).payer;

  const ix = await updateConfig({
    oldAdmin: payer.publicKey,
    newAdmin: payer.publicKey,
    fee: fee,
    payer: payer.publicKey,
    relayerEndpoint,
    relayerFeeKey,
  });
  const transactionSignature = await sendAndConfirmVersionedTx(
    provider.connection,
    toTransaction(
      [ix],
      await provider.connection.getLatestBlockhash().then((b) => b.blockhash),
      payer,
    ),
    [payer],
    payer.publicKey,
  );

  console.log("Transaction signature:", transactionSignature);
}

main();
