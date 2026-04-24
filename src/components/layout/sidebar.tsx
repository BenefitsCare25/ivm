"use client";

import Link from "next/link";
import { LayoutDashboard, Settings, Radar, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { NavItem } from "./nav-item";
import { useSidebar } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

interface SidebarProps {
  role: UserRole;
}

export function Sidebar({ role }: SidebarProps) {
  const { collapsed, toggle } = useSidebar();
  const isSuperAdmin = role === "SUPER_ADMIN";

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col glass-strong border-t-0 overflow-hidden transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-14 shrink-0 items-center px-3">
        {!collapsed && (
          <Link
            href={isSuperAdmin ? "/" : "/portals"}
            className="flex flex-1 items-center gap-2 text-foreground font-semibold min-w-0"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
              IV
            </div>
            <span className="truncate">IVM</span>
          </Link>
        )}
        <button
          onClick={toggle}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-accent/40 hover:text-accent-foreground transition-colors",
            collapsed && "mx-auto"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1 px-2 py-2">
        {isSuperAdmin && (
          <NavItem href="/" icon={LayoutDashboard} label="Auto Form" collapsed={collapsed} />
        )}
        <NavItem href="/portals" icon={Radar} label="Portal Tracker" collapsed={collapsed} />
        {isSuperAdmin && (
          <NavItem href="/admin/users" icon={ShieldCheck} label="Users" collapsed={collapsed} />
        )}
      </nav>

      {/* Bottom items */}
      {isSuperAdmin && (
        <div className="border-t border-glass-border/20 px-2 py-2">
          <NavItem href="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
        </div>
      )}
    </aside>
  );
}
