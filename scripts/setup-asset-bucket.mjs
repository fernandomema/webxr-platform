// Allows browsers to upload to and download from the model bucket directly (needed for ASSET_TRANSFER=direct).
//   node scripts/setup-asset-bucket.mjs [origin ...]
// Origins default to ASSET_CORS_ORIGINS (comma separated) or "*". Reads the S3_* variables from .env.
import 'dotenv/config';
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE, ASSET_CORS_ORIGINS } = process.env;
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
	console.error('Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env first.');
	process.exit(1);
}

const origins = process.argv.slice(2).length ? process.argv.slice(2) : (ASSET_CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? ['*']);
const client = new S3Client({
	endpoint: S3_ENDPOINT,
	region: S3_REGION || 'auto',
	forcePathStyle: (S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
	credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
	requestChecksumCalculation: 'WHEN_REQUIRED',
	responseChecksumValidation: 'WHEN_REQUIRED'
});

const rules = [
	{
		AllowedOrigins: origins,
		AllowedMethods: ['GET', 'PUT', 'HEAD'],
		AllowedHeaders: ['content-type', 'x-amz-*'],
		ExposeHeaders: ['ETag', 'Content-Length'],
		MaxAgeSeconds: 3600
	}
];

try {
	await client.send(new PutBucketCorsCommand({ Bucket: S3_BUCKET, CORSConfiguration: { CORSRules: rules } }));
	console.log(`CORS set on "${S3_BUCKET}" for: ${origins.join(', ')}`);
	const check = await client.send(new GetBucketCorsCommand({ Bucket: S3_BUCKET }));
	console.log(JSON.stringify(check.CORSRules, null, 2));
} catch (error) {
	console.error(`Could not set CORS through the S3 API: ${error?.name ?? ''} ${error?.message ?? error}`);
	console.error('This key may not be allowed to change bucket settings. Set CORS with your storage provider\'s admin tool instead:');
	console.error(`  origins: ${origins.join(', ')}  methods: GET, PUT, HEAD  headers: content-type, x-amz-*  expose: ETag`);
	process.exit(2);
}
