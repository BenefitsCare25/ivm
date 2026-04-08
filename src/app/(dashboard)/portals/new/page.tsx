import { PortalSetupWizard } from "@/components/portals/portal-setup-wizard";

export default function NewPortalPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Add Portal</h1>
        <p className="text-sm text-muted-foreground">
          Connect to a web portal to start tracking items
        </p>
      </div>
      <PortalSetupWizard />
    </div>
  );
}
