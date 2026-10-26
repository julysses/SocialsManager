import * as React from "react";
import { cn } from "../../lib/utils";

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border border-border bg-card p-4 sm:p-5", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn("text-sm font-semibold tracking-wide text-foreground", className)} {...p} />
);

type Tone = "neutral" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
};
export const Badge = ({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />
);

export const EmptyState = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed border-border p-8 text-center">
    <p className="font-medium">{title}</p>
    {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
  </div>
);
