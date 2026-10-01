<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Scene3D from './Scene3D.svelte';
	let step = $state(0);
	let autoCycle = $state(true);
	let shape = $state('cube');
	let colorIdx = $state(0);
	let seen = $state(false);
	let stage: HTMLDivElement;
	const steps = ['Objeto vacío', 'Añade forma', 'Hazlo agarrable', 'Play en Kithin'];
	const shapes = [{id:'cube',label:'Cubo'},{id:'torus',label:'Aro'},{id:'camera',label:'Cámara'}];
	const colors = ['#FFCF7A','#8FF0CF','#FF7A45','#9B8CFF'];
	$effect(() => {
		if (!seen || !autoCycle) return;
		const id = window.setInterval(() => step = (step + 1) % steps.length, 2400);
		return () => window.clearInterval(id);
	});
	onMount(() => {
		const observer = new IntersectionObserver(([entry]) => seen = entry.isIntersecting, { threshold: .3 });
		if (stage) observer.observe(stage);
		return () => observer.disconnect();
	});
	function selectStep(i:number) { autoCycle = false; step = i; }
	function selectShape(id:string) { autoCycle = false; shape = id; if (step === 0) step = 1; }
	function selectColor(i:number) { autoCycle = false; colorIdx = i; if (step === 0) step = 1; }
	function togglePhysics() { autoCycle = false; step = step >= 2 ? 1 : 2; }
</script>
<section id="crear" class="relative overflow-hidden px-5 py-[111.5px] sm:px-8">
	<div class="pointer-events-none absolute inset-0" style="background:radial-gradient(60% 50% at 80% 10%,rgba(255,207,122,.1),transparent 70%)"></div>
	<div class="relative mx-auto max-w-[1120px]">
		<div class="grid gap-14 lg:grid-cols-[.82fr_1.18fr] lg:items-center">
			<div>
				<span class="font-display text-[10px] tracking-[.2em] text-glow uppercase">Crear</span>
				<h2 class="mt-5 font-display text-balance text-[clamp(2.1rem,6vw,4.4rem)] leading-[.98] font-medium tracking-[-.035em]">¿No existe? <span class="text-glow">Hazlo.</span></h2>
				<p class="mt-6 max-w-md text-base leading-relaxed text-bone/55">No necesitas crear un videojuego entero.</p>
				<ul class="mt-5 space-y-1.5 font-display text-[clamp(1.05rem,2.2vw,1.5rem)] tracking-tight text-bone/85"><li>Haz una cámara.</li><li>Una mascota.</li><li>Una baraja.</li><li>Una puerta absurda.</li><li>Un instrumento.</li><li>Un minijuego.</li></ul>
				<p class="mt-5 font-display text-[clamp(1.05rem,2.2vw,1.5rem)] tracking-tight text-glow">O un mundo entero.</p>
				<div class="mt-9 flex flex-wrap gap-3"><a class="rounded-full bg-glow px-5 py-3 font-display text-sm font-medium text-ink" href={resolve('/studio')}>Abrir Studio</a><a class="rounded-full border border-white/20 px-5 py-3 font-display text-sm" href={resolve('/play')}>Probar en el navegador</a></div>
			</div>
			<div>
				<div bind:this={stage} class="overflow-hidden rounded-3xl border border-white/12 bg-ink-2 shadow-[0_30px_90px_-35px_rgba(0,0,0,.9)]">
					<div class="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full bg-glow/80"></span><span class="font-display text-[11px] tracking-[.24em] text-bone/60 uppercase">Kithin Studio · 3D</span></div><div class="flex items-center gap-1.5"><span class="hidden rounded-md bg-white/8 px-2.5 py-1 font-display text-[10px] text-bone/75 sm:inline-block">Simple</span><span class="hidden rounded-md px-2 py-1 font-display text-[10px] text-bone/35 sm:inline-block">Advanced</span><button class={`ml-1 rounded-lg px-3.5 py-1 font-display text-[11px] font-medium transition ${step===3?'bg-mint text-ink':'bg-white/12 text-bone hover:bg-white/20'}`} onclick={()=>selectStep(step===3?2:3)}>{step===3?'■ Stop':'▶ Play'}</button></div></div>
					<div class="grid grid-cols-1 text-[11px] sm:grid-cols-[145px_1fr_175px]">
						<aside class="hidden border-r border-white/8 p-3 sm:block"><p class="mb-2 font-display text-[9px] tracking-[.22em] text-bone/35 uppercase">escena</p><ul class="space-y-1.5 text-bone/65"><li class="rounded-md bg-white/8 px-2 py-1 text-bone/95">◈ Mi cosa</li><li class="px-2 py-1 transition-opacity" style={`opacity:${step>=1?1:.2}`}>└ ▢ Mesh ({shapes.find(s=>s.id===shape)?.label})</li><li class="px-2 py-1 text-mint transition-opacity" style={`opacity:${step>=2?1:.2}`}>└ ✋ Grabbable</li><li class="px-2 py-1 text-glow transition-opacity" style={`opacity:${step>=2?1:.2}`}>└ ⚡ PhysicsBody</li></ul></aside>
						<div class="relative h-[255px] overflow-hidden sm:h-[290px]" style={`background:${step===3?'radial-gradient(80% 80% at 50% 20%,#2d1b42,#090812)':'linear-gradient(180deg,#10101b 0%,#090910 100%)'}`}><Scene3D variant={`editor-${shape}-${colorIdx}`} progress={step}/>{#if step===2}<span class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-mint/90 px-3 py-0.5 font-display text-[10px] text-ink uppercase shadow-lg">✋ componente Grabbable activo</span>{/if}<div class="pointer-events-none absolute bottom-2.5 left-3 rounded-full border border-white/10 bg-ink/70 px-2.5 py-0.5 font-display text-[10px] tracking-[.2em] text-bone/60 uppercase backdrop-blur">{step===3?'en Kithin · probándolo en vivo':`${step+1}/4 · ${steps[step]}`}</div></div>
						<aside class="border-t border-white/8 p-3 sm:border-t-0 sm:border-l"><p class="mb-2.5 font-display text-[9px] tracking-[.22em] text-bone/35 uppercase">propiedades</p><div class="space-y-2.5"><div><span class="block text-[10px] text-bone/45">forma 3D</span><div class="mt-1 flex gap-1">{#each shapes as item}<button class={`flex-1 rounded-md py-1 font-display text-[10px] ${shape===item.id?'bg-white/15 text-bone':'bg-white/[.04] text-bone/45'}`} onclick={()=>selectShape(item.id)}>{item.label}</button>{/each}</div></div><div><span class="block text-[10px] text-bone/45">color</span><div class="mt-1 flex gap-1.5">{#each colors as color,i}<button class={`h-4 w-4 rounded-full transition-transform ${colorIdx===i?'scale-125 ring-2 ring-white':'opacity-65'}`} style={`background:${color}`} aria-label={`Color ${i+1}`} onclick={()=>selectColor(i)}></button>{/each}</div></div>{#each ['agarrable','con física'] as label}<button class="flex w-full items-center justify-between rounded-md bg-white/[.04] px-2 py-1.5 text-left" onclick={togglePhysics}><span class="text-bone/55">{label}</span><span class={`relative h-4 w-8 rounded-full ${step>=2?'bg-mint':'bg-white/15'}`}><span class="absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-all" style={`left:${step>=2?'18px':'2px'}`}></span></span></button>{/each}</div></aside>
					</div>
					<div class="flex gap-1 border-t border-white/8 bg-ink/40 p-2">{#each steps as label,i}<button class={`flex-1 rounded-lg px-2 py-1.5 font-display text-[10px] tracking-wide transition ${step===i?'bg-white/12 text-bone':'text-bone/35 hover:text-bone/70'}`} onclick={()=>selectStep(i)}>{i+1}. {label}</button>{/each}</div>
				</div>
				<p class="mt-6 font-display text-[clamp(1.15rem,2.4vw,1.65rem)] tracking-tight text-balance">Empieza simple. Llega hasta donde quieras.</p>
				<div class="mt-5 grid gap-3 sm:grid-cols-2"><div class="rounded-xl border border-white/10 bg-white/[.025] p-4"><p class="font-display text-[13px] tracking-[.2em] text-bone/80 uppercase">Simple</p><p class="mt-1.5 text-[13.5px] leading-relaxed text-bone/50">Propiedades visuales y componentes listos para usar.</p></div><div class="rounded-xl border border-white/10 bg-white/[.025] p-4"><p class="font-display text-[13px] tracking-[.2em] text-bone/80 uppercase">Advanced</p><p class="mt-1.5 text-[13.5px] leading-relaxed text-bone/50">Código, componentes avanzados, JSON…</p></div></div>
				<p class="mt-4 text-[12.5px] text-bone/35">Pulsas Crear y ya estás creando. Directo en Kithin, sin instalar nada externo.</p>
			</div>
		</div>
	</div>
</section>
