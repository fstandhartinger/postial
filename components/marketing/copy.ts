import copy from '@/content/landing.json';
export type Section = keyof typeof copy;
export function items(section: Section) { return copy[section]; }
export function words(section: Section, label: string) { return items(section).find(item => item.label === label)?.text ?? ''; }
export const description = words('SEO', 'Meta description');
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://postial.co';
