import { Link } from "react-router";
import { btn } from "../btn";

export default function HomePage() {
  return <>
    <section>
      <div className="absolute bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-950 dark:to-zinc-900" />
      <div className="max-w-6xl mx-auto px-4 pt-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mt-3 text-3xl md:text-5xl font-extrabold leading-tight">
              Anonymous, bribery-resistant voting<br />
              <span className="text-[#9945FF]">on Solana</span>
            </h1>
            <p className="mt-4 max-w-2xl text-zinc-600 dark:text-zinc-300">
              MootVote lets you run fully private, verifable polls, powered by
              ZK and Solana.<br />
              No wallet is required to vote.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section className="py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-4">How it works</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">1) Build a Census</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              The organizer creates a census, which is a list of eligible
              voters. Members can claim a slot with their public key via
              invite links. You can also import a census created elsewhere.
            </p>
          </div>
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">2) Create a Poll</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              Give it a title and choices. The census and description are
              stored in decentralized storage; the poll with its time window
              and optional fees goes on Solana.
            </p>
          </div>
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">3) Vote Privately</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              Voters prove membership with ZK proofs and encrypt their choice
              to the tallier. They can vote via relayer (no wallet required)
              and use a private re-voting key to change their vote later.
            </p>
          </div>
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">4) Tally</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              The tallier decrypts the votes and submits ZK proofs of correct
              counting, making it impossible to tamper with the results.
            </p>
          </div>
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">5) Results</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              After the poll ends and all votes are counted, results are
              finalized on-chain.
            </p>
          </div>
          <div className="rounded-2xl border p-4">
            <h3 className="font-semibold">Security & Privacy</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">
              Votes are unlinkable to identities. Membership is proven without
              disclosure. Bribery is not an option because voters cannot prove
              how they voted to anyone but the tallier.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section className="py-6">
      <div className="max-w-6xl mx-auto px-4">
        <div className="rounded-2xl border p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Ready to try?</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Invite a few participants to start a poll.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/censuses"
              className={btn(true)}
            >
              Create a census
            </Link>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Disclaimer: this is early software, not yet suitable for high-stakes governance.
        </p>
      </div>
    </section>
  </>;
}
