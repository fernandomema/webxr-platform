<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import ProfileAvatar from '$lib/auth/ProfileAvatar.svelte';
	import { cloudAssets } from '$lib/assets/cloud';
	import { importAsset } from '$lib/assets/importAsset';
	import { getLocalAssetStore } from '$lib/assets/store';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// --- Profile ---
	let name = $state('');
	let username = $state('');
	$effect.pre(() => { name = data.user.name; username = data.user.username ?? ''; });
	let profileBusy = $state(false);
	let profileMessage = $state<{ ok: boolean; text: string } | null>(null);

	async function saveProfile(event: Event) {
		event.preventDefault();
		profileBusy = true; profileMessage = null;
		const { error } = await authClient.updateUser({ name: name.trim(), username: username.trim() || undefined });
		profileBusy = false;
		if (error) { profileMessage = { ok: false, text: error.message ?? 'Could not save your profile.' }; return; }
		profileMessage = { ok: true, text: 'Profile saved.' };
		await invalidateAll();
	}

	// --- Profile picture: cropped to a small square, stored as an image asset like any other ---
	const AVATAR_SIDE = 256;
	let pictureBusy = $state(false);
	let pictureMessage = $state<{ ok: boolean; text: string } | null>(null);

	async function squareImageBytes(file: File): Promise<Uint8Array> {
		const bitmap = await createImageBitmap(file);
		const side = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = AVATAR_SIDE;
		canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
		if (!blob) throw new Error('Could not process this image.');
		return new Uint8Array(await blob.arrayBuffer());
	}

	async function setPicture(assetId: string | null) {
		const response = await fetch('/api/account/avatar', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId }) });
		if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'Could not update your picture.');
		await invalidateAll();
	}

	async function pickPicture(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		pictureBusy = true; pictureMessage = null;
		try {
			const bytes = await squareImageBytes(file);
			const { manifest } = await importAsset(bytes, 'profile-picture.webp', getLocalAssetStore(), { type: 'image' });
			await cloudAssets.upload(manifest, bytes);
			await setPicture(manifest.assetId);
			pictureMessage = { ok: true, text: 'Picture updated.' };
		} catch (caught) {
			pictureMessage = { ok: false, text: caught instanceof Error ? caught.message : 'Could not update your picture.' };
		} finally { pictureBusy = false; }
	}

	async function removePicture() {
		pictureBusy = true; pictureMessage = null;
		try { await setPicture(null); } catch (caught) { pictureMessage = { ok: false, text: caught instanceof Error ? caught.message : 'Could not remove your picture.' }; }
		finally { pictureBusy = false; }
	}

	// --- Password (only for accounts that have one; Discord-only accounts do not) ---
	let hasPassword = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let passwordBusy = $state(false);
	let passwordMessage = $state<{ ok: boolean; text: string } | null>(null);

	$effect(() => {
		authClient.listAccounts().then(({ data: list }) => { hasPassword = !!list?.some((account) => account.providerId === 'credential'); });
	});

	async function changePassword(event: Event) {
		event.preventDefault();
		passwordBusy = true; passwordMessage = null;
		const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
		passwordBusy = false;
		if (error) { passwordMessage = { ok: false, text: error.message ?? 'Could not change the password.' }; return; }
		currentPassword = ''; newPassword = '';
		passwordMessage = { ok: true, text: 'Password changed. Other devices were signed out.' };
		await loadSessions();
	}

	// --- Sessions ---
	interface SessionRow { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date | string }
	let sessions = $state<SessionRow[]>([]);
	let sessionError = $state('');

	async function loadSessions() {
		const { data: list, error } = await authClient.listSessions();
		if (error) { sessionError = error.message ?? 'Could not load sessions.'; return; }
		sessions = (list ?? []) as SessionRow[];
	}
	$effect(() => { void loadSessions(); });

	async function revoke(token: string) {
		sessionError = '';
		const { error } = await authClient.revokeSession({ token });
		if (error) { sessionError = error.message ?? 'Could not revoke the session.'; return; }
		await loadSessions();
	}

	async function revokeOthers() {
		sessionError = '';
		const { error } = await authClient.revokeOtherSessions();
		if (error) { sessionError = error.message ?? 'Could not revoke sessions.'; return; }
		await loadSessions();
	}

	function describe(row: SessionRow): string {
		const agent = row.userAgent ?? '';
		const browser = /Firefox/.test(agent) ? 'Firefox' : /OculusBrowser/.test(agent) ? 'Meta Quest Browser' : /Edg\//.test(agent) ? 'Edge' : /Chrome/.test(agent) ? 'Chrome' : /Safari/.test(agent) ? 'Safari' : 'Unknown browser';
		const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac OS/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
		return os ? `${browser} on ${os}` : browser;
	}

	const field = 'mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-white/30';
	const primary = 'rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink hover:bg-glow disabled:opacity-50';
	const secondary = 'rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50';
</script>

<svelte:head><title>Settings · {PLATFORM_NAME}</title></svelte:head>

<div class="space-y-10">
	<section>
		<h2 class="text-lg font-medium">Profile</h2>
		<form class="mt-4 space-y-4 rounded-xl border border-white/10 bg-ink-2 p-5" onsubmit={saveProfile}>
			<div class="flex items-center gap-4">
				<ProfileAvatar image={data.user.image} name={data.user.name} size={72} />
				<div class="space-y-2">
					<div class="flex flex-wrap gap-2">
						<label class="{secondary} cursor-pointer {pictureBusy ? 'pointer-events-none opacity-50' : ''}">{pictureBusy ? 'Working…' : 'Upload picture'}<input class="sr-only" type="file" accept="image/*" onchange={pickPicture} disabled={pictureBusy} /></label>
						{#if data.user.image}<button class={secondary} type="button" onclick={removePicture} disabled={pictureBusy}>Remove</button>{/if}
					</div>
					<p class="text-xs text-bone/40">Cropped to a square. Counts toward your Cloud storage.</p>
					{#if pictureMessage}<p class="text-sm {pictureMessage.ok ? 'text-emerald-300' : 'text-red-400'}" role="status">{pictureMessage.text}</p>{/if}
				</div>
			</div>
			<label class="block text-sm text-bone/60">Display name
				<input class={field} bind:value={name} required maxlength="64" autocomplete="name" />
			</label>
			<label class="block text-sm text-bone/60">Username
				<input class={field} bind:value={username} minlength="3" maxlength="30" pattern="[A-Za-z0-9_.]+" autocomplete="username" />
			</label>
			<p class="text-sm text-bone/60">Email <span class="ml-2 text-bone">{data.user.email}</span></p>
			<div class="flex items-center gap-4">
				<button class={primary} type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button>
				{#if profileMessage}<span class="text-sm {profileMessage.ok ? 'text-emerald-300' : 'text-red-400'}">{profileMessage.text}</span>{/if}
			</div>
		</form>
	</section>

	{#if hasPassword}
		<section>
			<h2 class="text-lg font-medium">Password</h2>
			<form class="mt-4 space-y-4 rounded-xl border border-white/10 bg-ink-2 p-5" onsubmit={changePassword}>
				<label class="block text-sm text-bone/60">Current password
					<input class={field} type="password" bind:value={currentPassword} required autocomplete="current-password" />
				</label>
				<label class="block text-sm text-bone/60">New password
					<input class={field} type="password" bind:value={newPassword} required minlength="8" autocomplete="new-password" />
				</label>
				<div class="flex items-center gap-4">
					<button class={primary} type="submit" disabled={passwordBusy}>{passwordBusy ? 'Changing…' : 'Change password'}</button>
					{#if passwordMessage}<span class="text-sm {passwordMessage.ok ? 'text-emerald-300' : 'text-red-400'}">{passwordMessage.text}</span>{/if}
				</div>
			</form>
		</section>
	{/if}

	<section>
		<div class="flex items-center justify-between gap-4">
			<h2 class="text-lg font-medium">Active sessions</h2>
			{#if sessions.length > 1}<button class={secondary} onclick={revokeOthers}>Sign out other devices</button>{/if}
		</div>
		<ul class="mt-4 divide-y divide-white/6 rounded-xl border border-white/10 bg-ink-2 text-sm">
			{#each sessions as row (row.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3">
					<div class="min-w-0">
						<p>{describe(row)}{#if row.token === data.sessionToken} <span class="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">This device</span>{/if}</p>
						<p class="text-xs text-bone/40">{row.ipAddress ?? 'Unknown IP'} · Signed in {new Date(row.createdAt).toLocaleString()}</p>
					</div>
					{#if row.token !== data.sessionToken}<button class={secondary} onclick={() => revoke(row.token)}>Revoke</button>{/if}
				</li>
			{:else}
				<li class="px-4 py-3 text-bone/60">Loading…</li>
			{/each}
		</ul>
		{#if sessionError}<p class="mt-3 text-sm text-red-400">{sessionError}</p>{/if}
	</section>

	<section class="flex flex-wrap items-center gap-3">
		<a class={secondary} href="/logout">Sign out</a>
		<a class="text-sm text-bone/60 hover:text-bone" href="/privacy">Privacy policy</a>
	</section>
</div>
