import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { ImportPage } from "./pages/Import";
import { ItemDetailPage } from "./pages/ItemDetail";
import { LibraryPage } from "./pages/Library";
import { Placeholder } from "./pages/Placeholder";
import { QueuePage } from "./pages/Queue";
import { TodayPage } from "./pages/Today";
import { UploadPage } from "./pages/Upload";
import { SettingsPage } from "./pages/Settings";

function Gate() {
  const { status, error, signOut } = useAuth();
  if (status === "loading") return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (status === "signed_out") return <Login />;
  if (status === "denied") return <Login denied reason={error} onSignOut={signOut} />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<TodayPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="queue/:id" element={<ItemDetailPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="replies" element={<Placeholder title="Replies" phase="Phase 3">Draft-only reply options for X posts you paste in.</Placeholder>} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="insights" element={<Placeholder title="Insights" phase="Phase 4">Metrics per post and hashtag set, plus party balance.</Placeholder>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Placeholder title="Not found" phase="—">That page does not exist.</Placeholder>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
