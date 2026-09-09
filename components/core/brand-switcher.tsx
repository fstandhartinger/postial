"use client";
import { Select } from "@/components/ui/input";
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
      <Select
        aria-label="Brand"
        className="ml-2 w-40 sm:w-56"
        value={
          search.get("brand") ??
          (path.startsWith("/app/brands/") ? path.split("/")[3] : "")
        }
        onChange={(e) =>
          router.push(
            (["/app", "/app/calendar", "/app/posts", "/app/posts/new"].includes(
              path,
            )
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
      </Select>
    </label>
  );
}
