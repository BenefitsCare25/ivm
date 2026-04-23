import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Sign in to IVM</h1>
          <p className="text-sm text-muted-foreground">
            Intelligent Value Mapper
          </p>
        </div>
        <SignInForm />
      </div>
    </div>
  );
}
