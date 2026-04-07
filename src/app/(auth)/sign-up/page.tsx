import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Create account</h1>
          <p className="text-sm text-muted-foreground">
            Get started with IVM
          </p>
        </div>
        <SignUpForm />
      </div>
    </div>
  );
}
