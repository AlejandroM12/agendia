export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
        <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p>}
    </div>
  );
}
