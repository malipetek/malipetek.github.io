globalThis.process ??= {}; globalThis.process.env ??= {};
const JOBS = [
  {
    years: '2017–2019',
    span: [2017, 2019.9],
    name: 'Customily',
    where: 'UY',
    blurb: 'SaaS product-personalization. Service integrations and JS SDK work for two years.',
    tags: ['JS SDK', 'Fabric.js', 'Canvas API', 'jQuery', 'Shopify App', 'Firebase', 'Express', 'Vuetify', 'MSSQL', 'PHP', 'WooCommerce', 'Vue 2'],
  },
  {
    years: '2020',
    span: [2020, 2020.9],
    name: 'TRUTH NYC',
    where: 'US',
    blurb: 'World-class design-tech agency. Magento front end, Lightspeed HQ↔eCom integration, checkout mods, theme rewrite.',
    tags: ['Magento', 'RequireJS', 'Knockout.js', 'Lightspeed', 'Firebase Functions', 'jQuery', 'Twig', 'Tailwind', 'Stripe'],
    link: '/experience/truth',
  },
  {
    years: '2021–2024',
    span: [2021, 2024.9],
    name: 'TRUTH NYC',
    where: 'US',
    blurb: 'Shopify Plus client migration, Dawn-based theme build, custom app for B2B pricing at checkout.',
    tags: ['Shopify Plus', 'Data normalization', 'Dawn', 'B2B pricing', 'Flow', 'Koa.js', 'Next.js', 'Postgres'],
    link: '/experience/truth',
  },
  {
    years: '2022',
    span: [2022, 2022.9],
    name: 'PAX Digital',
    where: 'TR',
    blurb: 'Public Shopify app, solo built and shipped.',
    tags: ['Express', 'Next.js', 'WebSockets', 'Linux server'],
    link: 'https://paxdigital.net/',
  },
  {
    years: '2022–2023',
    span: [2022, 2023.9],
    name: 'Bemeir LLC',
    where: 'US',
    blurb: 'High-tier e-commerce agency. Plus-client sections, checkout.liquid work, SEO, A/B testing, theme optimization.',
    tags: ['Shopify Plus', 'checkout.liquid', 'SEO', 'A/B testing', 'srcset', 'Theme optimization'],
    link: 'https://bemeir.com/',
  },
];

export { JOBS as J };
