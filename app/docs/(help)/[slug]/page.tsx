import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { helpIndex, helpSource } from '../../content';
import { HelpMarkdown } from '../../_components/markdown';
import { recordPublicView } from '@/lib/funnel';
import { seoMetadata } from '@/lib/seo';
export const dynamicParams = false;
export function generateStaticParams() { return helpIndex.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = helpIndex.find(article => article.slug === slug);
  if (!article) notFound();
  return seoMetadata({ title: `${article.title} · Postial`, description: `${article.summary} Read the Postial help guide for practical workspace steps.`, path: `/docs/${slug}` });
}
export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  await recordPublicView('docs_view', '/docs');
  const { slug } = await params;
  const source = helpSource(slug);
  if (!source) notFound();
  return <article className="help-article"><HelpMarkdown source={source} /></article>;
}
