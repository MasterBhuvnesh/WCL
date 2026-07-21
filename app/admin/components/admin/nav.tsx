"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ClipboardList,
  FileCheck2,
  ListChecks,
  LogOut,
  Menu,
  ShieldAlert,
  Ticket,
  Trophy,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import pkg from "@/package.json";

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

/** Shared nav body: links, logout, version. Used by the desktop sidebar and the mobile drawer. */
function NavBody({
  pathname,
  logout,
  onNavigate,
}: {
  pathname: string;
  logout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <nav className="flex flex-1 flex-col gap-0.5">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
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
      <p className="text-muted-foreground px-3 pt-2 text-xs">v{pkg.version}</p>
    </>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function logout() {
    clearToken();
    router.replace("/admin/login");
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-foreground/10 bg-card px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src="/assets/icon.png" alt="" width={20} height={20} className="shrink-0" />
          <p className="text-sm font-semibold tracking-tight">WCL Admin</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute top-0 left-0 flex h-full w-64 flex-col gap-1 border-r border-foreground/10 bg-card px-3 py-6">
            <div className="flex items-center justify-between px-2 pb-3">
              <div className="flex items-center gap-2">
                <Image src="/assets/icon.png" alt="" width={20} height={20} className="shrink-0" />
                <p className="text-sm font-semibold tracking-tight">WCL Admin</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <NavBody pathname={pathname} logout={logout} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-foreground/10 bg-card px-3 py-6 lg:flex">
        <div className="flex items-center gap-2 px-2 pb-3">
          <Image src="/assets/icon.png" alt="" width={20} height={20} className="shrink-0" />
          <p className="text-sm font-semibold tracking-tight">WCL Admin</p>
        </div>
        <NavBody pathname={pathname} logout={logout} />
      </aside>
    </>
  );
}
