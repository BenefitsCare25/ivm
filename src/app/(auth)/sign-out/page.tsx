import { signOutAction } from "./actions";

export default function SignOutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Sign out
        </button>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelector("form").submit();`,
        }}
      />
    </div>
  );
}
