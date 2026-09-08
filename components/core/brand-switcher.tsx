"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
export function BrandSwitcher({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const router = useRouter(),
    search = useSearchParams(),
    path = usePathname();
  return (
    <label className="block text-sm">
      Brand
      <select
        aria-label="Brand"
        className="ml-3 rounded border p-2"
        value={search.get("brand") ?? ""}
        onChange={(e) =>
          router.push(
            (["/app/calendar", "/app/posts", "/app/posts/new"].includes(path)
              ? path
              : "/app/posts") +
              (e.target.value ? "?brand=" + e.target.value : ""),
          )
        }
      >
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
