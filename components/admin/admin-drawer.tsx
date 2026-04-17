"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type AdminDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AdminDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: AdminDrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45"
        aria-label="关闭抽屉"
        onClick={() => onOpenChange(false)}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-slate-600">{description}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto">
          <div className="space-y-4 p-5">{children}</div>
          {footer ? (
            <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
              {footer}
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
