import Link from "next/link";
import { LayoutDashboard, Plus, Settings } from "lucide-react";
import { NavItem } from "./nav-item";

export function Sidebar() {
  return (
    <aside className="flex w-[var(--sidebar-width)] flex-col border-r border-sidebar-border bg-sidebar-bg">
      <div className="flex h-14 items-center px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground font-semibold"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            IV
          </div>
          <span>IVM</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        <NavItem href="/" icon={LayoutDashboard} label="Dashboard" />
        <NavItem href="/sessions/new" icon={Plus} label="New Session" />
      </nav>

      <div className="border-t border-sidebar-border px-3 py-2">
        <NavItem href="/settings" icon={Settings} label="Settings" />
      </div>
    </aside>
  );
}
