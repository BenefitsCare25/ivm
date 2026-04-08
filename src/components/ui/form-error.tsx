export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
      {message}
    </div>
  );
}
