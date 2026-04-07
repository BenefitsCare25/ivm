import { Settings } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and application preferences
        </p>
      </div>
      <EmptyState
        icon={Settings}
        title="Settings coming soon"
        description="Account settings, API key configuration, and preferences will be available in a future update."
      />
    </div>
  );
}
