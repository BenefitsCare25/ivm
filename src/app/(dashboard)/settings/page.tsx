export const dynamic = "force-dynamic";

import { ApiKeysForm } from "@/components/settings/api-keys-form";
import { ChatGptStatusCard } from "@/components/settings/chatgpt-status-card";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { DocumentTypesManager } from "@/components/settings/document-types-manager";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Review the shared AI connection and application preferences
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">AI Provider</h2>
          <p className="text-sm text-muted-foreground">
            All AI processing uses the deployment-wide ChatGPT OAuth connection. Personal keys are fallback only.
          </p>
        </div>
        <ChatGptStatusCard />
        <ApiKeysForm />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Document Recognition</h2>
          <p className="text-sm text-muted-foreground">
            Define the documents your claims require and the alternative names hospitals use for
            them. This drives document classification and required-document checks during verification.
          </p>
        </div>
        <DocumentTypesManager />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Account</h2>
          <p className="text-sm text-muted-foreground">
            Manage your account security settings.
          </p>
        </div>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
