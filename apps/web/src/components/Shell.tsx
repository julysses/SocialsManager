import { Calendar, FileUp, Images, LineChart, ListChecks, MessageSquareReply, Settings, LogOut } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const nav = [
  { to: "/", label: "Today", icon: Calendar },
  { to: "/queue", label: "Queue", icon: ListChecks },
  { to: "/upload", label: "Upload", icon: FileUp },
  { to: "/replies", label: "Replies", icon: MessageSquareReply },
  { to: "/library", label: "Library", icon: Images },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/settings", label: "Settings", icon: Settings },
];

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
    isActive && "bg-muted text-foreground",
  );

export function Shell() {
  const { brands, brand, setBrandId, signOut, session } = useAuth();
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border p-3 md:flex">
        <label className="sr-only" htmlFor="brand">Brand</label>
        <select
          id="brand" value={brand?.id} onChange={(e) => setBrandId(e.target.value)}
          className="mb-4 h-10 rounded-md border border-border bg-muted px-2 text-sm font-medium"
        >
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={link}>
              <Icon size={16} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <p className="truncate">{session?.user.email}</p>
          <Button variant="ghost" className="w-full justify-start" onClick={signOut}><LogOut size={14} aria-hidden /> Sign out</Button>
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-border p-3 md:hidden">
        <span className="font-semibold">{brand?.name}</span>
        <Button variant="ghost" onClick={signOut} aria-label="Sign out"><LogOut size={16} /></Button>
      </header>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 md:pb-6">
        <Outlet />
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-border bg-background/95 p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {nav.filter((n) => ["/", "/queue", "/upload", "/settings"].includes(n.to)).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 text-xs text-muted-foreground", isActive && "text-primary")}>
            <Icon size={18} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
