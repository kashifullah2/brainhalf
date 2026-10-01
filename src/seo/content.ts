import { GROWTH_PAGES } from './growth-pages';

export const SITE_URL = 'https://brainhalf.com';
export const SOCIAL_IMAGE = `${SITE_URL}/images/brainhalf-social.png`;
export const HOME_TITLE = 'AI App Builder for Small Business — BrainHalf';
export const HOME_DESCRIPTION = 'Build AI-powered inventory tools, booking apps, CRMs and customer portals with BrainHalf. Describe your workflow, test your app and publish with managed hosting. Start free.';
// Editorial dates reflect meaningful content, public UI, or structured-data changes.
// Keep these stable on rebuilds; update only the pages affected by a real change.
export const HOME_MODIFIED = '2026-09-29';
export const HOME_FAQS = [
  { id: 'what-is-brainhalf', question: 'What is BrainHalf?', answer: 'BrainHalf turns a plain-words description into a working app for your business — like a stock tracker or booking app. You describe it, try it, and share it with your customers. No coding needed.' },
  { id: 'free-access', question: 'Is BrainHalf free to use?', answer: 'Yes. Building and refining apps is free. Project and usage limits still apply. Services you connect yourself, like a custom website name or email provider, may have their own costs.' },
  { id: 'coding-experience', question: 'Do I need to know how to code?', answer: 'No. Describe what you want in plain words, the same way you would explain it to a person, and ask for changes the same way.' },
  { id: 'app-types', question: 'What can I build with BrainHalf?', answer: 'Start with an inventory tool, booking app, simple CRM, task manager or customer portal. Describe what information the app keeps and what people can do with it, then try those steps before sharing it.' },
  { id: 'code-export', question: 'Can I take my work with me?', answer: 'Yes. You can download your project’s files and continue working in your own tools. Your saved information stays separate and needs its own setup on another host.' },
  { id: 'preview-and-hosting', question: 'How do I try my app and share it?', answer: 'While you build, you can try your app right away. When you are happy with it, one click puts it on the web with its own address.' },
] as const;
export const ACCOUNT_PAGES: Record<string, string> = {
  '/forgot-password': 'Forgot your password?',
  '/reset-password': 'Reset your password',
  '/verify-email': 'Verify your email',
  '/resend-verification': 'Send a new verification email',
};

export interface ContentSection {
  id: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  example?: string;
  references?: { label: string; url: string }[];
  figure?: { src: string; alt: string; width: number; height: number; caption: string };
}
export interface PublicPage {
  path: string;
  title: string;
  description: string;
  heading: string;
  category: string;
  summary: string;
  dateModified: string;
  sections: ContentSection[];
  related: string[];
}

export const PUBLIC_PAGES: PublicPage[] = [
  ...GROWTH_PAGES,
  {
    dateModified: '2026-09-24',
    path: '/guides/full-stack-apps', title: 'Full-Stack Apps with BrainHalf: Databases, Sign-In and Email',
    description: 'Learn how to publish BrainHalf apps with a frontend, Workers backend, isolated database, sign-in, email and verification, within account usage limits.',
    heading: 'Build the interface. Test the whole application.', category: 'Full-stack guide',
    summary: 'BrainHalf can generate and publish frontend and backend source. Every signed-in user can host supported Workers apps with isolated Cloudflare D1 databases and managed authentication and email, within existing project and usage limits.',
    sections: [
      { id: 'choose-runtime', title: 'What does a full-stack app need?', paragraphs: ['The browser preview lets you inspect the frontend at desktop, tablet and mobile sizes. Managed Workers projects can create a development release with real API routes and an isolated D1 database. Existing Node projects support container builds and temporary development previews.', 'Publish builds a saved version, runs its tests, verifies the frontend and backend using disposable test data, then checks the production deployment before making it public. Existing Node backends must be prepared for Workers hosting first. Configure any services your app requires before publishing.'] },
      { id: 'test-accounts', title: 'Connect sign-in and email', paragraphs: ['Managed projects can use Google sign-in, email/password accounts, verification, password reset and magic links. The generated app uses the authentication methods enabled by its managed runtime. Development contact messages appear in the test inbox.', 'Production email requires a verified BrainHalf owner email and configured sending service. Google consent and actual inbox delivery require real provider testing. Custom credentials are encrypted and scoped to the project and environment.'] },
      { id: 'verify-recover', title: 'Verify behavior and keep a recovery path', paragraphs: ['Publish runs verification against the saved source revision automatically. Checks can exercise API routes, database writes, user permissions and browser interactions. Failed checks prevent the new release from replacing the current live version. Later edits stay in your workspace until you publish again.', 'Use source checkpoints before experimenting with code. Database recovery points are separate: restoring source does not restore records. Request monitoring helps inspect server errors without recording request bodies or credentials.'], references: [{ label: 'Cloudflare: D1 database recovery with Time Travel', url: 'https://developers.cloudflare.com/d1/reference/time-travel/' }] },
      { id: 'export', title: 'Download source with your own configuration', paragraphs: ['ZIP and GitHub exports omit private environment files and provide blank configuration examples. Keep private keys on the server; VITE_ and NEXT_PUBLIC_ variables are visible to browsers. New GitHub repositories default to private, and sync refuses to overwrite newer branch commits.', 'BrainHalf service bindings and hosted data are separate from the downloaded source. Standalone Workers deployment requires your own database resources and authentication, email and storage adapters. Follow BRAINHALF_EXPORT.md in the download; entering provider keys alone does not recreate the hosted services.'] },
    ],
    related: ['/use-cases/ai-inventory-app-builder', '/guides/ai-appointment-app-example', '/free-ai-app-builder'],
  },
  {
    dateModified: '2026-09-23',
    path: '/contact', title: 'Contact BrainHalf — Support & Feedback',
    description: 'Contact BrainHalf about your account, app-building questions, product feedback, or a problem with the platform.',
    heading: 'Let’s make building better.', category: 'Contact',
    summary: 'Need a hand with your account or have something to share? Send us a message.',
    sections: [
      { id: 'help', title: 'A little context helps', paragraphs: ['Tell us what you were trying to do and what happened. If you saw an error, include its text and the time it occurred.'] },
      { id: 'account-help', title: 'Help with your account', paragraphs: ['Use “Forgot password” on the sign-in form to recover access. If your verification link has expired, request a new verification email. Google accounts continue signing in through Google.'] },
    ], related: ['/about', '/privacy', '/guides/build-an-app-with-ai'],
  },
  {
    dateModified: '2026-09-24',
    path: '/guides/build-an-app-with-ai',
    title: 'How to Build an App with AI and Publish It | BrainHalf',
    description: 'Build an app with AI in BrainHalf: write a prompt, test the preview, add saved data when needed, and publish a supported app with managed hosting.',
    heading: 'How to build an app with AI',
    category: 'Practical guide',
    summary: 'An AI app builder can turn a written brief into a starting version of a web app. The best results come from a clear goal, small changes, and testing the work as you go.',
    sections: [
      { id: 'define-the-job', title: 'Start with one person and one job', paragraphs: ['Choose who the app is for and the task it should help them finish. “A tool for freelance designers to track client projects” gives the builder more direction than “make a business app.” Start with the smallest useful version: one main workflow and the pages it actually needs.', 'Write down the information the app stores, what a person can change, and what success looks like. A project tracker might need a project name, client, due date, and status. Its first useful workflow is creating a project and moving it through those statuses.'] },
      { id: 'write-a-prompt', title: 'What should an AI app prompt include?', paragraphs: ['Include the audience, main pages, key actions, and visual preferences. State whether the first version may use clearly labeled sample data. If the app needs accounts or persistent storage, say that explicitly; a screen that looks like a login form is not evidence that authentication works.'], example: 'Build a project tracker for freelance designers. Include a projects dashboard, a project detail page, and a form to add a project. Each project has a client, deadline, budget, and status. Let me edit and filter projects. Use a clean, responsive layout with blue accents. Label any sample data clearly, and explain what is needed for persistent storage.' },
      { id: 'test-the-preview', title: 'Try the app, including the awkward cases', paragraphs: ['BrainHalf places the conversation alongside a browser preview. Try the main journey from start to finish, then check empty lists, long text, missing fields, and small screens. Ask what happens after a page reload and when a request fails.', 'A browser preview helps you evaluate the frontend. It does not prove that generated servers, database migrations, payment providers, or email services are running. Test those separately in an environment configured for the app.'], items: ['Create an item, edit it, and confirm the change appears in the right place.', 'Submit an empty form and check that the error explains how to fix it.', 'Use a narrow mobile viewport and check navigation and form controls.', 'Reload the app and confirm the intended persistence behavior.'] },
      { id: 'refine-in-steps', title: 'Request one focused change at a time', paragraphs: ['Describe the current behavior and the result you want. “Keep the project form open when validation fails and show an error below the deadline” is easier to verify than “fix the form.” Review each change before adding another feature.', 'Use the Code view to inspect the generated files when you need to understand an implementation. Export the source so you can continue in your own development tools or involve a developer for a deeper review.'] },
      { id: 'prepare-to-launch', title: 'Publish the tested version and check its public URL', paragraphs: ['In BrainHalf, use Publish after you have tested the main workflow. Supported static apps can go live directly; managed Workers apps can include a backend, an isolated production database and configured sign-in services. Publish builds and checks a saved source version before activating it. You do not need to export code to use managed publishing.', 'Open the public URL and test it again. For an app with saved records, check persistence and account permissions. For email, check actual delivery to a controlled recipient. If publishing fails, read the message and use Fix publishing problem when available, then review the repair before publishing again. Edits in your workspace do not replace the live app until you publish.'], references: [{ label: 'OWASP: Web Security Testing Guide', url: 'https://owasp.org/www-project-web-security-testing-guide/' }] },
    ],
    related: ['/guides/ai-appointment-app-example', '/use-cases/ai-inventory-app-builder', '/guides/full-stack-apps'],
  },
  {
    dateModified: '2026-09-28',
    path: '/use-cases/ai-dashboard-builder',
    title: 'AI Dashboard Builder: Build and Refine Custom Dashboards | BrainHalf',
    description: 'Build a custom dashboard with AI. Define metrics, tables and filters, connect a managed database or API, test permissions, and publish with BrainHalf.',
    heading: 'An AI dashboard builder for the decisions you make',
    category: 'AI dashboard builder',
    summary: 'Use BrainHalf to build a dashboard from a written brief. Define the decisions it supports, test its filters in Preview, and ask for a managed database or an existing API when it needs real records.',
    sections: [
      { id: 'choose-metrics', title: 'Start with questions, then choose the metrics', paragraphs: ['A useful dashboard answers a small set of questions. A subscription business might ask whether revenue is growing and which customers are leaving. An operations team might need to know which orders are late and who should act next.', 'Define each metric before asking for a chart: its source, time range, calculation, currency or unit, and refresh frequency. “Monthly recurring revenue” and “payments collected this month” can be very different numbers. The interface should make that distinction clear.'] },
      { id: 'dashboard-prompt', title: 'A prompt you can adapt', paragraphs: ['Specify the records and actions as well as the headline numbers. This example creates a frontend starting point; the illustrative values still need to be replaced with a verified data source.'], example: 'Build a responsive SaaS dashboard for a subscription business. Show MRR, active customers, and cancellations, with a date-range selector. Add a monthly revenue chart and a searchable customer table with status filters. Include loading, empty, and error states. Use clearly labeled sample data for the first preview. Keep the metric calculations separate from the presentation so I can connect a real API later.' },
      { id: 'useful-layout', title: 'Give charts and tables different jobs', paragraphs: ['Use charts to show a trend or comparison and tables to inspect individual records. Keep labels visible, show units, and make date ranges explicit. Do not rely on color alone to communicate whether a metric increased or decreased.', 'On a phone, arrange summary metrics in a readable stack and decide which table columns matter most. Test long customer names, zero values, missing data, and unusually large numbers. A layout that works with six sample records may behave differently with real data.'], references: [{ label: 'W3C: WCAG guidance on use of color', url: 'https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html' }] },
      { id: 'connect-real-data', title: 'How do I connect a dashboard to real data?', paragraphs: ['You can ask the builder for an API integration and inspect the generated source in Code. Credentials belong on the server. A database or external service needs its own configuration and access rules; a frontend preview alone does not provide them.', 'Describe the saved records and sign-in rules in chat. BrainHalf can prepare a supported managed Workers backend and an isolated database. Check that records survive reloads and that a separate account cannot read them. Keep an external data source’s credentials on the server and verify its permissions separately.'] },
      { id: 'dashboard-checklist', title: 'Check the numbers as carefully as the design', paragraphs: ['Compare every displayed metric with a small, known dataset. Test the same date filter across cards, charts, and tables, including boundaries such as the first day of a month.'], items: ['Label sample data and remove it before connecting a live workflow.', 'Check how timestamps and time zones affect reporting periods.', 'Show a helpful empty state when no records match the filters.', 'Test loading failures, retry actions, and access restrictions.', 'Verify the published app against its actual API and production database.'] },
    ],
    related: ['/use-cases/customer-dashboard-builder', '/use-cases/ai-inventory-app-builder', '/guides/full-stack-apps'],
  },
  {
    dateModified: '2026-09-24',
    path: '/use-cases/ai-website-builder',
    title: 'AI Website Builder for Portfolios & Business Sites | BrainHalf',
    description: 'Build a portfolio or business website with AI. Describe your pages, refine the mobile design, test your forms, and publish a supported site through BrainHalf.',
    heading: 'An AI website builder with editable source code',
    category: 'AI website builder',
    summary: 'Describe the website you need, review its layout in the browser, and refine the details by conversation. BrainHalf gives you access to the source so you can keep building beyond the preview.',
    sections: [
      { id: 'plan-the-pages', title: 'Choose a clear job for every page', paragraphs: ['A portfolio should help a visitor understand your work and decide whether to contact you. A small business site should explain what you offer, who you serve, and how to take the next step. Start with those questions rather than a long list of visual effects.', 'Outline the pages and their real content. A photographer might need a homepage, project gallery, about page, and contact page. Prepare your own images, project descriptions, and contact details so the site has something specific to say.'] },
      { id: 'website-prompt', title: 'Describe the content and visual direction together', paragraphs: ['The builder works best with a brief that names the audience and the action you want visitors to take. Include mobile behavior and accessibility expectations. Use placeholder copy only where you plan to replace it.'], example: 'Build a portfolio website for an architectural photographer. Include a homepage with a selected-project gallery, individual project details, an about section, and a contact form. Use generous spacing, dark gray type, and large images. Make the gallery responsive and give every form field a visible label. Use clearly marked image placeholders and do not invent clients, awards, or testimonials.' },
      { id: 'review-mobile', title: 'Review the mobile experience early', paragraphs: ['Try the site at a narrow width before polishing every desktop detail. Navigation should be usable, body copy should be readable without zooming, and buttons should be easy to tap. Check that images keep their intended crop and that headings do not push important actions off-screen.', 'Use real content while you test. A name, headline, or address that is longer than the placeholder can expose layout problems. Keyboard navigation and visible focus indicators matter for visitors who do not use a mouse.'] },
      { id: 'working-forms', title: 'Connect forms and business services deliberately', paragraphs: ['A contact form needs somewhere to send its submissions. A storefront needs a payment integration, order handling, and appropriate account access. Ask the builder to distinguish between a visual frontend and a working service integration.', 'Configure the required backend and provider settings outside the browser source. Test success, validation, and failure messages. Never treat a simulated confirmation in a preview as proof that an email was delivered or a payment was processed.'] },
      { id: 'publish-website', title: 'How do I prepare an AI-built website for search?', paragraphs: ['Publish a supported site through BrainHalf, or export its source if you prefer your own host. Ask for descriptive page titles, useful copy, canonical URLs, crawlable HTML, a sitemap and real 404 responses. Check those on the published site; publishing a generated app does not guarantee that its search setup is complete.', 'Compress photographs, include appropriate image descriptions, and reserve their dimensions to reduce layout shifts. After publishing, test the live URL, check forms, and use Google Search Console to inspect indexing. Search visibility depends on the published site’s content and reputation as well as its technical setup.'], references: [{ label: 'Google: Search Engine Optimization Starter Guide', url: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide' }, { label: 'Google: JavaScript SEO basics', url: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics' }] },
    ],
    related: ['/guides/ai-appointment-app-example', '/guides/build-an-app-with-ai', '/free-ai-app-builder'],
  },
  {
    dateModified: '2026-09-24',
    path: '/free-ai-app-builder',
    title: 'Free AI App Builder: Features and Limits | BrainHalf',
    description: 'See what BrainHalf’s free AI app builder includes: chat, preview, source export and managed publishing for supported apps, with project and usage limits.',
    heading: 'Build your next app with a free AI app builder',
    category: 'Free app building',
    summary: 'BrainHalf is free to use for building and refining apps. Signed-in users can publish supported apps within project and usage limits. Keep the source code if you want to continue in your own tools.',
    sections: [
      { id: 'what-is-included', title: 'What does the free AI app builder include?', paragraphs: ['Create an account, describe the app you want, and work with the AI builder in chat. The workspace brings your conversation, frontend preview, and project files together. You can return to saved projects, ask for focused changes, and export the source.', 'You do not need to write code to describe your first version. You can also inspect and edit the generated files in Code when you want more control. Free access does not mean unlimited capacity: project, request, and model limits still apply.'] },
      { id: 'start-with-a-prompt', title: 'Start with a small, useful app', paragraphs: ['Choose one task the app should help someone finish. A habit tracker, project board, portfolio, or dashboard makes a useful first experiment. Name the main pages, the information they show, and the actions a visitor can take.', 'Try this prompt, then change the audience and features to match your own idea. Be explicit about whether the first version uses sample data or needs persistent storage.'], example: 'Build a weekly habit tracker. Let me add a habit, mark each day complete, and see weekly progress. Include a clear empty state and a mobile-friendly layout. Explain how progress is stored and what happens after a page reload.' },
      { id: 'preview-and-refine', title: 'Test the first version and ask for changes', paragraphs: ['Use the live preview to try the frontend, not just look at it. Add a record, edit it, change a filter, and check the layout on a phone. Test long text and empty inputs as well as the happy path.', 'Request one change at a time so you can tell whether it worked. Instead of “make it better,” explain the behavior you want: “show a helpful message when no habits exist, with an Add habit button.” Review the result before adding another feature.'] },
      { id: 'export-your-code', title: 'Keep the source and continue in your own tools', paragraphs: ['Use the source export to download your project and inspect it outside the browser workspace. You can continue development in a local editor or involve a developer to review the implementation. Check the generated dependencies and the run instructions before using the project in production.', 'You can publish supported apps inside BrainHalf without exporting. If you choose another host, set up the exported app’s database and service configuration there. Hosted records are separate from source code, so check the migration and access rules before moving a live app.'] },
      { id: 'external-costs', title: 'Free building and external services are separate', paragraphs: ['BrainHalf is free to use for the building workflow. A custom domain, hosting provider, database, email service, payment processor, or API you choose for your finished app may have separate costs and limits. Check each provider before connecting a live project.', 'Keep service credentials on the server, use controlled accounts when testing, and confirm what happens when a provider request fails. Begin with a small version you can verify, then expand it as your needs become clearer.'] },
    ],
    related: ['/guides/build-an-app-with-ai', '/use-cases/ai-dashboard-builder', '/use-cases/ai-website-builder'],
  },
  {
    dateModified: '2026-10-01',
    path: '/pricing', title: 'BrainHalf Pricing — Free to Start',
    description: 'BrainHalf is free to start: describe your app in plain words and build it with AI. Usage limits apply; no paid tiers yet.',
    heading: 'Free to start.', category: 'Pricing',
    summary: 'Building and refining apps with BrainHalf is free. Fair usage limits keep the service running for everyone.',
    sections: [
      { id: 'free', title: 'Start free', paragraphs: ['BrainHalf is free to start — describe your app in plain words, build it with AI, preview it, and refine it, all without paying anything.', 'There are no paid tiers at this time. If that changes, this page will list every plan and price before you are asked to pay.'] },
      { id: 'limits', title: 'Fair usage limits', paragraphs: ['To keep the service fast for everyone, accounts have limits: up to 50 live projects per account and up to 10 hosted app spaces for published apps. Daily AI usage allowances also apply.', 'If you reach a limit, BrainHalf tells you plainly what is full and what you can remove or wait for — nothing is charged silently.'] },
      { id: 'own-costs', title: 'Services you connect yourself', paragraphs: ['Some optional extras have their own costs paid directly to their providers: a custom website name (domain registrar), or an email sending service you connect. BrainHalf never adds a markup to these.'] },
    ], related: ['/faq', '/about', '/guides/build-an-app-with-ai'],
  },
  {
    dateModified: '2026-10-01',
    path: '/faq', title: 'BrainHalf FAQ — Common Questions',
    description: 'Answers to common BrainHalf questions: what it is, whether it is free, coding experience needed, what you can build, and how to share your app.',
    heading: 'Questions, answered.', category: 'FAQ',
    summary: 'Straight answers about BrainHalf: cost, coding, what you can build, and how sharing works.',
    sections: [
      { id: 'what-is', title: 'What is BrainHalf?', paragraphs: ['BrainHalf turns a plain-words description into a working app for your business — like a stock tracker or booking app. You describe it, try it, and share it with your customers. No coding needed.'] },
      { id: 'cost', title: 'Is BrainHalf free to use?', paragraphs: ['Yes. Building and refining apps is free. Project and usage limits still apply — see the pricing page for details. Services you connect yourself, like a custom website name or email provider, may have their own costs.'] },
      { id: 'coding', title: 'Do I need to know how to code?', paragraphs: ['No. Describe what you want in plain words, the same way you would explain it to a person, and ask for changes the same way.'] },
      { id: 'build-what', title: 'What can I build with BrainHalf?', paragraphs: ['Start with an inventory tool, booking app, simple CRM, task manager or customer portal. Describe what information the app keeps and what people can do with it, then try those steps before sharing it.'] },
      { id: 'take-with', title: 'Can I take my work with me?', paragraphs: ['Yes. You can download your project’s files and continue working in your own tools. Your saved information stays separate and needs its own setup on another host.'] },
      { id: 'share', title: 'How do I try my app and share it?', paragraphs: ['While you build, you can try your app right away. When you are happy with it, one click puts it on the web with its own address.'] },
    ], related: ['/pricing', '/about', '/guides/build-an-app-with-ai'],
  },
  {
    dateModified: '2026-09-24',
    path: '/about', title: 'About BrainHalf — An AI Workspace for Building Web Apps',
    description: 'Learn what BrainHalf does: build web apps by conversation, review the frontend, inspect generated files, and export your project’s source code.',
    heading: 'An AI building partner, with your work in view', category: 'About BrainHalf',
    summary: 'BrainHalf is a browser-based workspace for turning a written idea into a web app you can inspect, try, and refine.',
    sections: [
      { id: 'who-it-is-for', title: 'For people with a specific problem to solve', paragraphs: ['Use BrainHalf to explore a side project, a dashboard, a website, or a tool for your own workflow. Describe the people who will use it, the actions they need, and the information they work with. You can start in plain language and involve a developer when the project needs deeper technical work.'] },
      { id: 'how-it-works', title: 'Conversation, preview, and source in one place', paragraphs: ['Start an app from the homepage prompt. In the workspace, ask for changes in chat, review the frontend in Preview, and inspect or edit generated files in Code. You can export the source to continue in your preferred tools.', 'Projects and conversations are associated with your account. You can return to recent projects, rename them, and remove projects you no longer need.'] },
      { id: 'what-to-expect', title: 'Know what the preview tells you', paragraphs: ['Test generated apps before launch. Preview lets you try the interface; supported managed apps can also run with a backend and isolated database. Publish builds and checks a saved version before activating the public URL. Verify permissions, saved records and any external integrations on that version.', 'For a step-by-step starting point, read the app-building guide. It covers writing a useful prompt, testing a first version, and preparing the project for a launch.'] },
    ], related: ['/guides/build-an-app-with-ai', '/privacy', '/terms'],
  },
  {
    dateModified: '2026-09-29',
    path: '/privacy', title: 'Privacy Overview — Accounts, Projects & AI | BrainHalf',
    description: 'Understand the information BrainHalf uses for accounts, project storage, AI requests, previews, and Google sign-in, and how project removal works.',
    heading: 'How information is used in BrainHalf', category: 'Privacy overview',
    summary: 'This overview describes the platform’s implemented data flows. Read it before putting personal, confidential, or customer information into a project.',
    sections: [
      { id: 'account', title: 'Accounts and sign-in', paragraphs: ['BrainHalf uses account information to sign you in and associate projects with your account. The email/password flow hashes passwords on the server. New email accounts verify ownership before signing in. Resend delivers verification, password-reset, and contact emails; it receives the recipient address and message content. Reset links expire after 30 minutes and verification links after 24 hours. Resetting a password revokes existing sessions. The Google flow requests basic profile and email information to identify your account; it does not request access to your Gmail messages or Drive files.', 'The browser stores session information so the app can make authenticated requests. Sign-out revokes the session and removes the active browser session. Theme preferences and local project caches also use browser storage.'] },
      { id: 'analytics', title: 'Website analytics', paragraphs: ['BrainHalf uses Google Analytics on public pages to understand visits and improve the website. Google Analytics may use cookies and process browser, device, and usage information.', 'The integration sends public page addresses without query strings or fragments and includes only the referring website’s origin. It does not start for signed-in sessions or project and sign-in callback URLs, and collection is disabled when a visitor signs in. Advertising personalization and Google signals are disabled in the site configuration.'] },
      { id: 'advertising', title: 'Advertising', paragraphs: ['BrainHalf shows ads from Google AdSense on public pages to support the free tier. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites.', 'Google’s use of advertising cookies enables it and its partners to serve ads to you based on your visit to this site and other sites on the internet. You can opt out of personalized advertising in Google Ads Settings (adssettings.google.com) and opt out of other third-party vendors’ cookies at aboutads.info/choices.', 'Ads do not appear inside signed-in workspaces, project previews, or published apps you build. Advertising cookies are separate from the session cookies required to sign in.'] },
      { id: 'product-outcomes', title: 'App reliability measurements', paragraphs: ['BrainHalf records first-party generation, app-verification and publishing outcomes with account and project IDs, revision hashes and timestamps. These records help measure verified apps per generation, successful publishing and time to a first live app. They do not include prompts, source code, passwords or customer records.', 'We also record the first observed workspace activity and whether the account is active again between days 7 and 14. Outcome records are separate from Google Analytics and remain after project deletion for reliability reporting. Account reports are private; aggregate reports require operator access.'] },
      { id: 'ai-requests', title: 'Prompts, code, and AI providers', paragraphs: ['The building workflow sends your prompts and relevant project context to the configured AI provider for the model you select. Provider availability and processing depend on the platform configuration and the provider’s own terms.', 'Do not include passwords, private API keys, or information you are not authorized to share in a prompt. Generated apps should read secrets from their own server environment rather than embedding them in frontend files.'] },
      { id: 'project-storage', title: 'Project storage and removal', paragraphs: ['The platform uses Cloudflare infrastructure for accounts and project services, with browser caches to support the workspace. Project files may also be backed up to object storage.', 'Deleting a project immediately revokes access and removes local files and conversation history after the request is accepted. An automatically retried cleanup job removes app deployments, databases, server source, attachments, stored project credentials, and backups. The dashboard shows pending and completed cleanup. Minimal project-ID ownership tombstones remain to prevent another account from reclaiming a deleted project; cleanup status is retained for 30 days.'] },
      { id: 'previews', title: 'Previews and external services', paragraphs: ['Generated previews run in a restricted frame. A generated app may load images, packages, or external services specified in its source, and those services can receive requests from your browser. Inspect the app and its integrations before using sensitive information.', 'Private project URLs are excluded from search indexing by the platform’s crawl controls. Search controls complement authentication; they do not replace it.'] },
    ], related: ['/about', '/terms', '/guides/build-an-app-with-ai'],
  },
  {
    dateModified: '2026-09-23',
    path: '/terms', title: 'Product Usage Guidelines & Limitations | BrainHalf',
    description: 'Understand how to use BrainHalf: account access, generated-code review, external services, source export, and the limits of browser previews.',
    heading: 'Using BrainHalf and reviewing what you build', category: 'Usage guidelines',
    summary: 'These product guidelines explain practical responsibilities and limitations when working with generated apps.',
    sections: [
      { id: 'access', title: 'Use information and services you are authorized to access', paragraphs: ['Use your own account and only provide content, credentials, or data that you have permission to use. Respect the access restrictions of the platform, other users’ projects, and the external services connected to your app.'] },
      { id: 'review', title: 'Review generated code and content', paragraphs: ['AI output can be incomplete or incorrect. Review the source, verify factual content, and test the app’s behavior before sharing it with customers. Check dependencies, licenses, accessibility, and security requirements that apply to your project.', 'A generated claim, testimonial, or sample record is not evidence. Replace placeholders with information you can verify and label demonstration data clearly.'] },
      { id: 'services', title: 'Configure and test the services your app needs', paragraphs: ['A working frontend preview does not establish that a backend, database, email sender, or payment integration is ready. Those services need their own configuration, testing, and operational support.', 'External providers may impose their own costs, limits, and conditions. Usage availability depends on the platform configuration and the chosen model. Source export lets you continue the project in your own environment.'] },
      { id: 'publication', title: 'Check access before publishing', paragraphs: ['Decide who should be able to open a project and check its contents before enabling public access. Keep private data and credentials out of the published frontend. Publish deploys supported apps with their frontend, Workers backend and production database after verification. Existing Node backends require conversion first. Taking the app offline disables its public routes while keeping its database and saved releases. Older public preview links have a separate privacy control.', 'Read the privacy overview for the implemented account, prompt, and project-storage flows.'] },
    ], related: ['/privacy', '/about', '/guides/build-an-app-with-ai'],
  },
  {
    dateModified: '2026-09-29',
    path: '/gallery', title: 'App Gallery — Explore and Remix Apps Built with BrainHalf',
    description: 'Browse apps published by BrainHalf builders. Open them live, then remix any app into your own workspace and change it with a prompt.',
    heading: 'Apps built with BrainHalf', category: 'Gallery',
    summary: 'Explore published apps. Open any of them live, or remix one into your own workspace and change it with a prompt.',
    sections: [
      { id: 'remix', title: 'Remix any app into your own workspace', paragraphs: ['Every app in the gallery can be opened live. When you remix one, BrainHalf copies its public source files into a new project in your account — the copy is yours to change, rename, and publish. Private environment files and secrets never leave the original project.', 'Owners choose to list their app after publishing it. Removing a listing stops new remixes; existing copies stay with their owners.'] },
    ],
    related: ['/guides/build-an-app-with-ai', '/free-ai-app-builder', '/about'],
  },
];

export function findPublicPage(path: string): PublicPage | undefined {
  return PUBLIC_PAGES.find(page => page.path === path);
}

export function contentModified(path: string): string | undefined {
  return path === '/' ? HOME_MODIFIED : findPublicPage(path)?.dateModified;
}

export function formatContentDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
