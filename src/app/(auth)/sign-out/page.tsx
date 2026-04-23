import { signOutAction } from "./actions";

export default function SignOutPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md shadow-primary/20"
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
