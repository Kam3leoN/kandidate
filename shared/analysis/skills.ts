import { aliasRegex, normalize } from './text.js';

export type SkillCategory =
  | 'dev'
  | 'data'
  | 'cloud'
  | 'design'
  | 'product'
  | 'marketing'
  | 'sales'
  | 'business'
  | 'management'
  | 'tools'
  | 'soft';

export interface SkillDef {
  id: string;
  label: string;
  cat: SkillCategory;
  aliases: string[];
}

/**
 * Built-in dictionary. Aliases are matched on normalized text (lower-case,
 * no accents) with token boundaries. Ambiguous French words (vue, lit, express,
 * go, r, c…) are only matched in unambiguous forms.
 */
const RAW: Array<[string, SkillCategory, ...string[]]> = [
  // ── Front / back / mobile
  ['HTML', 'dev', 'html', 'html5'],
  ['CSS', 'dev', 'css', 'css3'],
  ['Sass', 'dev', 'sass', 'scss'],
  ['Tailwind CSS', 'dev', 'tailwind', 'tailwindcss'],
  ['Bootstrap', 'dev', 'bootstrap'],
  ['JavaScript', 'dev', 'javascript', 'js', 'ecmascript', 'es6'],
  ['TypeScript', 'dev', 'typescript'],
  ['React', 'dev', 'react', 'reactjs', 'react.js'],
  ['Next.js', 'dev', 'next.js', 'nextjs'],
  ['Vue.js', 'dev', 'vue.js', 'vuejs', 'vue 3', 'vue3', 'vue 2'],
  ['Nuxt', 'dev', 'nuxt', 'nuxt.js', 'nuxtjs'],
  ['Angular', 'dev', 'angular', 'angularjs'],
  ['Svelte', 'dev', 'svelte', 'sveltekit'],
  ['Web Components', 'dev', 'web components', 'web component', 'custom elements', 'lit element', 'lit-element', 'litelement', 'stencil'],
  ['Redux', 'dev', 'redux'],
  ['Vite', 'dev', 'vite', 'vitejs'],
  ['Webpack', 'dev', 'webpack'],
  ['Node.js', 'dev', 'node.js', 'nodejs', 'node js'],
  ['Express', 'dev', 'express.js', 'expressjs'],
  ['NestJS', 'dev', 'nestjs', 'nest.js'],
  ['PHP', 'dev', 'php', 'php8'],
  ['Symfony', 'dev', 'symfony'],
  ['Laravel', 'dev', 'laravel'],
  ['WordPress', 'dev', 'wordpress'],
  ['Drupal', 'dev', 'drupal'],
  ['Python', 'dev', 'python'],
  ['Django', 'dev', 'django'],
  ['Flask', 'dev', 'flask'],
  ['FastAPI', 'dev', 'fastapi'],
  ['Java', 'dev', 'java', 'jee', 'j2ee'],
  ['Spring', 'dev', 'spring boot', 'springboot', 'spring framework'],
  ['Kotlin', 'dev', 'kotlin'],
  ['Swift', 'dev', 'swift', 'swiftui'],
  ['Flutter', 'dev', 'flutter', 'dart'],
  ['React Native', 'dev', 'react native', 'react-native'],
  ['Android', 'dev', 'android'],
  ['iOS', 'dev', 'ios'],
  ['C#', 'dev', 'c#', 'csharp'],
  ['.NET', 'dev', '.net', 'dotnet', 'asp.net', '.net core'],
  ['C++', 'dev', 'c++', 'cpp'],
  ['C', 'dev', 'langage c'],
  ['Go', 'dev', 'golang', 'go lang'],
  ['Rust', 'dev', 'rust'],
  ['Ruby', 'dev', 'ruby', 'ruby on rails', 'rails'],
  ['Scala', 'dev', 'scala'],
  ['GraphQL', 'dev', 'graphql', 'apollo'],
  ['API REST', 'dev', 'api rest', 'rest api', 'restful', 'apis rest', 'api restful'],
  ['Microservices', 'dev', 'microservices', 'micro-services', 'micro services'],
  ['Tests automatisés', 'dev', 'tests unitaires', 'test unitaire', 'tdd', 'jest', 'vitest', 'playwright', 'cypress', 'tests automatises', 'tests e2e', 'unit tests'],
  ['Accessibilité', 'dev', 'accessibilite', 'rgaa', 'wcag', 'a11y', 'accessibility'],
  ['Performance web', 'dev', 'core web vitals', 'lighthouse', 'performance web', 'web performance'],
  ['SEO technique', 'dev', 'seo technique'],
  ['PWA', 'dev', 'pwa', 'progressive web app', 'service worker'],
  ['Git', 'tools', 'git', 'github', 'gitlab', 'bitbucket'],
  ['Linux', 'cloud', 'linux', 'unix', 'bash', 'shell'],
  ['Cybersécurité', 'cloud', 'cybersecurite', 'securite informatique', 'owasp', 'pentest', 'soc', 'iso 27001'],
  // ── Cloud / DevOps
  ['Docker', 'cloud', 'docker', 'conteneurisation', 'containers'],
  ['Kubernetes', 'cloud', 'kubernetes', 'k8s', 'openshift', 'helm'],
  ['AWS', 'cloud', 'aws', 'amazon web services', 'ec2'],
  ['Azure', 'cloud', 'azure', 'microsoft azure'],
  ['GCP', 'cloud', 'gcp', 'google cloud', 'google cloud platform'],
  ['Terraform', 'cloud', 'terraform', 'ansible', 'infrastructure as code', 'iac'],
  ['CI/CD', 'cloud', 'ci/cd', 'ci cd', 'integration continue', 'github actions', 'gitlab ci', 'jenkins', 'devops'],
  ['Vercel', 'cloud', 'vercel', 'netlify'],
  // ── Data / IA
  ['SQL', 'data', 'sql', 't-sql', 'pl/sql', 'plsql'],
  ['PostgreSQL', 'data', 'postgresql', 'postgres'],
  ['MySQL', 'data', 'mysql', 'mariadb'],
  ['MongoDB', 'data', 'mongodb', 'mongo'],
  ['Redis', 'data', 'redis'],
  ['Elasticsearch', 'data', 'elasticsearch', 'elastic', 'opensearch'],
  ['Data analyse', 'data', 'data analyse', 'data analysis', 'analyse de donnees', 'data analyst', 'analyse de donnee'],
  ['Data science', 'data', 'data science', 'data scientist'],
  ['Machine learning', 'data', 'machine learning', 'apprentissage automatique', 'deep learning', 'scikit-learn', 'tensorflow', 'pytorch'],
  ['IA générative', 'data', 'ia generative', 'genai', 'llm', 'llms', 'chatgpt', 'openai', 'prompt engineering', 'rag'],
  ['Pandas', 'data', 'pandas', 'numpy'],
  ['Spark', 'data', 'spark', 'pyspark', 'databricks', 'hadoop'],
  ['ETL', 'data', 'etl', 'elt', 'dbt', 'airflow', 'talend'],
  ['Data warehouse', 'data', 'bigquery', 'snowflake', 'redshift', 'data warehouse', 'datawarehouse'],
  ['Power BI', 'data', 'power bi', 'powerbi'],
  ['Tableau', 'data', 'tableau software', 'tableau desktop'],
  ['Looker', 'data', 'looker', 'looker studio', 'data studio'],
  ['Excel', 'tools', 'excel', 'tableaux croises dynamiques', 'tcd', 'google sheets'],
  ['VBA', 'tools', 'vba', 'macros excel'],
  // ── Design / UX
  ['UX design', 'design', 'ux', 'ux design', 'experience utilisateur', 'user experience', 'ux designer', 'recherche utilisateur', 'user research', 'tests utilisateurs'],
  ['UI design', 'design', 'ui', 'ui design', 'interface utilisateur', 'user interface', 'ui designer'],
  ['Design system', 'design', 'design system', 'design systems', 'systeme de design', 'bibliotheque de composants', 'component library', 'storybook'],
  ['Material Design', 'design', 'material design', 'material 3', 'material you'],
  ['Figma', 'design', 'figma', 'figjam'],
  ['Sketch', 'design', 'sketch'],
  ['Adobe XD', 'design', 'adobe xd'],
  ['Photoshop', 'design', 'photoshop'],
  ['Illustrator', 'design', 'illustrator'],
  ['InDesign', 'design', 'indesign'],
  ['Suite Adobe', 'design', 'suite adobe', 'adobe creative suite', 'creative cloud'],
  ['After Effects', 'design', 'after effects', 'motion design', 'premiere pro'],
  ['Prototypage', 'design', 'prototypage', 'prototype', 'prototypes', 'maquettage', 'maquettes', 'wireframe', 'wireframes', 'zoning'],
  ['Responsive design', 'design', 'responsive', 'responsive design', 'mobile first'],
  ['Design graphique', 'design', 'design graphique', 'graphisme', 'identite visuelle', 'charte graphique', 'direction artistique'],
  // ── Product / projet
  ['Gestion de projet', 'product', 'gestion de projet', 'gestion de projets', 'chef de projet', 'pilotage de projet', 'project management', 'conduite de projet'],
  ['Agile', 'product', 'agile', 'agilite', 'methodes agiles', 'methodologie agile'],
  ['Scrum', 'product', 'scrum', 'scrum master', 'sprint'],
  ['Kanban', 'product', 'kanban'],
  ['SAFe', 'product', 'safe agile', 'scaled agile', 'framework safe'],
  ['Product management', 'product', 'product management', 'product manager', 'product owner', 'roadmap produit', 'discovery', 'backlog'],
  ['Jira', 'tools', 'jira', 'confluence'],
  ['Notion', 'tools', 'notion'],
  ['Recueil du besoin', 'product', 'recueil des besoins', 'recueil du besoin', 'expression de besoin', 'specifications fonctionnelles', 'cahier des charges', 'amoa', 'moa'],
  ['ERP', 'tools', 'erp', 'sap', 'odoo', 'sage', 'dynamics 365', 'cegid'],
  ['CRM', 'tools', 'crm', 'salesforce', 'hubspot', 'pipedrive', 'zoho'],
  ['Suite Office', 'tools', 'pack office', 'suite office', 'microsoft office', 'office 365', 'microsoft 365', 'word', 'powerpoint', 'outlook', 'google workspace'],
  // ── Marketing / digital
  ['Marketing digital', 'marketing', 'marketing digital', 'webmarketing', 'web marketing', 'digital marketing', 'marketing numerique'],
  ['SEO', 'marketing', 'seo', 'referencement naturel'],
  ['SEA', 'marketing', 'sea', 'google ads', 'adwords', 'referencement payant', 'sem'],
  ['Social ads', 'marketing', 'social ads', 'meta ads', 'facebook ads', 'linkedin ads', 'tiktok ads'],
  ['Google Analytics', 'marketing', 'google analytics', 'ga4', 'matomo', 'piano analytics', 'google tag manager', 'gtm'],
  ['Réseaux sociaux', 'marketing', 'reseaux sociaux', 'social media', 'community management', 'community manager', 'instagram', 'tiktok'],
  ['Content marketing', 'marketing', 'content marketing', 'marketing de contenu', 'redaction web', 'copywriting', 'brand content', 'storytelling'],
  ['Emailing', 'marketing', 'emailing', 'e-mailing', 'email marketing', 'newsletter', 'marketing automation', 'brevo', 'mailchimp'],
  ['Growth', 'marketing', 'growth', 'growth hacking', 'acquisition', 'cro', 'a/b testing', 'ab testing'],
  ['E-commerce', 'marketing', 'e-commerce', 'ecommerce', 'shopify', 'prestashop', 'magento', 'woocommerce', 'marketplace'],
  ['Événementiel', 'marketing', 'evenementiel', 'organisation d\'evenements', 'salons'],
  ['Communication', 'marketing', 'communication interne', 'communication externe', 'relations presse', 'plan de communication'],
  // ── Sales / business
  ['Prospection', 'sales', 'prospection', 'prospecter', 'chasse', 'phoning', 'cold calling', 'lead generation', 'generation de leads'],
  ['Négociation', 'sales', 'negociation', 'negocier', 'closing'],
  ['Business development', 'sales', 'business development', 'developpement commercial', 'business developer', 'biz dev'],
  ['Account management', 'sales', 'account management', 'account manager', 'gestion de portefeuille', 'portefeuille clients', 'grands comptes', 'key account'],
  ['Vente B2B', 'sales', 'b2b', 'vente b2b', 'btob'],
  ['Vente B2C', 'sales', 'b2c', 'btoc', 'vente en magasin', 'retail'],
  ['Relation client', 'sales', 'relation client', 'service client', 'customer success', 'satisfaction client', 'fidelisation'],
  ['Réseau / franchise', 'business', 'reseau d\'affaires', 'franchise', 'franchiseur', 'animation de reseau', 'networking'],
  ['Achats', 'business', 'achats', 'acheteur', 'sourcing', 'procurement'],
  ['Supply chain', 'business', 'supply chain', 'logistique', 'approvisionnement', 'wms'],
  ['Comptabilité', 'business', 'comptabilite', 'comptable', 'bilan', 'fiscalite', 'tva'],
  ['Contrôle de gestion', 'business', 'controle de gestion', 'reporting financier', 'gestion budgetaire', 'suivi budgetaire', 'p&l'],
  ['Finance', 'business', 'finance', 'tresorerie', 'consolidation', 'audit'],
  ['Juridique', 'business', 'droit des affaires', 'juridique', 'contrats commerciaux', 'rgpd', 'compliance', 'conformite'],
  ['RH', 'business', 'ressources humaines', 'recrutement', 'talent acquisition', 'sirh', 'paie', 'gestion administrative du personnel', 'droit social', 'gpec'],
  ['Formation', 'business', 'formation professionnelle', 'formateur', 'ingenierie pedagogique', 'e-learning'],
  ['Qualité', 'business', 'qualite', 'iso 9001', 'lean', 'six sigma', 'amelioration continue'],
  // ── Management
  ['Management d\'équipe', 'management', 'management', 'manager une equipe', 'encadrement', 'management d\'equipe', 'encadrer', 'team lead', 'lead dev', 'leadership d\'equipe'],
  ['Stratégie', 'management', 'strategie', 'plan strategique', 'business plan'],
  ['Conduite du changement', 'management', 'conduite du changement', 'change management', 'transformation digitale', 'transformation numerique'],
  // ── Soft skills
  ['Autonomie', 'soft', 'autonomie', 'autonome'],
  ['Rigueur', 'soft', 'rigueur', 'rigoureux', 'rigoureuse', 'sens du detail', 'minutie'],
  ['Esprit d\'équipe', 'soft', 'esprit d\'equipe', 'travail en equipe', 'team player', 'collaboratif', 'collaboration'],
  ['Communication orale/écrite', 'soft', 'aisance relationnelle', 'qualites redactionnelles', 'aisance orale', 'excellent communicant', 'bon communicant', 'capacites de communication', 'communication skills'],
  ['Leadership', 'soft', 'leadership', 'charisme', 'meneur'],
  ['Organisation', 'soft', 'organisation', 'organise', 'organisee', 'gestion des priorites', 'sens de l\'organisation'],
  ['Adaptabilité', 'soft', 'adaptabilite', 'adaptable', 'polyvalence', 'polyvalent', 'flexibilite'],
  ['Curiosité', 'soft', 'curiosite', 'curieux', 'curieuse', 'veille technologique', 'veille techno'],
  ['Force de proposition', 'soft', 'force de proposition', 'proactif', 'proactive', 'proactivite', 'esprit d\'initiative'],
  ['Esprit d\'analyse', 'soft', 'esprit d\'analyse', 'esprit analytique', 'capacite d\'analyse', 'esprit de synthese', 'capacites d\'analyse'],
  ['Créativité', 'soft', 'creativite', 'creatif', 'creative'],
  ['Pédagogie', 'soft', 'pedagogie', 'pedagogue', 'vulgariser'],
  ['Résistance au stress', 'soft', 'gestion du stress', 'resistance au stress', 'sang-froid'],
  ['Sens du service', 'soft', 'sens du service', 'orientation client', 'sens client', 'ecoute'],
  ['Persévérance', 'soft', 'perseverance', 'tenacite', 'tenace', 'perseverant', 'combativite'],
];

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9+#.]+/g, '-').replace(/^-|-$/g, '');
}

export const SKILLS: SkillDef[] = RAW.map(([label, cat, ...aliases]) => ({
  id: slug(label),
  label,
  cat,
  aliases: aliases.length ? aliases : [normalize(label)],
}));

export interface CompiledSkill extends SkillDef {
  res: RegExp[];
}

const compiledCache = new Map<string, CompiledSkill[]>();

/** Dictionary + the user's own skills (anything in the profile becomes detectable). */
export function compileSkills(extra: Array<{ name: string; aliases?: string[] }> = []): CompiledSkill[] {
  const key = extra.map((e) => `${e.name}:${(e.aliases ?? []).join(',')}`).join('|');
  const hit = compiledCache.get(key);
  if (hit) return hit;
  const out: CompiledSkill[] = SKILLS.map((s) => ({ ...s, res: s.aliases.map((a) => aliasRegex(a)) }));
  for (const e of extra) {
    const known = findSkill(e.name, out);
    if (known) {
      for (const a of e.aliases ?? []) known.res.push(aliasRegex(a));
      continue;
    }
    const aliases = [e.name, ...(e.aliases ?? [])].map((a) => normalize(a).trim()).filter((a) => a.length > 1);
    if (!aliases.length) continue;
    out.push({ id: slug(e.name), label: e.name.trim(), cat: 'tools', aliases, res: aliases.map((a) => aliasRegex(a)) });
  }
  if (compiledCache.size > 20) compiledCache.clear();
  compiledCache.set(key, out);
  return out;
}

/** Resolve a free-form skill name ("reactjs", "Figma") to a dictionary entry. */
export function findSkill<T extends SkillDef>(name: string, list: T[] = SKILLS as T[]): T | undefined {
  const n = normalize(name).trim();
  if (!n) return undefined;
  return list.find((s) => normalize(s.label) === n || s.id === slug(name) || s.aliases.includes(n));
}

export function canonicalSkillId(name: string): string {
  return findSkill(name)?.id ?? slug(name);
}

export const LANGUAGES: Array<{ id: string; label: string; aliases: string[] }> = [
  { id: 'en', label: 'Anglais', aliases: ['anglais', 'english'] },
  { id: 'es', label: 'Espagnol', aliases: ['espagnol', 'spanish'] },
  { id: 'de', label: 'Allemand', aliases: ['allemand', 'german'] },
  { id: 'it', label: 'Italien', aliases: ['italien', 'italian'] },
  { id: 'pt', label: 'Portugais', aliases: ['portugais', 'portuguese'] },
  { id: 'nl', label: 'Néerlandais', aliases: ['neerlandais', 'dutch', 'flamand'] },
  { id: 'zh', label: 'Chinois', aliases: ['chinois', 'mandarin'] },
  { id: 'ar', label: 'Arabe', aliases: ['arabe', 'arabic'] },
];

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  dev: 'Développement',
  data: 'Data & IA',
  cloud: 'Cloud & DevOps',
  design: 'Design & UX',
  product: 'Produit & projet',
  marketing: 'Marketing',
  sales: 'Commercial',
  business: 'Fonctions support',
  management: 'Management',
  tools: 'Outils',
  soft: 'Savoir-être',
};
