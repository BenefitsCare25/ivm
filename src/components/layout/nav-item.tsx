"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
  collapsed?: boolean;
}

export function NavItem({ href, icon: Icon, label, collapsed = false }: NavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-xl py-2 text-sm transition-all duration-150",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        isActive
          ? "bg-primary/12 text-primary font-semibold"
          : "text-sidebar-foreground hover:bg-primary/8 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}
