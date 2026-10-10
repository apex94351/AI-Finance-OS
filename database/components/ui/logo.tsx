import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-tight">
      <span className="grid size-9 place-items-center rounded-[11px] bg-[var(--ink)] text-[11px] font-bold tracking-[-0.04em] text-white">
        AF
      </span>
      <span>AI Finance OS</span>
    </Link>
  );
}
