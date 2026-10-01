<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import Carry from '$lib/landing/Carry.svelte';
	import PeopleThings from '$lib/landing/PeopleThings.svelte';
	import Orb from '$lib/landing/Orb.svelte';
	import Touch from '$lib/landing/Touch.svelte';
	import Closing from '$lib/landing/Closing.svelte';
	import Create from '$lib/landing/Create.svelte';
	import Scene3D from '$lib/landing/Scene3D.svelte';

	let menuOpen = $state(false);
	let scrollY = $state(0);
	let peerPhase = $state(0);
	let vr = $state(false);
	let socialStep = $state(0);
	let socialAuto = $state(true);
	let socialSeen = $state(false);
	let copied = $state(false);
	let whosInOpen = $state(false);
	const progressAt = (id: string, y: number) => {
		if (typeof document === 'undefined') return 0;
		const element = document.getElementById(id);
		if (!element) return 0;
		const top = window.scrollY + element.getBoundingClientRect().top;
		return Math.max(0, Math.min(1, (y - top) / Math.max(1, element.offsetHeight - window.innerHeight)));
	};
	let carryP = $derived(progressAt('carry-scroll', scrollY));
	let peopleP = $derived(progressAt('people-scroll', scrollY));
	let orbP = $derived(progressAt('orb-scroll', scrollY));
	let closingP = $derived(progressAt('closing-scroll', scrollY));
	$effect(() => {
		if (!socialAuto || !socialSeen) return;
		const timer = window.setInterval(() => socialStep = (socialStep + 1) % 4, 2200);
		return () => window.clearInterval(timer);
	});

	onMount(() => {
		void studioSession.init();
		const onScroll = () => scrollY = window.scrollY;
		window.addEventListener('scroll', onScroll, { passive: true });
		const socialNode = document.getElementById('social-story');
		const socialObserver = socialNode ? new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) { socialStep = 0; socialSeen = true; }
			else socialSeen = false;
		}, { threshold: .3 }) : undefined;
		if (socialNode) socialObserver?.observe(socialNode);
		return () => { window.removeEventListener('scroll', onScroll); socialObserver?.disconnect(); };
	});
</script>

<svelte:head>
	<title>Kithin — Estás hecho de lo que te rodea</title>
	<meta name="description" content="Un lugar para estar con gente, descubrir cosas y llevártelas contigo. Se abre en el navegador, con o sin gafas." />
</svelte:head>

<div class="min-h-screen bg-ink text-bone antialiased">
	<header class={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${scrollY > 40 ? 'border-b border-white/6 bg-ink/75 py-3 backdrop-blur-xl' : 'bg-transparent py-5'}`}>
		<div class="mx-auto flex max-w-[1240px] items-center justify-between px-5 sm:px-8">
			<a href="#top" class="group flex items-center gap-2.5" aria-label="Kithin, inicio">
				<img src="/assets/kithin-logo.svg" alt="Kithin" class="h-7 w-auto" />
			</a>
			<button class="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-bone md:hidden" aria-label="Abrir menú" aria-expanded={menuOpen} onclick={() => menuOpen = !menuOpen}>
				<span class="text-lg">{menuOpen ? '×' : '☰'}</span>
			</button>
			<nav class={`${menuOpen ? 'flex' : 'hidden'} absolute inset-x-4 top-16 flex-col gap-4 rounded-2xl border border-white/10 bg-ink/95 p-5 text-sm text-bone/70 shadow-2xl backdrop-blur-xl md:static md:flex md:flex-row md:items-center md:gap-9 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
				<a class="transition hover:text-bone" href="#descubrir" onclick={() => menuOpen = false}>Discover</a>
				<a class="transition hover:text-bone" href="#crear" onclick={() => menuOpen = false}>Create</a>
				<a class="transition hover:text-bone" href="#sobre" onclick={() => menuOpen = false}>About</a>

				<a class="rounded-full bg-bone px-4 py-2 font-medium text-ink transition hover:bg-glow" href={resolve('/play')}>Entrar ahora <span aria-hidden="true">↗</span></a>
			</nav>
		</div>
	</header>

	<main>
		<section id="top" class="grain relative flex min-h-[100svh] flex-col overflow-hidden">
			<div class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_48%,rgba(155,140,255,0.12),transparent_55%),radial-gradient(ellipse_at_50%_88%,rgba(255,122,69,0.1),transparent_42%)]"></div>
			<Scene3D variant="hero" />
			<div class="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(55%_48%_at_50%_46%,rgba(7,7,12,0.58)_0%,rgba(7,7,12,0.2)_65%,rgba(7,7,12,0.78)_100%)]"></div>
			<div class="pointer-events-none absolute inset-0 z-[2] mx-auto hidden max-w-[1180px] md:block" style={`opacity:${Math.max(0, 1 - scrollY / 560)}`}><div class="absolute left-[11%] top-[36%] rounded-full border border-glow/25 bg-ink/65 px-3.5 py-1.5 font-display text-[11px] tracking-[0.16em] text-glow/90 backdrop-blur-md">“Eh, mira esto.”</div></div>
			<div class="pointer-events-none relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-28 pb-20 text-center" style={`opacity:${Math.max(0, 1 - scrollY / 560)};transform:translateY(${scrollY * 0.1}px)`}>
				<h1 class="font-display text-[clamp(3.4rem,13vw,10.5rem)] leading-[0.85] font-medium tracking-[-0.055em] drop-shadow-[0_12px_40px_rgba(0,0,0,0.8)]">KITHIN</h1>
				<p class="mt-7 font-display text-[clamp(1.35rem,3.4vw,2.4rem)] leading-tight tracking-[-0.03em] text-balance">Estás hecho de lo que te rodea.</p>
				<p class="mt-5 max-w-md text-[15px] leading-relaxed text-bone/65 text-balance">Un lugar para estar con gente, descubrir cosas y llevártelas contigo.</p>
				<div class="pointer-events-auto mt-10 flex flex-col items-center gap-3 sm:flex-row"><a class="inline-flex items-center gap-3 rounded-full bg-bone px-6 py-3 font-display text-sm font-medium text-ink shadow-[0_0_28px_rgba(255,207,122,0.2)] transition hover:scale-[1.03]" href={resolve('/play')}>Entrar en Kithin <span>→</span></a><a class="rounded-full border border-white/20 bg-white/5 px-6 py-3 font-display text-sm transition hover:bg-white/10" href="#crear">Crear algo</a></div>
				<p class="mt-9 font-display text-[11px] tracking-[0.26em] text-bone/45 uppercase">Sin descargas · No necesitas cuenta · PC + VR</p>
			</div>
			<div class="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-bone/35"><svg width="20" height="30" viewBox="0 0 20 30" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="1" width="18" height="28" rx="9"/><circle cx="10" cy="9" r="2.2" fill="currentColor" stroke="none" class="anim-breathe"/></svg></div>
		</section>

		<Carry p={carryP} />
		<PeopleThings p={peopleP} />

		<Orb p={orbP} />

		<Touch />

		<Create />
		<section class="px-5 py-[108.5px] sm:px-8">
			<div class="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-2"><div><span class="font-display text-[10px] tracking-[0.2em] text-sky uppercase">Cómo ocurre</span><h2 class="mt-5 font-display text-balance text-[clamp(2.1rem,6vw,4.4rem)] leading-[.98] font-medium tracking-[-.035em]">Tu mundo ocurre <span class="text-sky">entre vosotros.</span></h2><p class="mt-6 max-w-md text-base leading-relaxed text-bone/55">Cuando entras con alguien, Kithin hace las presentaciones.</p><p class="mt-4 max-w-md text-base leading-relaxed text-bone/55">Después, vuestros dispositivos hablan directamente. La posición, las interacciones y la voz no necesitan pasar continuamente por un servidor que esté alojando vuestro mundo.</p><p class="mt-10 font-display text-[clamp(1.3rem,3.2vw,2.2rem)] leading-tight tracking-[-0.035em]">Nosotros abrimos la puerta.<br/>El mundo ocurre entre vosotros.</p><p class="mt-6 font-display text-[11px] tracking-[0.3em] text-bone/35 uppercase">Peer-to-peer · WebRTC</p></div><div class="relative overflow-hidden rounded-3xl border border-white/12 bg-white/[0.02] p-4 shadow-[0_35px_90px_-35px_rgba(0,0,0,0.9)]"><div class="mb-3 flex items-center justify-between gap-2"><div class="flex gap-1.5 rounded-full border border-white/10 bg-ink/70 p-1"><button class={`rounded-full px-3 py-1 font-display text-[10px] tracking-wider uppercase ${peerPhase===0?'bg-glow text-ink':'text-bone/45'}`} onclick={() => peerPhase=0}>1. Os pone en contacto</button><button class={`rounded-full px-3 py-1 font-display text-[10px] tracking-wider uppercase ${peerPhase===1?'bg-mint text-ink':'text-bone/45'}`} onclick={() => peerPhase=1}>2. Directo entre vosotros</button></div><span class="hidden font-display text-[10px] tracking-[.22em] text-bone/35 uppercase sm:inline">{peerPhase===0?'signaling':'mesh p2p'}</span></div><div class="relative h-[340px] overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(75%_75%_at_50%_25%,rgba(110,195,255,0.14),rgba(7,7,12,0.96)_80%)]"><Scene3D variant="peers" progress={peerPhase}/><div class="absolute left-[20%] top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-ink/70 px-3 py-1.5 text-[9px] tracking-[0.15em] text-bone/65">TÚ</div><div class="absolute right-[20%] top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-ink/70 px-3 py-1.5 text-[9px] tracking-[0.15em] text-bone/65">AMIGA</div></div></div></div>
		</section>

		<section class="relative overflow-hidden border-y border-white/5 bg-ink-2/50 px-5 py-[107.5px] sm:px-8">
			<div class="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-2"><div><span class="font-display text-[10px] tracking-[0.2em] text-iris uppercase">Dentro</span><h2 class="mt-5 font-display text-balance text-[clamp(2.1rem,6vw,4.4rem)] leading-[.98] font-medium tracking-[-.035em]">¿Tienes gafas? <span class="text-iris">Póntelas.</span></h2><p class="mt-6 max-w-md text-base leading-relaxed text-bone/55">Kithin funciona con teclado y ratón.</p><p class="mt-3 max-w-md text-base leading-relaxed text-bone/55">Y si tienes unas gafas compatibles, puedes entrar directamente en VR. El mismo lugar, con la misma gente y las mismas cosas.</p><div class="mt-8 flex flex-wrap gap-2.5"><span class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.03] px-4 py-2 font-display text-[13px]"><b class="text-mint">✓</b> Desktop</span><span class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.03] px-4 py-2 font-display text-[13px]"><b class="text-mint">✓</b> Meta Quest</span><span class="inline-flex items-center gap-2 rounded-full border border-white/8 px-4 py-2 font-display text-[13px] text-bone/35">· More to come</span></div><p class="mt-8 text-[13.5px] leading-relaxed text-bone/40">Kithin es Kithin. VR es una forma de estar dentro.</p></div><div class="relative aspect-[16/10] overflow-hidden rounded-3xl border border-white/15 bg-ink-2 shadow-[0_35px_90px_-35px_rgba(0,0,0,0.9)]"><div class={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-ink/85 px-3.5 py-2 backdrop-blur transition-all duration-500 ${vr?'opacity-0 -translate-y-full':''}`}><div class="flex items-center gap-1.5"><i class="h-2.5 w-2.5 rounded-full bg-white/15"></i><i class="h-2.5 w-2.5 rounded-full bg-white/15"></i><span class="ml-2 font-display text-[10px] tracking-[.2em] text-bone/45 uppercase">kithin.app / jardín-tibio</span></div><span class="font-display text-[10px] tracking-[.2em] text-mint/80 uppercase">60 FPS · Desktop</span></div><button class="absolute inset-0 z-10" aria-label="Entrar o salir de VR" onclick={() => vr=!vr}></button><Scene3D variant="vr" progress={vr ? 1 : 0}/><div class="pointer-events-none absolute inset-0 z-10 transition-opacity duration-500" style={`opacity:${vr?0:1}`}><span class="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60 shadow-[0_0_8px_#fff]"></span><div class="absolute right-3.5 bottom-3.5 rounded-lg border border-white/12 bg-ink/75 px-3 py-1.5 font-display text-[10px] tracking-[.18em] text-bone/60 uppercase backdrop-blur">WASD · ratón</div></div><div class="pointer-events-none absolute inset-0 z-10 transition-opacity duration-500" style={`opacity:${vr?1:0}`}><div class="absolute inset-0" style="background:radial-gradient(62% 72% at 50% 50%,transparent 58%,rgba(4,4,8,.88) 100%)"></div><div class="absolute top-3.5 left-1/2 -translate-x-1/2 rounded-full border border-iris/40 bg-ink/75 px-3.5 py-1 font-display text-[10px] tracking-[.22em] text-iris uppercase backdrop-blur">VR activo · manos 3D en el mismo espacio</div></div><span class="absolute right-4 bottom-4 rounded-full border border-white/10 bg-ink/70 px-3 py-1 font-display text-[9px] tracking-[0.16em] text-iris uppercase">PC + WebXR</span><button class={`absolute -bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full px-7 py-3 font-display text-[13.5px] font-medium tracking-tight shadow-[0_20px_40px_-15px_rgba(0,0,0,.95)] transition-all ${vr?'border border-white/20 bg-ink/90 text-bone':'bg-bone text-ink'}`} onclick={()=>vr=!vr}>{vr?'← Volver a teclado y ratón':'Enter VR ⟶'}</button></div></div>
		</section>

		<section id="social-story" class="px-5 py-[108px] sm:px-8">
			<div class="mx-auto grid max-w-[1120px] items-center gap-14 lg:grid-cols-2"><div><span class="font-display text-[10px] tracking-[0.2em] text-mint uppercase">Con gente</span><h2 class="mt-5 font-display text-balance text-[clamp(2.1rem,6vw,4.4rem)] leading-[.98] font-medium tracking-[-.035em]">Mejor con gente alrededor.</h2><p class="mt-6 max-w-md text-base leading-relaxed text-bone/55">Abre tu mundo. Pasa el código. Ya están dentro.</p><div class="mt-9 flex flex-wrap items-center gap-3"><div class="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-5 py-3.5">{#each [...'K7TH'] as c,i}<span class="font-display text-[26px] leading-none font-medium tracking-[.1em] text-glow" style={`animation:breathe ${2+i*.3}s ease-in-out infinite`}>{c}</span>{/each}</div><button class="rounded-full border border-white/20 px-5 py-3 font-display text-[13px] tracking-tight transition-colors hover:bg-white/8" onclick={async()=>{await navigator.clipboard?.writeText('K7TH').catch(()=>{});copied=true;setTimeout(()=>copied=false,1600)}}>{copied?'copiado ✓':'copiar código'}</button></div><ul class="mt-9 space-y-2">{#each [{label:'Abres tu mundo',detail:'código K7TH'},{label:'Pasas el código',detail:'enlace, mensaje o en voz alta'},{label:'Ya están dentro',detail:'aparecen al instante'},{label:'Voz espacial',detail:'habláis estando allí'}] as step,i}<li><button class={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${socialStep===i?'border-mint/45 bg-mint/[0.08]':'border-white/8 hover:border-white/20'}`} onclick={()=>{socialAuto=false;socialStep=i}}><span class={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-[11px] ${socialStep===i?'bg-mint text-ink':'bg-white/8 text-bone/40'}`}>{i+1}</span><span class="font-display text-sm tracking-tight">{step.label}</span><span class="ml-auto text-xs text-bone/45">{step.detail}</span></button></li>{/each}</ul></div><div class="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/12 bg-[radial-gradient(80%_70%_at_50%_15%,#1d3040,#0a0e16_60%,#06070c)] shadow-[0_35px_90px_-35px_rgba(0,0,0,0.9)]"><Scene3D variant="social" progress={socialStep}/><div class="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-2xl border border-white/15 bg-ink/80 px-5 py-2.5 text-center backdrop-blur-md"><p class="font-display text-[9px] tracking-[.28em] text-bone/45 uppercase">{socialStep===0?'código de sala':socialStep===1?'compartiendo código…':socialStep===2?'sami se ha unido':'voz espacial activa'}</p><p class="mt-0.5 font-display text-[20px] tracking-[.18em] text-glow">K7TH</p></div><div class="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"><button class="flex items-center gap-2.5 rounded-full border border-white/15 bg-ink/80 px-4 py-2 font-display text-[14px] tracking-tight text-bone/90 backdrop-blur-md transition-all hover:border-mint/50" onclick={()=>whosInOpen=!whosInOpen}><span class="flex -space-x-1.5"><span class="h-3.5 w-3.5 rounded-full bg-glow ring-2 ring-ink"></span>{#if socialStep>=2}<span class="h-3.5 w-3.5 rounded-full bg-mint ring-2 ring-ink"></span>{/if}</span><span>Who’s in?</span><span class="text-[11px] text-bone/45">{socialStep>=2?'2':'1'}</span></button>{#if whosInOpen}<div class="absolute bottom-12 left-1/2 w-[210px] -translate-x-1/2 rounded-2xl border border-white/15 bg-ink/95 p-3 text-left font-display text-[12px] shadow-2xl backdrop-blur-xl"><div class="mb-2 text-[9px] tracking-[.24em] text-bone/40 uppercase">Ahora en K7TH</div><div class="flex items-center justify-between py-1"><span class="flex items-center gap-2"><i class="h-2 w-2 rounded-full bg-glow"></i>Fer (tú)</span><span class="text-[10px] text-bone/40">host</span></div><div class="flex items-center justify-between py-1"><span class="flex items-center gap-2"><i class={`h-2 w-2 rounded-full ${socialStep>=2?'bg-mint':'bg-white/20'}`}></i>Sami</span><span class="text-[10px] text-mint/80">{socialStep>=2?'dentro':'entrando…'}</span></div></div>{/if}</div></div></div>
		</section>

		<Closing p={closingP} />
	</main>

	<footer id="sobre" class="relative border-t border-white/8 px-5 py-16 sm:px-8"><div class="mx-auto grid max-w-[1100px] gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]"><div><div class="flex items-center gap-2.5"><img src="/assets/kithin-logo.svg" alt="Kithin" class="h-7 w-auto"/></div><p class="mt-4 max-w-xs text-[13.5px] leading-relaxed text-bone/40">Un lugar para estar con gente, descubrir cosas y llevártelas contigo. Se abre en el navegador, con o sin gafas.</p><p class="mt-5 font-display text-[10px] tracking-[0.3em] text-bone/25 uppercase">Peer-to-peer · WebRTC · WebXR</p></div>{#each [{title:'Entrar',items:[['Entrar ahora','/play'],['Descubrir','#descubrir'],['Con un código','/play']]},{title:'Hacer',items:[['Abrir Studio','/studio'],['Cosas','#descubrir'],['Lugares','#descubrir']]},{title:'Sobre esto',items:[['Qué es Kithin','#top'],['Cómo funciona','#descubrir'],['Contacto','mailto:hola@kithin.world']]}] as col}<div><p class="font-display text-[11px] tracking-[0.26em] text-bone/45 uppercase">{col.title}</p><ul class="mt-4 space-y-2.5">{#each col.items as item}<li><a class="text-sm text-bone/55 transition-colors hover:text-bone" href={item[1]}>{item[0]}</a></li>{/each}</ul></div>{/each}</div><div class="mx-auto mt-14 flex max-w-[1100px] flex-col items-center justify-between gap-3 border-t border-white/8 pt-7 sm:flex-row"><p class="text-xs text-bone/30">© {new Date().getFullYear()} Kithin</p><p class="font-display text-[12.5px] tracking-[0.18em] text-bone/35">Who’s in?</p></div></footer>
</div>

<style>
	.scene-grid{background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:28px 28px;transform:perspective(260px) rotateX(34deg) scale(1.3);transform-origin:bottom}.editor-ring{position:absolute;width:138px;height:95px;border:1px solid rgba(255,207,122,.65);border-radius:50%;transform:rotate(-22deg);box-shadow:0 0 35px rgba(255,207,122,.15)}.editor-shape{position:absolute;width:65px;height:65px;background:linear-gradient(145deg,#bcb4ff,#554b88);clip-path:polygon(50% 0,95% 26%,81% 83%,49% 100%,12% 78%,3% 25%);filter:drop-shadow(0 0 22px rgba(155,140,255,.5));animation:floaty 6s ease-in-out infinite}
	@media(prefers-reduced-motion:reduce){:global(*),:global(*::before),:global(*::after){animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
</style>
