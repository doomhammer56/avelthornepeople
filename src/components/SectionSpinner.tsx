type Props = { label: string };

// Reserve the section while its data arrives. The surrounding page stays visible.
export function SectionSpinner({ label }: Props) {
  return (
    <div
      className="flex min-h-48 items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <span
        className="size-8 animate-spin rounded-full border-2 border-brand-teal/25 border-t-brand-teal motion-reduce:animate-none"
        aria-hidden
      />
    </div>
  );
}
