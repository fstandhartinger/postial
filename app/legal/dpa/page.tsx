import source from '@/content/dpa.json';
import {LegalDocument} from '@/components/marketing/LegalDocument';
import { seoMetadata } from '@/lib/seo';
export const metadata=seoMetadata({title:'Postial data processing agreement',description:'Review Postial\'s data processing agreement, security measures, subprocessors, transfers, audits, and deletion terms for customer data.',path:'/legal/dpa'});
export default function DpaPage(){return <LegalDocument source={source}/>;}
