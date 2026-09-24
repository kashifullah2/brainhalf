import { ACCOUNT_PAGES, HOME_DESCRIPTION, HOME_FAQS, HOME_TITLE, PUBLIC_PAGES, SITE_URL, SOCIAL_IMAGE, contentModified } from './content';

export function pageMetadata(path: string) {
  const page = PUBLIC_PAGES.find(item => item.path === path);
  const exists = path === '/' || Boolean(page);
  return {
    title: path === '/' ? HOME_TITLE : page?.title || (ACCOUNT_PAGES[path] ? `${ACCOUNT_PAGES[path]} | BrainHalf` : 'Page Not Found | BrainHalf'),
    description: path === '/' ? HOME_DESCRIPTION : page?.description || (ACCOUNT_PAGES[path] ? 'Manage your BrainHalf account: verify your email or securely recover access to your account.' : 'This page could not be found. Return to BrainHalf to build an app or explore the app-building guide.'),
    canonical: exists ? `${SITE_URL}${path}` : undefined,
    robots: exists ? 'index, follow, max-image-preview:large' : 'noindex, follow',
    type: page?.path.startsWith('/guides/') ? 'article' : 'website',
    dateModified: contentModified(path),
  };
}

export function structuredData(path: string) {
  const page = PUBLIC_PAGES.find(item => item.path === path);
  const meta = pageMetadata(path);
  if (!meta.canonical) return null;
  const organization = { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: 'BrainHalf', url: SITE_URL, logo: { '@type': 'ImageObject', url: `${SITE_URL}/android-chrome-512x512.png`, width: 512, height: 512 } };
  const website = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'BrainHalf', publisher: { '@id': organization['@id'] }, inLanguage: 'en' };
  const webpage = { '@type': meta.type === 'article' ? 'Article' : 'WebPage', '@id': `${meta.canonical}#page`, url: meta.canonical, name: page?.heading || 'BrainHalf AI App Builder', headline: page?.heading || 'BrainHalf AI App Builder', description: meta.description, inLanguage: 'en', isPartOf: { '@id': website['@id'] }, publisher: { '@id': organization['@id'] }, image: SOCIAL_IMAGE, ...(meta.type === 'article' ? { author: { '@id': organization['@id'] } } : {}) };
  const graph: object[] = [organization, website, { ...webpage, dateModified: meta.dateModified, ...(path === '/' ? { hasPart: { '@id': `${SITE_URL}/#questions` } } : {}), ...(page?.sections.some(section => section.references?.length) ? { citation: page.sections.flatMap(section => section.references?.map(reference => reference.url) || []) } : {}) }];
  if (path === '/') graph.push({ '@type': 'FAQPage', '@id': `${SITE_URL}/#questions`, url: `${SITE_URL}/#questions`, isPartOf: { '@id': webpage['@id'] }, mainEntity: HOME_FAQS.map(faq => ({ '@type': 'Question', '@id': `${SITE_URL}/#${faq.id}`, name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } })) });
  if (path === '/') graph.push({ '@type': 'SoftwareApplication', '@id': `${SITE_URL}/#app`, name: 'BrainHalf', url: `${SITE_URL}/`, applicationCategory: 'DeveloperApplication', operatingSystem: 'Web browser', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', url: `${SITE_URL}/free-ai-app-builder` }, description: HOME_DESCRIPTION, featureList: ['Build web apps by conversation', 'Interactive frontend preview', 'Inspect and edit project source', 'Export project source code'], publisher: { '@id': organization['@id'] } });
  if (page) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` }, { '@type': 'ListItem', position: 2, name: page.heading, item: meta.canonical }] });
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function isPrivateSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  return ['project', 'google', 'token', '_uid'].some(key => params.has(key));
}
