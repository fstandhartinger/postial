"use client";
import { usePathname } from "next/navigation";
export function SiteFrame({
  children,
  header,
  footer,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const app = usePathname().startsWith("/app");
  return app ? (
    <>{children}</>
  ) : (
    <div className="site">
      {header}
      <main id="main-content" className="container main-content">
        {children}
      </main>
      {footer}
    </div>
  );
}
