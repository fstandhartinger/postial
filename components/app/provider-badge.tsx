const colors: Record<string, string> = {
  bluesky: "#0668d9",
  mastodon: "#563acc",
  telegram: "#086b96",
  x: "#09090b",
  threads: "#09090b",
};
export function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      title={provider}
      aria-label={provider}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
      style={{ backgroundColor: colors[provider] || "#52525b" }}
    >
      {provider.slice(0, 2).toUpperCase()}
    </span>
  );
}
