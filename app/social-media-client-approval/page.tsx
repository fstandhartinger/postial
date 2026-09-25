import { SolutionPage, solutionSeo } from '@/components/marketing/SolutionPage';
import { seoMetadata } from '@/lib/seo';

export const metadata = seoMetadata(solutionSeo('social-media-client-approval'));

export default function Page() {
  return <SolutionPage slug="social-media-client-approval" />;
}
