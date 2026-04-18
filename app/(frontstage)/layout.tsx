import Link from "next/link";
import { ArrowRight, Building2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FRONTSTAGE_NAV } from "@/lib/navigation";

export default function FrontstageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="frontstage-shell min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                经销商订货演示
              </p>
              <p className="text-base font-semibold text-slate-900">
                厨邦经销商采购系统
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            {FRONTSTAGE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-primary/40 hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Button asChild variant="outline" className="bg-white">
            <Link href="/admin/workbench/overview" className="gap-2">
              <Building2 className="h-4 w-4" />
              进入运营配置台
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-10">
        <div className="glass-panel overflow-hidden rounded-3xl border border-white/70 p-5 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.6)] md:p-8">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              美味鲜 / 厨邦演示版
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1">
              采购流程演示
            </Badge>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
