import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border border-border bg-card/80 backdrop-blur", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tag({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "primary" | "accent" | "danger"; className?: string }) {
  const tones = {
    default: "border-border text-muted-foreground",
    primary: "border-primary/50 text-primary",
    accent: "border-accent/50 text-accent",
    danger: "border-destructive/50 text-destructive",
  };
  return <span className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[11px] uppercase", tones[tone], className)}>{children}</span>;
}

export function ConfidenceTag({ level }: { level: "high" | "medium" | "low" }) {
  return <Tag tone={level === "high" ? "primary" : level === "medium" ? "accent" : "danger"}>{level}</Tag>;
}

export function Btn({ className, variant = "primary", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/85",
    ghost: "border border-border text-foreground hover:bg-secondary",
    danger: "border border-destructive/60 text-destructive hover:bg-destructive/10",
  };
  return <button {...p} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors disabled:opacity-50", v[variant], className)} />;
}
