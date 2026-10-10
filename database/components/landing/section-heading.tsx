interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
}

export function SectionHeading({ eyebrow, title, description }: SectionHeadingProps) {
  return (
    <div>
      <p className="eyebrow text-[var(--accent-strong)]">{eyebrow}</p>
      <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--ink)] sm:text-4xl">{title}</h2>
      {description ? <p className="mt-5 max-w-lg text-base leading-7 text-[var(--muted)]">{description}</p> : null}
    </div>
  );
}
