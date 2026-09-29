// Finds (and, with --apply, deletes) models nobody owns or uses any more.
//   ASSET_ADMIN_TOKEN=... node scripts/gc-assets.mjs [--apply] [--url https://localhost:5173]
// It calls the running server, which holds the database and storage access. Dry run by default.
import 'dotenv/config';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const urlIndex = args.indexOf('--url');
const base = urlIndex >= 0 ? args[urlIndex + 1] : (process.env.BETTER_AUTH_URL ?? 'https://localhost:5173');
const token = process.env.ASSET_ADMIN_TOKEN;
if (!token) {
	console.error('Set ASSET_ADMIN_TOKEN (in .env for the server and in the environment of this command).');
	process.exit(1);
}
if (base.startsWith('https://localhost') || base.startsWith('https://127.')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const response = await fetch(new URL(`/api/admin/assets/gc${apply ? '?apply=1' : ''}`, base), { method: 'POST', headers: { authorization: `Bearer ${token}` } });
if (!response.ok) {
	console.error(`Failed: ${response.status} ${await response.text()}`);
	process.exit(1);
}
const report = await response.json();
console.log(apply ? 'APPLIED' : 'DRY RUN (nothing changed; use --apply)');
console.log(JSON.stringify(report, null, 2));
