import { SolutionPage, solutionSeo } from '@/components/marketing/SolutionPage';
import { seoMetadata } from '@/lib/seo';

export const metadata = seoMetadata(solutionSeo('telegram-channel-scheduler'));

export default function Page() {
  return <SolutionPage slug="telegram-channel-scheduler" />;
}
