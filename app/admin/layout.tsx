"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, PanelLeftClose, Radar } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  ADMIN_NAV_TREE,
  getAdminBreadcrumb,
  getAdminRouteMatch,
} from "@/lib/navigation";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = getAdminRouteMatch(pathname, searchParams);
  const breadcrumb = getAdminBreadcrumb(pathname, searchParams);

  return (
    <div className="admin-shell min-h-screen">
      <div className="mx-auto grid w-full max-w-[1500px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[250px_1fr] lg:gap-6 lg:px-6">
        <aside className="rounded-2xl border border-slate-200/90 bg-white/90 p-4 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Radar className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs tracking-[0.12em] text-slate-500">OrchestraX运营后台</p>
              <p className="font-semibold text-slate-900">运营后台</p>
            </div>
          </div>

          <nav className="space-y-3" data-testid="admin-primary-nav">
            {ADMIN_NAV_TREE.filter((group) => !group.hidden).map((group) => {
              const isActiveGroup = current?.group.key === group.key;
              return (
                <section key={group.key} className="space-y-1.5">
                  <Link
                    href={group.defaultHref}
                    className={`inline-flex w-full items-center rounded-xl px-2 py-1 text-xs font-semibold tracking-wide transition ${
                      isActiveGroup
                        ? "text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {group.label}
                  </Link>
                  <div
                    className="space-y-1"
                    data-testid={isActiveGroup ? "admin-secondary-nav" : undefined}
                  >
                    {group.items.map((item) => {
                      const isActiveItem =
                        pathname === item.href ||
                        pathname.startsWith(`${item.href}/`);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`inline-flex w-full items-center rounded-xl border px-3 py-2 text-sm transition ${
                            isActiveItem
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <header className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">运营后台</p>
                <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                  {breadcrumb.length === 0 ? (
                    <span>今日看板</span>
                  ) : (
                    breadcrumb.map((segment, index) => (
                      <span key={`${segment}-${index}`} className="inline-flex items-center gap-1">
                        {index === 0 ? null : <ChevronRight className="h-3 w-3" />}
                        <span>{segment}</span>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full px-3 py-1">
                  演示环境
                </Badge>
                <Link
                  href="/purchase"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                  查看经销商端
                </Link>
              </div>
            </div>
          </header>
          <main className="rounded-2xl border border-slate-200 bg-white/88 p-4 shadow-sm md:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
