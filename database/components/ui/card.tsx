import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return <div className={`rounded-2xl border border-[var(--line)] bg-white ${className}`} {...props}>{children}</div>;
}
