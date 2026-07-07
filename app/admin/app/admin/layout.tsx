"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AdminNav } from "@/components/admin/nav";
import { getToken } from "@/lib/api";

/**
 * Client-side auth gate for the admin screens. The login page renders bare;
 * every other /admin route requires a token or redirects to login.
 * ponytail: client-only guard — the API still enforces auth on every request.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/admin/login");
      return;
    }
    setReady(true);
  }, [isLogin, pathname, router]);

  if (isLogin) return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1">
      <AdminNav />
      <div className="flex-1 overflow-x-auto">{children}</div>
    </div>
  );
}
