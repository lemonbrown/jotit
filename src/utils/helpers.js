export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const CATEGORY_COLORS = {
  password:    'bg-red-950/80 text-red-400 border-red-900',
  token:       'bg-orange-950/80 text-orange-400 border-orange-900',
  'api-key':   'bg-orange-950/80 text-orange-400 border-orange-900',
  credentials: 'bg-red-950/80 text-red-400 border-red-900',
  secret:      'bg-red-950/80 text-red-400 border-red-900',
  config:      'bg-blue-950/80 text-blue-400 border-blue-900',
  snippet:     'bg-purple-950/80 text-purple-400 border-purple-900',
  command:     'bg-violet-950/80 text-violet-400 border-violet-900',
  sql:         'bg-indigo-950/80 text-indigo-400 border-indigo-900',
  'error-log': 'bg-yellow-950/80 text-yellow-400 border-yellow-900',
  log:         'bg-yellow-950/80 text-yellow-500 border-yellow-900',
  url:         'bg-cyan-950/80 text-cyan-400 border-cyan-900',
  link:        'bg-cyan-950/80 text-cyan-400 border-cyan-900',
  github:      'bg-slate-800/80 text-slate-300 border-slate-700',
  aws:         'bg-amber-950/80 text-amber-400 border-amber-900',
  docker:      'bg-sky-950/80 text-sky-400 border-sky-900',
  'csv / tables': 'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  csv:         'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  table:       'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  spreadsheet: 'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  'diagrams / flowcharts': 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
  diagram:     'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
  flowchart:   'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category.toLowerCase()] ?? 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
}

export const SAMPLE_NOTES = [
  {
    id: 'sample-1',
    content: 'GitHub Personal Access Token\nghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\nScopes: repo, workflow, read:org\nExpires: 2026-12-31\nCreated for: CI/CD pipeline',
    categories: ['github', 'token', 'api-key', 'credentials'],
    embedding: null,
    createdAt: Date.now() - 86400000 * 3,
    updatedAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'sample-2',
    content: 'Postgres Dev Connection\nHost: localhost:5432\nDB: myapp_dev\nUser: postgres\nPass: devpassword123\n\npsql -U postgres -d myapp_dev',
    categories: ['config', 'credentials', 'sql', 'postgres'],
    embedding: null,
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'sample-3',
    content: 'Docker compose snippet\nservices:\n  web:\n    image: node:20-alpine\n    ports:\n      - "3000:3000"\n    volumes:\n      - .:/app\n    command: npm run dev',
    categories: ['docker', 'config', 'snippet'],
    embedding: null,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'sample-4',
    content: 'AWS Access Keys\nAccount: prod\nAccess Key ID: AKIAIOSFODNN7EXAMPLE\nSecret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nRegion: us-east-1',
    categories: ['aws', 'credentials', 'api-key'],
    embedding: null,
    createdAt: Date.now() - 3600000 * 5,
    updatedAt: Date.now() - 3600000 * 5,
  },
  {
    id: 'sample-5',
    content: 'Nginx error log\n2026/04/18 14:23:11 [error] 1234#0: *567 connect() failed\n(111: Connection refused) while connecting to upstream,\nclient: 10.0.0.1, server: api.example.com,\nrequest: "POST /api/v2/users HTTP/1.1"',
    categories: ['error-log', 'nginx', 'log'],
    embedding: null,
    createdAt: Date.now() - 3600000 * 2,
    updatedAt: Date.now() - 3600000 * 2,
  },
  {
    id: 'sample-6',
    content: 'OpenAI API Key\nsk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\nOrg: Personal\nProject: jotit-dev\nLimit: $20/mo',
    categories: ['api-key', 'token', 'openai', 'credentials'],
    embedding: null,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
  },
]

export function createDeveloperSeedNotes() {
  const now = Date.now()
  const base = [
    {
      title: 'Azure staging API auth',
      body: `AZURE_TENANT_ID=11111111-2222-3333-4444-555555555555
AZURE_CLIENT_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
AZURE_CLIENT_SECRET=staging-secret-value

Use bearer token from Key Vault for the staging API.
Fallback curl:

\`\`\`bash
curl -X POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token \\
  -d "client_id=$AZURE_CLIENT_ID" \\
  -d "client_secret=$AZURE_CLIENT_SECRET" \\
  -d "scope=api://staging-api/.default" \\
  -d "grant_type=client_credentials"
\`\`\`

401 usually means the app registration is missing API permissions.`,
      categories: ['azure', 'credentials', 'token', 'api', 'config'],
    },
    {
      title: 'Postgres staging connection',
      body: `DATABASE_URL=postgres://staging_user:staging_pw@db.staging.internal:5432/app
PGHOST=db.staging.internal
PGPORT=5432
PGUSER=staging_user

psql "$DATABASE_URL"

If migrations fail, verify the VPN is connected and the allowlist contains your IP.`,
      categories: ['postgres', 'credentials', 'database', 'config'],
    },
    {
      title: 'GitHub Actions npm publish token',
      body: `NPM_TOKEN=npm_xxxxxxxxxxxxxxxxxxxxx
Stored in GitHub Actions secrets for package publish workflow.

Workflow file:
.github/workflows/publish.yml

Required scopes:
- package:write
- repo`,
      categories: ['github', 'token', 'credentials', 'ci'],
    },
    {
      title: 'Docker local API env',
      body: `docker compose up api redis postgres

API_BASE_URL=http://localhost:8080
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://postgres:postgres@localhost:5432/jotit_local

If the API fails on boot, prune containers and rerun migrations.`,
      categories: ['docker', 'config', 'command', 'local'],
    },
    {
      title: 'JWT middleware debugging',
      body: `Issue: JWT middleware rejects valid tokens from the SPA.

Observed error:
401 Unauthorized
invalid audience

Check:
- issuer is https://login.microsoftonline.com/<tenant>/v2.0
- audience is api://jotit-api
- bearer prefix is preserved before token parsing`,
      categories: ['jwt', 'debugging', 'auth', 'api'],
    },
    {
      title: 'AWS S3 write role',
      body: `Role ARN: arn:aws:iam::123456789012:role/jotit-staging-s3-write
Bucket: jotit-staging-uploads
Policy allows:
- s3:PutObject
- s3:AbortMultipartUpload

Assume role via sts:AssumeRole for background import worker.`,
      categories: ['aws', 's3', 'iam', 'credentials', 'infra'],
    },
    {
      title: 'Redis prod host',
      body: `REDIS_HOST=redis-prod.internal
REDIS_PORT=6380
REDIS_TLS=true

Use redis-cli --tls -h redis-prod.internal -p 6380

Timeouts usually indicate the app is still pointing at the old non-TLS port.`,
      categories: ['redis', 'config', 'production', 'debugging'],
    },
    {
      title: 'Kubernetes restart commands',
      body: `kubectl config use-context staging
kubectl get pods -n jotit
kubectl rollout restart deployment/jotit-api -n jotit
kubectl logs deployment/jotit-api -n jotit --since=10m

Use this when the staging API is stuck after config rotation.`,
      categories: ['kubernetes', 'command', 'staging', 'ops'],
    },
    {
      title: 'GCP service account key',
      body: `GOOGLE_APPLICATION_CREDENTIALS=/home/user/.config/gcloud/service-account.json
GCP_PROJECT_ID=my-project-123

Service account: jotit-backend@my-project-123.iam.gserviceaccount.com

Download key JSON from IAM & Admin > Service Accounts.
Rotate every 90 days via:

\`\`\`bash
gcloud iam service-accounts keys create key.json \\
  --iam-account=jotit-backend@my-project-123.iam.gserviceaccount.com
\`\`\``,
      categories: ['gcp', 'credentials', 'config', 'cloud'],
    },
    {
      title: 'MySQL RDS connection',
      body: `DATABASE_URL=mysql://admin:password@db.rds.amazonaws.com:3306/jotit_prod
MYSQL_HOST=db.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=admin

mysql -h $MYSQL_HOST -u $MYSQL_USER -p

Use RDS proxy endpoint for connection pooling in Lambda.
Connection string format: mysql://user:pass@host:port/dbname`,
      categories: ['mysql', 'database', 'credentials', 'aws', 'config'],
    },
    {
      title: 'Terraform staging state',
      body: `terraform workspace select staging
terraform plan -var-file=staging.tfvars
terraform apply -auto-approve -var-file=staging.tfvars

State stored in S3: s3://jotit-terraform-state/staging/terraform.tfstate
DynamoDB lock table: jotit-terraform-locks

Run from the infra/ directory. Requires AWS_PROFILE=jotit-infra.`,
      categories: ['terraform', 'infra', 'staging', 'command', 'aws'],
    },
  ]

  return base.map((entry, index) => ({
    id: generateId(),
    content: `${entry.title}\n${entry.body}`,
    categories: entry.categories,
    embedding: null,
    isPublic: false,
    createdAt: now - ((base.length - index) * 60000),
    updatedAt: now - ((base.length - index) * 60000),
  }))
}
