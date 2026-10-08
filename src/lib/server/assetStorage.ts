import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { AssetId } from '$lib/assets/ref';

/**
 * Model files live in an S3-compatible bucket, one object per content hash and
 * nothing user-specific in the key. Only this module talks to S3.
 */

export type TransferMode = 'direct' | 'proxy';

let client: S3Client | null = null;

export function assetStorageConfigured(): boolean {
	return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

function s3(): S3Client {
	if (!assetStorageConfigured()) throw new Error('Model storage is not configured (S3_* environment variables).');
	client ??= new S3Client({
		endpoint: env.S3_ENDPOINT,
		region: env.S3_REGION || 'auto',
		forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
		credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
		// Newer SDKs add CRC32 checksums to every request, which several S3-compatible servers reject.
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED'
	});
	return client;
}

const bucket = () => env.S3_BUCKET!;

/**
 * `direct` hands the browser a presigned URL so bytes never pass through this
 * server. A browser refuses http requests from an https page, so with an http
 * endpoint `auto` falls back to `proxy` (the server streams the bytes) and
 * switches to `direct` by itself as soon as the endpoint is https.
 */
export function transferMode(): TransferMode {
	const setting = (env.ASSET_TRANSFER ?? 'auto').toLowerCase();
	if (setting === 'direct' || setting === 'proxy') return setting;
	return env.S3_ENDPOINT?.startsWith('https:') ? 'direct' : 'proxy';
}

/**
 * Folder every key lives under. Development and production can share one bucket without mixing objects:
 * dev uses `dev/` unless S3_KEY_PREFIX says otherwise (set it to an empty string to opt out), production uses none.
 * Keys are stored in the database as written, so changing this only affects objects uploaded afterwards.
 */
export function keyPrefix(): string {
	const configured = env.S3_KEY_PREFIX ?? (dev ? 'dev' : '');
	const trimmed = configured.replace(/^\/+|\/+$/g, '');
	return trimmed ? `${trimmed}/` : '';
}

/** Where model files are stored, including the environment prefix. */
export const assetKeyPrefix = () => `${keyPrefix()}assets/sha256/`;

/** `[dev/]assets/sha256/ab/cd/<hex>.<ext>` — the hash spread over two directory levels. */
export function storageKeyFor(id: AssetId, extension: string): string {
	const hex = id.slice('sha256:'.length);
	return `${assetKeyPrefix()}${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}${extension ? `.${extension}` : ''}`;
}

const PRESIGN_SECONDS = 15 * 60;

export async function presignUpload(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }> {
	const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: PRESIGN_SECONDS });
	return { url, headers: { 'content-type': contentType } };
}

export async function presignDownload(key: string): Promise<{ url: string; expiresAt: number }> {
	const url = await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: PRESIGN_SECONDS });
	return { url, expiresAt: Date.now() + PRESIGN_SECONDS * 1000 };
}

/** Size in bytes, or null when the object does not exist. */
export async function objectSize(key: string): Promise<number | null> {
	try {
		const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
		return head.ContentLength ?? null;
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

/** The first bytes of an object, to check the file header without downloading it. */
export async function readHead(key: string, length: number): Promise<Uint8Array> {
	const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${length - 1}` }));
	return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
	await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
}

export async function getObjectStream(key: string): Promise<{ stream: ReadableStream; size: number | undefined } | null> {
	try {
		const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
		if (!result.Body) return null;
		return { stream: result.Body.transformToWebStream(), size: result.ContentLength };
	} catch (error) {
		if (isNotFound(error)) return null;
		throw error;
	}
}

/**
 * SHA-256 of a stored object, computed while streaming it (nothing is held in
 * memory). Run once when an upload completes so a model can never be stored
 * under a hash that is not its own — everyone else trusts the hash.
 */
export async function hashObject(key: string): Promise<string | null> {
	const object = await getObjectStream(key);
	if (!object) return null;
	const hash = createHash('sha256');
	const reader = object.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		hash.update(value);
	}
	return hash.digest('hex');
}

export async function deleteObject(key: string): Promise<void> {
	await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Every key under a prefix (paged), for the storage-vs-database consistency check. */
export async function* listKeys(prefix: string): AsyncGenerator<{ key: string; size: number; lastModified: Date | undefined }> {
	let token: string | undefined;
	do {
		const page = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
		for (const object of page.Contents ?? []) if (object.Key) yield { key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified };
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
}

function isNotFound(error: unknown): boolean {
	const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
	return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}
