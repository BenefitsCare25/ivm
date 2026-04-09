"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-error";

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <FormError message={messages[0]} />;
}

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setErrors({ confirmPassword: ["Passwords do not match"] });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrors(data.errors ?? { _: [data.error ?? "Failed to update password"] });
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <p className="text-sm font-medium text-foreground">Change Password</p>
        <p className="text-xs text-muted-foreground">Update your account password</p>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Current password</label>
            <div className="relative">
              <Input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <FieldError messages={errors.currentPassword} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">New password</label>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <FieldError messages={errors.newPassword} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Confirm new password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              required
            />
            <FieldError messages={errors.confirmPassword} />
          </div>

          <FieldError messages={errors._} />
        </CardContent>

        <CardFooter className="flex items-center justify-between pt-2">
          {success && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <CheckCircle className="h-3.5 w-3.5" />
              Password updated
            </span>
          )}
          {!success && <span />}
          <Button type="submit" size="sm" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Update password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
