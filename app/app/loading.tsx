export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <p className="text-zinc-600">Loading your workspace…</p>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-32 animate-pulse rounded-2xl border border-zinc-200 bg-white"
        />
      ))}
    </div>
  );
}
