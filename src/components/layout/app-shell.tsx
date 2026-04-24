import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { OrbBackground } from "./orb-background";
import { SidebarProvider } from "@/lib/sidebar-context";
import { auth } from "@/lib/auth";
import type { UserRole } from "@prisma/client";

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const session = await auth();
  const role = (session?.user?.role ?? "ADMIN") as UserRole;

  return (
    <SidebarProvider>
      <div className="relative flex h-screen">
        <OrbBackground />
        <Sidebar role={role} />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
