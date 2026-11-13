/*
 * JSON-LD for the contracting site.
 *
 * Every page carries the same organization, person and website nodes, plus a
 * WebPage node for the page itself. The homepage adds the service, with the
 * hourly rate the site already states, so search engines and assistants can
 * read what the business is without scraping the rendered page.
 *
 * The lab keeps its own structured data (src/pages/kb/[slug].astro), so this
 * module is only used when Base.astro draws the contracting site.
 */
import { DEFINITION, KIND } from './offer.js';
import { HOURLY_USD } from './pricing.js';
import { copy } from './site.js';

const ORIGIN = 'https://malipetek.dev';
const ORGANIZATION = `${ORIGIN}/#organization`;
const PERSON = `${ORIGIN}/#person`;
const WEBSITE = `${ORIGIN}/#website`;
const SERVICE = `${ORIGIN}/#vibe-contracting`;

/** What the owner actually works on, from the site's own pages and projects. */
const KNOWS_ABOUT = [
  'Vibe contracting',
  'Website changes',
  'Website maintenance',
  'AI-assisted web development',
  'Astro',
  'Shopify apps',
  'Cloudflare Workers',
  'Model Context Protocol',
];

export function contractingStructuredData({
  canonical,
  title,
  description,
  locale,
  image,
  t,
  home = false,
}) {
  const definition = copy(t, 'offer.define', DEFINITION);
  const siteDescription = t('site.home.description');

  const graph = [
    {
      '@type': ['Organization', 'ProfessionalService'],
      '@id': ORGANIZATION,
      name: 'M. Ali Petek',
      alternateName: 'malipetek.dev',
      url: `${ORIGIN}/`,
      logo: { '@type': 'ImageObject', url: image },
      image,
      description: definition,
      founder: { '@id': PERSON },
      sameAs: ['https://github.com/malipetek'],
      knowsAbout: KNOWS_ABOUT,
      areaServed: 'Worldwide',
    },
    {
      '@type': 'Person',
      '@id': PERSON,
      name: 'Muhammet Ali Petek',
      alternateName: 'M. Ali Petek',
      url: `${ORIGIN}/`,
      jobTitle: 'Software developer',
      sameAs: ['https://github.com/malipetek'],
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE,
      url: `${ORIGIN}/`,
      name: 'malipetek.dev',
      description: siteDescription,
      publisher: { '@id': ORGANIZATION },
      inLanguage: locale,
    },
    {
      '@type': 'WebPage',
      '@id': canonical,
      url: canonical,
      name: title,
      description,
      isPartOf: { '@id': WEBSITE },
      about: { '@id': ORGANIZATION },
      inLanguage: locale,
      primaryImageOfPage: { '@type': 'ImageObject', url: image },
      ...(home ? { mainEntity: { '@id': SERVICE } } : {}),
    },
  ];

  if (home) {
    graph.push({
      '@type': 'Service',
      '@id': SERVICE,
      name: KIND,
      serviceType: KIND,
      description: definition,
      provider: { '@id': ORGANIZATION },
      areaServed: 'Worldwide',
      offers: {
        '@type': 'Offer',
        url: `${ORIGIN}/portal#/new`,
        priceCurrency: 'USD',
        price: HOURLY_USD,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: HOURLY_USD,
          priceCurrency: 'USD',
          unitText: 'hour',
        },
        availability: 'https://schema.org/InStock',
      },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}
