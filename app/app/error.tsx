"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-4">
      <h2 className="text-xl font-semibold">We couldn’t load your workspace</h2>
      <p>Please try again in a moment.</p>
      <button
        className="rounded bg-emerald-700 px-5 py-3 text-white"
        onClick={reset}
      >
        Try again
      </button>
    </div>
  );
}
