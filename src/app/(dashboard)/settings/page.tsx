export const dynamic = "force-dynamic";

import { ApiKeysForm } from "@/components/settings/api-keys-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your API keys and application preferences
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">AI Provider Keys</h2>
          <p className="text-sm text-muted-foreground">
            Connect your own API keys for document extraction. Keys are encrypted and stored securely.
          </p>
        </div>
        <ApiKeysForm />
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
