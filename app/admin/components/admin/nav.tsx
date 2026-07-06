"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardList,
  ListChecks,
  LogOut,
  ShieldAlert,
  Trophy,
  UploadCloud,
  Users,
} from "lucide-react";

import { clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", icon: ClipboardList },
  { href: "/admin/questions", label: "Exam & questions", icon: ListChecks },
  { href: "/admin/participants", label: "Participants", icon: Users },
  { href: "/admin/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/admin/sessions", label: "Sessions", icon: UploadCloud },
  { href: "/admin/integrity", label: "Integrity", icon: ShieldAlert },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.replace("/admin/login");
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-foreground/10 bg-card px-3 py-6">
      <p className="px-2 pb-3 text-sm font-semibold tracking-tight">WCL Admin</p>
      <nav className="flex flex-1 flex-col gap-0.5">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={logout}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </aside>
  );
}
