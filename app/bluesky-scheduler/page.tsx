import { SolutionPage, solutionSeo } from '@/components/marketing/SolutionPage';
import { seoMetadata } from '@/lib/seo';

export const metadata = seoMetadata(solutionSeo('bluesky-scheduler'));

export default function Page() {
  return <SolutionPage slug="bluesky-scheduler" />;
}
