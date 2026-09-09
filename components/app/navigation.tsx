"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
const items = [
  ["Overview", "/app", "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z"],
  ["Calendar", "/app/calendar", "M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16"],
  ["Posts", "/app/posts", "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5"],
  ["Brands", "/app/brands", "M3 7h18v14H3z M8 7V3h8v4 M3 12h18"],
  ["Channels", "/app/channels", "M4 8h16 M4 16h16 M8 4v16"],
  ["Approvals", "/app/approvals", "M4 12l5 5L20 6"],
  ["Billing", "/app/billing", "M3 5h18v14H3z M3 10h18 M7 15h4"],
  [
    "Settings",
    "/app/settings",
    "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  ],
];
export function Navigation({
  mobile = false,
  settingsHref,
}: {
  mobile?: boolean;
  settingsHref?: string;
}) {
  const path = usePathname();
  return (
    <nav
      aria-label={mobile ? "Mobile workspace" : "Workspace"}
      className={mobile ? "app-bottom-nav" : "space-y-2"}
    >
      {items
        .filter(([label]) => label !== "Settings" || !!settingsHref)
        .map(([label, route, icon]) => {
          const href = label === "Settings" ? settingsHref! : route;
          return (
            <Link
              key={href}
              href={href}
              aria-current={
                (href === "/app" ? path === href : path.startsWith(href))
                  ? "page"
                  : undefined
              }
              className="app-nav-link"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={icon} />
              </svg>
              <span>{label}</span>
            </Link>
          );
        })}
    </nav>
  );
}
export function NewPostLink({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  const brand =
    useSearchParams().get("brand") ??
    (path.startsWith("/app/brands/") ? path.split("/")[3] : null);
  return (
    <Link
      className={`${buttonClass} ${mobile ? "app-fab" : "app-new-post-desktop"}`}
      href={
        "/app/posts/new" + (brand ? "?brand=" + encodeURIComponent(brand) : "")
      }
    >
      <span aria-hidden="true" className="mr-2 text-xl">
        +
      </span>
      New post
    </Link>
  );
}
