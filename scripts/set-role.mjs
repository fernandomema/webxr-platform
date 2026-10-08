// Sets the roles of an existing user (comma-separated, as the Better Auth admin plugin stores them).
//   node scripts/set-role.mjs <email|username> [roles]   (roles default to "admin"; "user" demotes)
//   node scripts/set-role.mjs <email|username> --add moderator
// Talks to DATABASE_URL directly, so it works without the server running. Active sessions pick the change up on refresh.
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const addIndex = args.indexOf('--add');
const add = addIndex >= 0 ? args.splice(addIndex, 2)[1] : null;
const [who, roles = 'admin'] = args;
if (!who || (addIndex >= 0 && !add)) {
	console.error('Usage: node scripts/set-role.mjs <email|username> [roles] | --add <role>');
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error('Set DATABASE_URL (in .env or the environment).');
	process.exit(1);
}

const parse = (value) => [...new Set((value ?? '').split(',').map((r) => r.trim()).filter(Boolean))];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
	await client.connect();
	const found = await client.query('SELECT id, email, role FROM "user" WHERE lower(email) = lower($1) OR username = lower($1) LIMIT 2', [who]);
	if (found.rowCount === 0) throw new Error(`No user matches "${who}".`);
	if (found.rowCount > 1) throw new Error(`"${who}" matches more than one user; use the email.`);
	const user = found.rows[0];
	const next = add ? parse(`${user.role ?? ''},${add}`) : parse(roles);
	if (next.length === 0) throw new Error('No roles given.');
	await client.query('UPDATE "user" SET role = $1, "updatedAt" = now() WHERE id = $2', [next.join(','), user.id]);
	console.log(`${user.email}: ${user.role ?? '(none)'} -> ${next.join(',')}`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await client.end().catch(() => {});
}
