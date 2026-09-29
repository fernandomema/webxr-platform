<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import Icon from '$lib/studio/ui/Icon.svelte';

	onMount(() => {
		void studioSession.init();
	});

	const features: Array<{ icon: import('$lib/studio/ui/Icon.svelte').IconName; title: string; body: string }> = [
		{
			icon: 'world',
			title: 'Peer-to-peer worlds',
			body: 'Every visitor connects straight to the host over WebRTC. The server only handles rendezvous — no world ever lives on our machines.'
		},
		{
			icon: 'cube',
			title: 'Build in VR or on the web',
			body: 'The Studio editor runs right in the browser: templates, a scene tree and an inspector to shape objects and worlds without leaving the tab.'
		},
		{
			icon: 'command',
			title: 'Grab, equip, play',
			body: 'Pick objects up by hand or with the laser, equip them from the radial menu, and jump into a session with friends in one click.'
		}
	];
</script>

<svelte:head>
	<title>WebXR Platform</title>
	<meta
		name="description"
		content="A peer-to-peer WebXR platform: host your own world from the browser and build what's in it with the Studio editor."
	/>
</svelte:head>

<div class="landing">
	<header class="bar">
		<div class="brand"><Icon name="cube" size={20} /><strong>WebXR Platform</strong></div>
		<nav>
			<a class="link" href={resolve('/studio')}>Studio</a>
			{#if studioSession.userId}
				<span class="user"><Icon name="user" size={12} />{studioSession.userName ?? 'Signed in'}</span>
				<a class="link" href={resolve('/logout')}>Sign out</a>
			{:else if studioSession.ready}
				<a class="link" href={resolve('/login')}>Sign in</a>
			{/if}
			<a class="btn primary" href={resolve('/play')}>Play now</a>
		</nav>
	</header>

	<main>
		<section class="hero">
			<h1>Your own WebXR world, hosted from your browser</h1>
			<p class="lead">
				No install, no central world server. Open a room, build what's inside it with the Studio
				editor, and invite people to connect straight to you — on desktop or in a headset.
			</p>
			<div class="cta">
				<a class="btn primary lg" href={resolve('/play')}><Icon name="play" size={16} />Play now</a>
				<a class="btn ghost lg" href={resolve('/studio')}><Icon name="cube" size={16} />Open Studio</a>
			</div>
			<p class="hint">No account needed to try it — sign in later to save your worlds.</p>
		</section>

		<section class="features" aria-label="Features">
			{#each features as feature (feature.title)}
				<article class="feature">
					<span class="feature-icon"><Icon name={feature.icon} size={22} /></span>
					<h2>{feature.title}</h2>
					<p>{feature.body}</p>
				</article>
			{/each}
		</section>
	</main>

	<footer>
		<a class="link" href={resolve('/play')}>Play</a>
		<a class="link" href={resolve('/studio')}>Studio</a>
		{#if studioSession.userId}
			<a class="link" href={resolve('/logout')}>Sign out</a>
		{:else}
			<a class="link" href={resolve('/login')}>Sign in</a>
			<a class="link" href={resolve('/register')}>Create an account</a>
		{/if}
	</footer>
</div>

<style>
	.landing {
		--bg: #0e1016;
		--panel: #151821;
		--panel-2: #1b1f2b;
		--border: #272c3c;
		--text: #e7e9f0;
		--muted: #8b92a8;
		--accent: #7c6cf6;
		--accent-strong: #6a59ee;
		--accent-soft: rgb(124 108 246 / 0.16);
		--radius: 10px;
		--font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;

		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(60vw 40vh at 80% -10%, var(--accent-soft), transparent),
			var(--bg);
		color: var(--text);
		font: 15px/1.5 var(--font);
		color-scheme: dark;
	}

	.landing * { box-sizing: border-box; }
	.landing a { color: inherit; text-decoration: none; }
	.landing :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 20px clamp(16px, 4vw, 48px);
	}
	.brand { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 15px; }
	.bar nav { display: flex; align-items: center; gap: 18px; }
	.link { color: var(--muted); font-weight: 500; }
	.link:hover { color: var(--text); }
	.user {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 10px;
		border-radius: 13px;
		background: var(--panel-2);
		color: var(--muted);
		font-size: 12px;
		font-weight: 500;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
		font-weight: 600;
		white-space: nowrap;
	}
	.btn:hover { background: #232838; }
	.btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
	.btn.primary:hover { background: var(--accent-strong); }
	.btn.ghost { background: transparent; }
	.btn.lg { height: 46px; padding: 0 22px; font-size: 16px; }

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: clamp(48px, 10vh, 96px);
		padding: clamp(24px, 6vh, 64px) clamp(16px, 4vw, 48px) 0;
	}

	.hero {
		max-width: 720px;
		margin: 0 auto;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
	}
	.hero h1 { margin: 0; font-size: clamp(30px, 5vw, 48px); line-height: 1.1; letter-spacing: -0.02em; }
	.hero .lead { margin: 0; max-width: 56ch; color: var(--muted); font-size: 17px; }
	.cta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 8px; }
	.hint { margin: 0; color: var(--muted); font-size: 13px; }

	.features {
		width: 100%;
		max-width: 1040px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 16px;
	}
	.feature {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 22px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--panel);
	}
	.feature-icon {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.feature h2 { margin: 0; font-size: 16px; }
	.feature p { margin: 0; color: var(--muted); font-size: 14px; }

	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 20px;
		padding: clamp(32px, 6vh, 56px) 16px;
		margin-top: clamp(48px, 10vh, 96px);
		border-top: 1px solid var(--border);
		font-size: 13px;
	}

	@media (prefers-reduced-motion: reduce) {
		.landing * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
	}
</style>
