import { useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  LedgerWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import Page404 from "./pages/Page404";
import CensusCreatePage from "./pages/CensusCreatePage";
import CensusesListPage from "./pages/CensusesListPage";
import CensusDetailPage from "./pages/CensusDetailPage";
import CensusJoinPage from "./pages/CensusJoinPage";
import PollListPage from "./pages/PollListPage.tsx";
import PollDetailPage from "./pages/PollDetailPage.tsx";
import { RPC_URL } from "./env.tsx";
import { KeyringProvider, RevoKeysProvider } from "./keyring.tsx";
import { PollCreatePage } from "./pages/VoteCreatePage.tsx";
import { AccountDrawer } from "./components/AccountDrawer.tsx";
import { Layout } from "./Layout.tsx";

export default function App() {
  const wallets = useMemo(
    () => [new SolflareWalletAdapter(), new LedgerWalletAdapter()],
    [],
  );
  const [showAccounts, setShowAccounts] = useState(false);

  return (
    <BrowserRouter>
      <ConnectionProvider endpoint={RPC_URL}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <KeyringProvider>
              <RevoKeysProvider>
                <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-100">
                  <Routes>
                    <Route
                      element={<Layout setShowAccounts={setShowAccounts} />}
                    >
                      <Route
                        path="/"
                        element={<Navigate to="/polls/new" replace />}
                      />
                      <Route path="/polls" element={<PollListPage />} />
                      <Route path="/polls/new" element={<PollCreatePage />} />
                      <Route
                        path="/polls/:pollId"
                        element={<PollDetailPage />}
                      />
                      <Route path="/censuses" element={<CensusesListPage />} />
                      <Route
                        path="/census/new"
                        element={<CensusCreatePage />}
                      />
                      <Route
                        path="/census/:censusId"
                        element={<CensusDetailPage />}
                      />
                      <Route
                        path="/census/:censusId/join/:token"
                        element={<CensusJoinPage />}
                      />
                      <Route
                        path="*"
                        element={<Page404 />}
                      />
                    </Route>
                  </Routes>

                  <AccountDrawer
                    open={showAccounts}
                    onClose={() => setShowAccounts(false)}
                  />
                </div>
              </RevoKeysProvider>
            </KeyringProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </BrowserRouter>
  );
}
