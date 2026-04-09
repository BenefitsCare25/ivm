"use client";

import Link from "next/link";
import { LayoutDashboard, Settings, Radar, Brain, ChevronLeft, ChevronRight } from "lucide-react";
import { NavItem } from "./nav-item";
import { useSidebar } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar-bg overflow-hidden transition-[width] duration-200 ease-in-out",
        collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-14 shrink-0 items-center px-3">
        {!collapsed && (
          <Link
            href="/"
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
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
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
        <NavItem href="/" icon={LayoutDashboard} label="Auto Form" collapsed={collapsed} />
        <NavItem href="/portals" icon={Radar} label="Portal Tracker" collapsed={collapsed} />
        <NavItem href="/intelligence" icon={Brain} label="Intelligence" collapsed={collapsed} />
      </nav>

      {/* Bottom items */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <NavItem href="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
      </div>
    </aside>
  );
}
