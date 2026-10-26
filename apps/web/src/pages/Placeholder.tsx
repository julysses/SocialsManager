import { EmptyState } from "../components/ui/card";

export function Placeholder({ title, phase, children }: { title: string; phase: string; children: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <EmptyState title={`Coming in ${phase}`}>{children}</EmptyState>
    </div>
  );
}
