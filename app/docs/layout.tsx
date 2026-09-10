import './docs.css';
import { DocsBreadcrumbs } from '@/components/marketing/DocsBreadcrumbs';
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div className="docs-scope"><DocsBreadcrumbs current="Documentation" path="/docs" />{children}</div>;
}
