// Marks a published world as a staff pick (shown on the home screen), or removes the mark.
//   node scripts/staff-pick.mjs <publicationId> [--off]
//   node scripts/staff-pick.mjs --list
// Talks to DATABASE_URL directly, so it works without the server running.
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const list = args.includes('--list');
const off = args.includes('--off');
const id = args.find((arg) => !arg.startsWith('--'));
if (!list && !id) {
	console.error('Usage: node scripts/staff-pick.mjs <publicationId> [--off] | --list');
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error('Set DATABASE_URL (in .env or the environment).');
	process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
	await client.connect();
	if (list) {
		const rows = await client.query('SELECT id, name, "staffPick" FROM "publishedWorld" ORDER BY "staffPick" DESC, "updatedAt" DESC LIMIT 50');
		for (const row of rows.rows) console.log(`${row.staffPick ? '★' : ' '} ${row.id}  ${row.name}`);
	} else {
		const result = await client.query('UPDATE "publishedWorld" SET "staffPick" = $1 WHERE id = $2 RETURNING name', [!off, id]);
		if (result.rowCount === 0) throw new Error(`No published world with id "${id}".`);
		console.log(`${result.rows[0].name}: staff pick ${off ? 'removed' : 'set'}`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await client.end().catch(() => {});
}
