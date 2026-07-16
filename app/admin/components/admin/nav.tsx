"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardList,
  FileCheck2,
  ListChecks,
  LogOut,
  ShieldAlert,
  Ticket,
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
  { href: "/admin/hallticket", label: "Hall tickets", icon: Ticket },
  { href: "/admin/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/admin/sessions", label: "Sessions", icon: UploadCloud },
  { href: "/admin/results", label: "Results", icon: FileCheck2 },
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
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-[radial-gradient(ellipse_120%_100%_at_50%_-20%,#6b6b6b,#000_65%)] font-medium text-white shadow-[inset_0_1px_2px_rgba(255,255,255,0.25)]"
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
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </aside>
  );
}
