import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { Login } from "./pages/Login";
import { Placeholder } from "./pages/Placeholder";
import { SettingsPage } from "./pages/Settings";

function Gate() {
  const { status, error, signOut } = useAuth();
  if (status === "loading") return <p role="status" className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (status === "signed_out") return <Login />;
  if (status === "denied") return <Login denied reason={error} onSignOut={signOut} />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Placeholder title="Today" phase="Phase 1">Today's edition and what needs your approval will show here.</Placeholder>} />
        <Route path="queue" element={<Placeholder title="Queue" phase="Phase 1">Cartoons with per-platform captions, checks, and Approve / Schedule.</Placeholder>} />
        <Route path="upload" element={<Placeholder title="Upload" phase="Phase 1">Drop in a cartoon and the ChatGPT text to create a caption package.</Placeholder>} />
        <Route path="replies" element={<Placeholder title="Replies" phase="Phase 3">Draft-only reply options for X posts you paste in.</Placeholder>} />
        <Route path="library" element={<Placeholder title="Library" phase="Phase 1">Every item, filterable by status and platform.</Placeholder>} />
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
