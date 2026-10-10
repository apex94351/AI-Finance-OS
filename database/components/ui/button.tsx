import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet";
}

const variants = {
  primary: "bg-[var(--accent)] text-white hover:-translate-y-0.5 hover:bg-[var(--accent-strong)]",
  secondary: "border border-[var(--line)] bg-white text-[var(--ink)] hover:border-[var(--ink)]",
  quiet: "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]",
};

export function Button({ children, className = "", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
