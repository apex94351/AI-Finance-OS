import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-[var(--surface)] text-[var(--muted)]">{icon}</div>
      <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
