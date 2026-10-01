<script lang="ts">
	import Scene3D from './Scene3D.svelte';
	const controls = $state([
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0 },
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0 },
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0 },
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0, equipped: false },
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0 },
		{ down: false, clicks: 0, color: 0, playing: false, mode: 0 }
	]);
	const cards = $derived([
		{ title: 'Pincel', badge: '3D', hint: 'coger · gatillo · pinta', scene: 'card-brush', controls: controls[0] },
		{ title: 'Disco', badge: '3D', hint: 'coger · colocar · música', scene: 'card-disc', controls: controls[1] },
		{ title: 'Botón', badge: '3D', hint: 'empujar físicamente', scene: 'card-button', controls: controls[2] },
		{ title: 'Cámara equipada', badge: '3D', hint: 'controles propios', scene: 'card-camera', controls: controls[3] },
		{ title: 'Juego', badge: '3D', hint: 'física + marcador', scene: 'card-game', controls: controls[4] },
		{ title: 'Orbe', badge: '3D', hint: 'otro mundo dentro', scene: 'card-orb', controls: controls[5] }
	]);
	const sceneBackground = (scene: string) => ({
		'card-brush': 'bg-[radial-gradient(80%_80%_at_30%_20%,rgba(255,207,122,0.16),rgba(7,7,12,0.95)_75%)]',
		'card-disc': 'bg-[radial-gradient(80%_80%_at_70%_20%,rgba(155,140,255,0.2),rgba(7,7,12,0.95)_75%)]',
		'card-button': 'bg-[radial-gradient(80%_80%_at_50%_30%,rgba(143,240,207,0.18),rgba(7,7,12,0.95)_75%)]',
		'card-camera': 'bg-[radial-gradient(80%_80%_at_40%_25%,rgba(110,195,255,0.18),rgba(7,7,12,0.95)_75%)]',
		'card-game': 'bg-[radial-gradient(80%_80%_at_60%_25%,rgba(255,122,69,0.18),rgba(7,7,12,0.95)_75%)]',
		'card-orb': 'bg-[radial-gradient(80%_80%_at_50%_25%,#3b2a6b,#080614)]'
	} as Record<string, string>)[scene];
</script>

<section class="relative px-5 py-[132.5px] sm:px-8">
	<div class="mx-auto max-w-[1120px]">
		<span class="rounded-full border border-mint/25 bg-mint/5 px-3 py-1 font-display text-[10px] tracking-[.2em] text-mint uppercase">Todo hace algo</span>
		<h2 class="mt-5 font-display text-balance text-[clamp(2.1rem,6vw,4.4rem)] leading-[.98] font-medium tracking-[-.035em]">Tócalo.</h2>
		<p class="mt-5 max-w-lg text-base leading-relaxed text-bone/55">En Kithin, las cosas no están ahí simplemente para decorar. Aquí tampoco: cada uno de estos objetos está en 3D real. Tócalos.</p>
		<div class="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{#each cards as card}
				<article class="group relative flex flex-col overflow-hidden rounded-3xl border border-white/12 bg-white/[0.025] transition-all duration-300 hover:border-white/30 hover:shadow-[0_24px_60px_-25px_rgba(0,0,0,0.85)]">
					<div class={`relative h-[235px] w-full overflow-hidden ${sceneBackground(card.scene)}`}>
						<Scene3D variant={card.scene} controls={card.controls} />
						{#if card.scene === 'card-brush'}
							<div class="absolute top-3 left-3 z-10 flex gap-1.5 rounded-full border border-white/12 bg-ink/70 p-1.5 backdrop-blur">
								{#each ['#ffcf7a', '#8ff0cf', '#ff7a45', '#9b8cff'] as color, i}
									<button class={`h-4 w-4 rounded-full transition-transform ${card.controls.color === i ? 'scale-125 ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`} style={`background:${color}`} aria-label={`Brush color ${i + 1}`} onclick={(event) => { event.stopPropagation(); card.controls.color = i; }}></button>
								{/each}
							</div>
						{/if}
						{#if card.scene === 'card-camera' && card.controls.equipped}
							<div class="absolute inset-x-3 bottom-3 z-10 flex gap-1 rounded-xl border border-white/15 bg-ink/80 p-1.5 backdrop-blur-md">
								{#each ['foto', 'vídeo', 'espejo'] as mode, i}
									<button class={`flex-1 rounded-lg px-2 py-1 font-display text-[11px] capitalize ${card.controls.mode === i ? 'bg-sky text-ink' : 'bg-white/5 text-bone/65'}`} onclick={(event) => { event.stopPropagation(); card.controls.mode = i; }}>{mode}</button>
								{/each}
								<button class="rounded-lg bg-ember px-2.5 py-1 text-[11px] text-ink" onclick={(event) => { event.stopPropagation(); card.controls.flash = 1; }}>📸</button>
							</div>
						{/if}
						{#if card.scene === 'card-game'}
							<div class="pointer-events-none absolute top-3.5 left-3.5 w-[132px] rounded-2xl border border-white/15 bg-ink/80 p-2.5 font-display backdrop-blur-md">
								<div class="mb-1.5 flex items-center justify-between text-[9px] tracking-[.24em] text-bone/45 uppercase"><span>marcador</span><span class="h-1.5 w-1.5 rounded-full bg-mint"></span></div>
								<div class="flex items-center justify-between py-0.5 text-[13px]"><span class="tracking-wider text-bone/75 uppercase">fer</span><span class="font-medium tabular-nums text-glow">3</span></div>
								<div class="flex items-center justify-between py-0.5 text-[13px]"><span class="tracking-wider text-bone/75 uppercase">sami</span><span class="font-medium tabular-nums text-glow">2</span></div>
							</div>
						{/if}
						<span class="absolute right-3 top-3 rounded-full border border-white/10 bg-ink/65 px-2.5 py-1 font-display text-[9px] tracking-[.16em] text-glow uppercase backdrop-blur">{card.badge}</span>
						<span class="pointer-events-none absolute bottom-2.5 left-3.5 rounded-full border border-white/10 bg-ink/70 px-2.5 py-0.5 font-display text-[10px] tracking-[.2em] text-bone/45 uppercase backdrop-blur">{card.hint}</span>
					</div>
					<div class="flex items-baseline justify-between gap-3 border-t border-white/8 bg-ink/40 px-4 py-3.5">
						<div class="flex items-center gap-2"><span class="font-display text-[15px] font-medium tracking-tight">{card.title}</span><span class="rounded-full bg-white/8 px-2 py-0.5 font-display text-[9px] tracking-[.18em] text-bone/60 uppercase">{card.badge}</span></div>
						<span class="font-display text-[10px] tracking-[.2em] text-bone/45 uppercase">{card.hint}</span>
					</div>
				</article>
			{/each}
		</div>
		<p class="mt-16 text-center font-display text-[clamp(1.5rem,4.5vw,3rem)] tracking-[-.035em]">No preguntes qué es. <span class="text-mint">Cógelo.</span></p>
	</div>
</section>
