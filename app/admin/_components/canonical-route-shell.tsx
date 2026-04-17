import Link from "next/link";

import { AdminPageFrame } from "@/components/admin/page-frame";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RouteLink = {
  href: string;
  label: string;
};

type CanonicalRouteShellProps = {
  title: string;
  description: string;
  scope: string;
  links?: readonly RouteLink[];
};

export function CanonicalRouteShell({
  title,
  description,
  scope,
  links = [],
}: CanonicalRouteShellProps) {
  return (
    <AdminPageFrame
      title={title}
      description={description}
      action={
        <Badge variant="outline" className="rounded-full px-3 py-1">
          Stage 0-1 Route Shell
        </Badge>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">当前交付范围</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <p>{scope}</p>
          <p>
            当前页面已纳入 canonical 后台 IA，后续阶段会补齐完整数据模型、交互行为与报表能力。
          </p>
        </CardContent>
      </Card>

      {links.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">关联入口</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {link.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </AdminPageFrame>
  );
}
