import source from '@/content/dpa.json';
import {LegalDocument} from '@/components/marketing/LegalDocument';
export const metadata={title:'Data Processing Agreement',alternates:{canonical:'/legal/dpa'}};
export default function DpaPage(){return <LegalDocument source={source}/>;}
