import type { ReactNode } from "react";

interface AdminPageFrameProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function AdminPageFrame({
  title,
  description,
  action,
  children,
}: AdminPageFrameProps) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          {description ? <p className="text-sm text-slate-600">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
