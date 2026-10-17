// Structured data (schema.org JSON-LD). One @graph per page: the organization
// and website on every page, plus whatever the page adds (FAQ, breadcrumbs,
// the calculator as a WebApplication). Ids are stable so nodes cross-reference.

import { absolute } from './url';

type Node = Record<string, unknown>;

const id = (site: URL | undefined, frag: string) => `${absolute('', site)}#${frag}`;

export const organization = (site: URL | undefined): Node => ({
  '@type': 'Organization',
  '@id': id(site, 'org'),
  name: 'Taxline',
  url: absolute('', site),
  logo: absolute('favicon.svg', site),
  description: 'Agentic tax operations. A fleet of AI agents moves tax work from intake to reviewer-ready workpapers, with a human approving before anything ships.',
});

export const website = (site: URL | undefined): Node => ({
  '@type': 'WebSite',
  '@id': id(site, 'website'),
  name: 'Taxline',
  url: absolute('', site),
  publisher: { '@id': id(site, 'org') },
  inLanguage: 'en-US',
});

export const softwareApp = (site: URL | undefined): Node => ({
  '@type': 'SoftwareApplication',
  name: 'Taxline',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: absolute('app', site),
  publisher: { '@id': id(site, 'org') },
  offers: [
    { '@type': 'Offer', name: 'Core', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro', price: '39', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Team Plus', price: '59', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Team Pro', price: '99', priceCurrency: 'USD' },
  ],
});

export const breadcrumbs = (site: URL | undefined, trail: { name: string; path: string }[]): Node => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: absolute(t.path, site) })),
});

export const faqPage = (faqs: { q: string; a: string }[]): Node => ({
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const calculator = (site: URL | undefined, o: { name: string; path: string; description: string }): Node => ({
  '@type': 'WebApplication',
  name: o.name,
  url: absolute(o.path, site),
  description: o.description,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': id(site, 'org') },
});
