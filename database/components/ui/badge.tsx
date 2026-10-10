import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}

const tones = {
  neutral: "bg-[var(--surface)] text-[var(--muted)]",
  success: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  warning: "bg-[#fff3df] text-[#9a5b00]",
  danger: "bg-[#ffebe9] text-[#b42318]",
};

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
