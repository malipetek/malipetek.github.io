export type Field = { name: string; label: string; secret: boolean; multiline?: boolean; placeholder?: string; optional?: boolean };
export type Integration = { id: string; label: string; vendor: string; fields: Field[]; steps: string[]; docs: string; scope: string };
type IntegrationRef = { id: string; optional: boolean };
export type Solution = { id: string; label: string; summary: string; requires: string[]; integrations: IntegrationRef[]; deliverables: string[]; questions: string[] };
export type Verifier = (id: string, fields: Record<string, string>, fetchImpl?: typeof fetch) => Promise<{ ok: boolean; detail?: string; error?: string }>;

export const SOLUTION_CATALOG: Solution[] = [
  {
    id: 'web', label: 'Website', summary: 'Design, build, or improve a website that works on phones and desktops.',
    requires: [], integrations: [],
    deliverables: ['Responsive website', 'Review link', 'Launch and editing notes'],
    questions: ['Who will visit the site?', 'What should visitors do before they leave?', 'What pages or information must be ready at launch?', 'Who should be able to change the content?'],
  },
  {
    id: 'shopify', label: 'Shopify store, theme, or app', summary: 'Build or improve a Shopify store, its look, or the tools you use to run it.',
    requires: [], integrations: [{ id: 'shopify', optional: false }],
    deliverables: ['Store or app changes', 'Test store preview', 'Launch and handover notes'],
    questions: ['What do you sell, and where do you ship?', 'Where do shoppers get stuck today?', 'What should be easier for the people running the store?', 'What must stay unchanged when we launch?'],
  },
  {
    id: 'mobile-ios', label: 'iOS app', summary: 'Build or improve an app for iPhone and iPad.',
    requires: ['os:macos', 'xcode'], integrations: [{ id: 'app-store-connect', optional: false }],
    deliverables: ['iOS app', 'TestFlight build', 'Handover notes'],
    questions: ['What should people be able to do the first time they open the app?', 'Should it work on iPhone, iPad, or both?', 'What should still work without internet?', 'Who should try it before launch?'],
  },
  {
    id: 'mobile-android', label: 'Android app', summary: 'Build or improve an app for Android phones and tablets.',
    requires: ['android'], integrations: [{ id: 'google-play', optional: false }],
    deliverables: ['Android app', 'Internal testing build', 'Handover notes'],
    questions: ['What should people be able to do in the app?', 'Are there specific phones or tablets it must work on?', 'Should users get reminders or updates?', 'Who should get early access?'],
  },
  {
    id: 'mobile-cross', label: 'Cross-platform app', summary: 'Build an app for iOS and Android with Expo, React Native, or Flutter.',
    requires: [], integrations: [{ id: 'expo', optional: true }, { id: 'app-store-connect', optional: true }, { id: 'google-play', optional: true }],
    deliverables: ['Shared app source', 'Test builds for both stores', 'Handover notes'],
    questions: ['What should people be able to do on both phones?', 'Is there anything that should work differently on iPhone and Android?', 'Does the app need to work away from an internet connection?', 'Do you want to launch on both stores at the same time?'],
  },
  {
    id: 'app-release', label: 'App Store and Play submissions', summary: 'Prepare an existing app for store review, testing, and release.',
    requires: ['os:macos'], integrations: [{ id: 'app-store-connect', optional: false }, { id: 'google-play', optional: false }],
    deliverables: ['Store listing and submission checklist', 'Test releases', 'Review and rollout notes'],
    questions: ['Is this the first release or an update?', 'What countries and languages should the release cover?', 'Do you already have screenshots and store descriptions?', 'Who should approve the final release?'],
  },
  {
    id: 'server', label: 'Server or container', summary: 'Set up or improve the hosting that keeps your service running.',
    requires: ['docker'], integrations: [{ id: 'hetzner', optional: true }, { id: 'digitalocean', optional: true }, { id: 'fly', optional: true }],
    deliverables: ['Repeatable service setup', 'Monitoring and recovery notes', 'Operating and cost notes'],
    questions: ['What service needs to stay online, and who uses it?', 'When would a short interruption be acceptable?', 'What information would be hardest to lose?', 'What monthly budget should we stay within?'],
  },
  {
    id: 'aws', label: 'AWS', summary: 'Set up, improve, or maintain services in your AWS account.',
    requires: [], integrations: [{ id: 'aws', optional: false }],
    deliverables: ['Agreed AWS changes', 'Access and cost notes', 'Operating and recovery notes'],
    questions: ['What would you like to change in your AWS account?', 'Which live services must keep working during the change?', 'Who should be alerted if something stops working?', 'What budget limits should we respect?'],
  },
  {
    id: 'gcp', label: 'Google Cloud', summary: 'Set up, improve, or maintain services in your Google Cloud project.',
    requires: [], integrations: [{ id: 'gcp', optional: false }],
    deliverables: ['Agreed Google Cloud changes', 'Access and cost notes', 'Operating and recovery notes'],
    questions: ['What would you like to change in Google Cloud?', 'Which people or teams use the services today?', 'Where must your information be stored?', 'What outages or costs are most important to avoid?'],
  },
  {
    id: 'ai-workspace', label: 'AI workspace', summary: 'Give your team reusable AI instructions and safe access to its everyday tools.',
    requires: [], integrations: [],
    deliverables: ['Reusable skills and workflows', 'Tool connections agreed with your team', 'Examples and handover notes'],
    questions: ['Which repeated tasks take your team the most time?', 'What tools or information should the assistant use?', 'What should the assistant never do without asking?', 'How will your team tell whether the answers are good enough?'],
  },
];

export const INTEGRATION_CATALOG: Integration[] = [
  {
    id: 'shopify', label: 'Shopify', vendor: 'Shopify',
    fields: [
      { name: 'SHOPIFY_STORE_DOMAIN', label: 'Store domain', secret: false, placeholder: 'your-store.myshopify.com' },
      { name: 'SHOPIFY_ADMIN_TOKEN', label: 'Admin API access token', secret: true, placeholder: 'shpat_…' },
      { name: 'SHOPIFY_STOREFRONT_TOKEN', label: 'Storefront access token', secret: true, optional: true },
      { name: 'SHOPIFY_COLLABORATOR_CODE', label: 'Collaborator request code', secret: true, optional: true },
    ],
    steps: ['Use the store’s permanent myshopify.com address, even if shoppers use another address.', 'Create a custom app for this store. Use Settings → Apps and sales channels → Develop apps for an existing admin-created custom app, or the Shopify Dev Dashboard for a new app.', 'Configure only the agreed Admin API scopes: read_themes/write_themes, read_products/write_products, and read_content/write_content as needed. Shopify may require approval for theme writes.', 'Install the app and provide its Admin API access token (shpat_…). If your app setup issues only short-lived tokens, ask us to arrange access before submitting it. Add a Storefront token only for Storefront API work, or a collaborator code if we need to request staff access.'],
    docs: 'https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens', scope: 'Only the store and read/write scopes needed for the agreed theme, product, or content work.',
  },
  {
    id: 'app-store-connect', label: 'App Store Connect', vendor: 'Apple',
    fields: [
      { name: 'ASC_ISSUER_ID', label: 'Issuer ID', secret: false },
      { name: 'ASC_KEY_ID', label: 'Key ID', secret: false },
      { name: 'ASC_PRIVATE_KEY', label: 'Private key (.p8)', secret: true, multiline: true, placeholder: '-----BEGIN PRIVATE KEY-----' },
      { name: 'APPLE_TEAM_ID', label: 'Apple Developer Team ID', secret: false, optional: true },
    ],
    steps: ['In App Store Connect, open Users and Access → Integrations → App Store Connect API.', 'Under Team Keys, create a key for this project with the App Manager role.', 'Copy the Issuer ID and Key ID. Download the .p8 file (Apple only offers it once) and paste its full contents, including the first and last lines.', 'If we ask for the Developer Team ID for signing, find it in Membership details in your Apple Developer account.'],
    docs: 'https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api', scope: 'App Manager can manage releases; an Apple team API key is not limited to one app.',
  },
  {
    id: 'google-play', label: 'Google Play Console', vendor: 'Google',
    fields: [
      { name: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', label: 'Service account key (JSON)', secret: true, multiline: true },
      { name: 'GOOGLE_PLAY_PACKAGE_NAME', label: 'App package name', secret: false, optional: true, placeholder: 'com.example.app' },
    ],
    steps: ['In Google Cloud, enable the Google Play Android Developer API and create a service account for this work.', 'In Play Console, open Users and permissions and invite the service account email. Give it access to the target app and permission to release to the agreed testing or production tracks.', 'Create and download a JSON key for that service account, if your organization allows it, and paste the whole file. Enter the app package name if you have it.'],
    docs: 'https://developers.google.com/android-publisher/getting_started', scope: 'Grant only the target apps and tracks needed for the release.',
  },
  {
    id: 'expo', label: 'Expo', vendor: 'Expo',
    fields: [{ name: 'EXPO_TOKEN', label: 'Access token', secret: true }],
    steps: ['In Expo, open Access tokens for the account that owns the project.', 'Create a token for builds and updates. Prefer a robot user with access to the right organization and role if available.', 'Copy the token into the form.'],
    docs: 'https://docs.expo.dev/accounts/programmatic-access/', scope: 'A token inherits its user’s permissions; choose an identity with only the access your project needs.',
  },
  {
    id: 'hetzner', label: 'Hetzner Cloud', vendor: 'Hetzner',
    fields: [{ name: 'HETZNER_API_TOKEN', label: 'Project API token', secret: true }],
    steps: ['Open the project in Hetzner Cloud Console.', 'Go to Security → API Tokens and generate a Read & Write token for this project.', 'Copy the token and keep it separate from any other Hetzner projects.'],
    docs: 'https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/', scope: 'Read and write permission within one Hetzner Cloud project.',
  },
  {
    id: 'digitalocean', label: 'DigitalOcean', vendor: 'DigitalOcean',
    fields: [{ name: 'DIGITALOCEAN_TOKEN', label: 'API access token', secret: true }],
    steps: ['Open API → Tokens in your DigitalOcean control panel.', 'Generate a personal access token with an expiration date and custom scopes for the resources we will manage.', 'Copy the token when DigitalOcean displays it.'],
    docs: 'https://docs.digitalocean.com/reference/api/create-personal-access-token/', scope: 'Limit the token to the resource types and actions needed for this work.',
  },
  {
    id: 'fly', label: 'Fly.io', vendor: 'Fly.io',
    fields: [{ name: 'FLY_API_TOKEN', label: 'Organization deploy token', secret: true }],
    steps: ['Identify the Fly.io organization that owns the app.', 'Create an organization deploy token with an expiration date (`fly tokens create org -o YOUR_ORG`). If only one existing app needs deploy access, prefer an app-scoped deploy token.', 'Copy the token. Do not use the full-access token from fly auth token.'],
    docs: 'https://fly.io/docs/security/tokens/', scope: 'Deploy access to the selected organization, or to one existing app if app-scoped.',
  },
  {
    id: 'aws', label: 'AWS', vendor: 'Amazon Web Services',
    fields: [
      { name: 'AWS_ROLE_ARN', label: 'Role ARN (preferred)', secret: false, optional: true, placeholder: 'arn:aws:iam::123456789012:role/ProjectAccess' },
      { name: 'AWS_EXTERNAL_ID', label: 'External ID (we provide this)', secret: false, optional: true },
      { name: 'AWS_ACCESS_KEY_ID', label: 'Access key ID (alternative)', secret: false, optional: true },
      { name: 'AWS_SECRET_ACCESS_KEY', label: 'Secret access key (alternative)', secret: true, optional: true },
      { name: 'AWS_REGION', label: 'AWS region', secret: false, optional: true, placeholder: 'us-east-1' },
    ],
    steps: ['Ask us for our AWS account ID and the unique external ID we generate for your project. Our own access key pair stays in Worker secrets; do not enter it here.', 'In AWS IAM, create a cross-account role whose trust policy allows our designated principal to assume it only when it supplies that external ID. Attach a least-privilege policy for the resources we will manage.', 'Enter the role ARN and the external ID we gave you. If a role is not possible, create a dedicated IAM user with only the necessary permissions and enter its access key ID and secret instead. Include the region if the work is region-specific.'],
    docs: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html', scope: 'Provide one complete pair: role ARN and external ID, or dedicated IAM user access key ID and secret. Never share root credentials.',
  },
  {
    id: 'gcp', label: 'Google Cloud', vendor: 'Google',
    fields: [
      { name: 'GCP_SERVICE_ACCOUNT_JSON', label: 'Service account key (JSON)', secret: true, multiline: true },
      { name: 'GCP_PROJECT_ID', label: 'Project ID', secret: false, placeholder: 'my-project' },
    ],
    steps: ['Copy the Project ID from the Google Cloud project selector.', 'Under IAM & Admin → Service Accounts, create an account for this work. Grant only the roles needed on the relevant resources.', 'If permitted by your organization, create and download a JSON key and paste its full contents. For keyless access, ask for our service account email and grant it the agreed roles instead of creating a key; confirm that setup with us separately.'],
    docs: 'https://cloud.google.com/iam/docs/service-account-overview', scope: 'Grant the smallest roles possible on the specific project or resources; avoid Owner and Editor.',
  },
];

const solutionsById = new Map(SOLUTION_CATALOG.map(solution => [solution.id, solution]));
const integrationsById = new Map(INTEGRATION_CATALOG.map(integration => [integration.id, integration]));

export function cleanSolutions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const ids = new Set<string>();
  for (const id of list) {
    if (typeof id === 'string' && solutionsById.has(id)) ids.add(id);
    if (ids.size === 10) break;
  }
  return [...ids];
}

export function parseSolutions(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try { return cleanSolutions(JSON.parse(json)); }
  catch { return []; }
}

export function requiresFor(solutions: unknown): string[] {
  return [...new Set(cleanSolutions(solutions).flatMap(id => solutionsById.get(id)!.requires))];
}

export function integrationsFor(solutions: unknown): IntegrationRef[] {
  const needed = new Map<string, boolean>();
  for (const id of cleanSolutions(solutions)) {
    for (const ref of solutionsById.get(id)!.integrations) {
      needed.set(ref.id, ref.optional && needed.get(ref.id) !== false);
    }
  }
  return [...needed].map(([id, optional]) => ({ id, optional }));
}

export function integrationStatus(integration: Integration, presentSecretNames: Iterable<string>) {
  const present = new Set(presentSecretNames);
  const missing = integration.fields.filter(field => !field.optional && !present.has(field.name)).map(field => field.name);
  return { connected: missing.length === 0, missing };
}

export function fieldBelongs(integrationId: string, name: string): boolean {
  return integrationsById.get(integrationId)?.fields.some(field => field.name === name) ?? false;
}
