<script lang="ts">
	import Scene3D from './Scene3D.svelte';
	let { p = 0 }: { p?: number } = $props();
	let selected = $state('brush');
	const clamp = (v:number) => Math.min(1, Math.max(0, v));
	const map = (v:number,a:number,b:number) => clamp((v-a)/(b-a));
	const captions = [
		{from:0,to:.17,scene:'Escena 1',text:'“Hey, try this.”',sub:'Alguien está usando un pincel y te lo lanza'},
		{from:.18,to:.31,scene:'Escena 2',text:'Lo coges → pintas en el aire.',sub:'Funciona inmediatamente en tus manos'},
		{from:.32,to:.46,scene:'Escena 2',text:'Abres tus cosas → lo guardas.',sub:'Ya no está atado a esta sala'},
		{from:.47,to:.58,scene:'Escena 3',text:'Cambio radical de mundo.',sub:'Otro lugar, otra luz, otra gente'},
		{from:.59,to:.89,scene:'Escena 3',text:'Abres tus cosas → sacas el pincel → continúas pintando.',sub:'El mismo objeto, intacto, en otro mundo'}
	];
	const items=[
		{id:'brush',emoji:'🎨',label:'pincel',note:'Pinta trazos volumétricos 3D en el aire'},
		{id:'camera',emoji:'📷',label:'cámara',note:'Enfoca, saca fotos y guárdalas como objetos'},
		{id:'game',emoji:'🎲',label:'juego',note:'Física real sincronizada entre todos'},
		{id:'instrument',emoji:'🎵',label:'instrumento',note:'Suena con audio espacial según dónde estés'},
		{id:'tool',emoji:'🛠',label:'herramienta',note:'Mide, ilumina o modifica cosas in-situ'},
		{id:'weird',emoji:'❓',label:'cosa rarísima',note:'Algo que alguien inventó hace diez minutos'}
	];
	let caption=$derived(captions.find(c=>p>=c.from&&p<=c.to));
	let invOpen= $derived(map(p,.31,.36));
	let store=$derived(map(p,.34,.43));
	let invClose=$derived(map(p,.43,.47));
	let invOpen2=$derived(map(p,.58,.63));
	let retrieve=$derived(map(p,.63,.71));
	let invClose2=$derived(map(p,.71,.75));
	let inventory=$derived(Math.max(0,Math.max(invOpen-invClose,invOpen2-invClose2)));
	let brushInBag=$derived(store>.85&&retrieve<.15);
	let scene=$derived(p<.18?0:p<.47?1:2);
	const jump=(idx:number)=>{const container=document.getElementById('carry-scroll');if(!container)return;const targets=[.07,.25,.78];const rect=container.getBoundingClientRect();const top=window.scrollY+rect.top;window.scrollTo({top:top+(container.offsetHeight-window.innerHeight)*targets[idx],behavior:'smooth'});};
</script>

<section id="descubrir" class="relative">
	<div id="carry-scroll" class="relative h-[calc(440vh-8px)]">
		<div class="sticky top-0 flex h-[100svh] flex-col items-center justify-center overflow-hidden px-4">
			<div class="relative z-10 mb-4 flex w-full max-w-[980px] flex-col items-center justify-between gap-3 sm:flex-row"><h2 class="font-display text-[clamp(1.55rem,3.8vw,2.75rem)] leading-tight tracking-[-.04em]">Si puedes cogerlo, <span class="text-glow">puedes llevártelo.</span></h2><div class="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md">{#each ['Escena 1','Escena 2','Escena 3'] as label,i}<button class={`rounded-full px-3.5 py-1 font-display text-[11px] tracking-wider uppercase transition-all ${scene===i?'bg-bone font-medium text-ink':'text-bone/45 hover:text-bone/80'}`} onclick={()=>jump(i)}>{label}</button>{/each}</div></div>
			<div class="grain relative aspect-[16/10] w-full overflow-hidden rounded-[26px] border border-white/12" style={`max-width:min(980px,108svh);background:${p>.5?'radial-gradient(90% 90% at 30% 15%,#113247 0%,#091320 55%,#05070e 100%)':'radial-gradient(90% 90% at 70% 10%,#2c1736 0%,#150d21 55%,#07060d 100%)'};box-shadow:0 50px 120px -50px rgba(0,0,0,.95)`}>
				<Scene3D variant="carry" progress={p}/><div class="pointer-events-none absolute inset-0 bg-mint/30 mix-blend-screen" style={`opacity:${Math.sin(map(p,.47,.57)*Math.PI)*.48}`}></div>
				<div class="pointer-events-none absolute inset-x-0 top-4 z-10 flex flex-col items-center px-4 text-center">{#each captions as c}<div class="absolute inset-x-4 flex flex-col items-center transition-all duration-500" style={`opacity:${caption===c?1:0};transform:${caption===c?'none':'translateY(8px)'}`}><span class="rounded-full border border-white/12 bg-ink/70 px-3 py-0.5 font-display text-[10px] tracking-[0.26em] text-glow uppercase backdrop-blur">{c.scene}</span><p class="mt-2 font-display text-[clamp(1rem,2.2vw,1.45rem)] tracking-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">{c.text}</p><p class="mt-0.5 font-display text-[11px] tracking-[0.16em] text-bone/55">{c.sub}</p></div>{/each}</div>
				<div class="pointer-events-none absolute bottom-0 left-1/2 z-10 w-[72%] max-w-[440px] -translate-x-1/2 rounded-t-2xl border border-white/15 border-b-0 bg-ink/80 p-3 backdrop-blur-xl" style={`transform:translate(-50%, ${(1-inventory)*120}%);opacity:${inventory}`}><div class="mb-2 flex items-center justify-between px-1"><span class="font-display text-[10px] tracking-[0.28em] text-bone/60 uppercase">Tus cosas</span><span class="font-display text-[10px] tracking-[0.2em] text-mint/80 uppercase">{brushInBag?'pincel guardado ✓':'mochila espacial'}</span></div><div class="grid grid-cols-6 gap-1.5">{#each Array(6) as _,i}<div class={`grid aspect-square place-items-center rounded-xl border transition-all duration-300 ${i===0&&brushInBag?'border-glow/80 bg-glow/15 shadow-[0_0_24px_rgba(255,207,122,0.35)]':'border-white/10 bg-white/[0.03]'}`}>{#if i===0&&brushInBag}<span class="inline-block h-4 w-4 rounded-full bg-gradient-to-tr from-ember to-glow shadow-[0_0_12px_#ffcf7a]"></span>{/if}</div>{/each}</div></div>
				<div class="pointer-events-none absolute inset-0 z-20 grid place-items-center px-6 text-center transition-opacity duration-500" style={`opacity:${map(p,.89,.96)}`}><div class="rounded-3xl border border-white/15 bg-ink/75 px-7 py-6 backdrop-blur-md"><p class="font-display text-[clamp(1.2rem,3.2vw,2.15rem)] leading-tight tracking-tight text-balance">No pertenece a ese mundo.<br/><span class="text-mint">Ahora forma parte del tuyo.</span></p></div></div>
				<div class="absolute inset-x-0 bottom-0 h-[3px] bg-white/8"><div class="h-full bg-gradient-to-r from-glow via-ember to-mint" style={`width:${p*100}%`}></div></div>
			</div>
		</div>
	</div>
	<div class="relative mx-auto max-w-[1040px] px-6 pt-6 pb-28 text-center"><span class="rounded-full border border-glow/25 bg-glow/5 px-3 py-1 font-display text-[10px] tracking-[0.2em] text-glow uppercase">Posibilidades en 3D</span><p class="mt-3 text-[14px] text-bone/50">Pulsa cualquiera para inspeccionar el objeto 3D en tiempo real:</p><div class="mt-6 flex flex-wrap justify-center gap-2.5">{#each items as item}<button class={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 font-display text-sm transition-all duration-300 ${selected===item.id?'scale-105 border-glow/70 bg-glow/15 text-bone shadow-[0_0_30px_-8px_rgba(255,207,122,0.5)]':'border-white/12 bg-white/[0.03] text-bone/70 hover:border-white/30 hover:text-bone'}`} onclick={()=>selected=item.id}><span class="text-base">{item.emoji}</span>{item.label}</button>{/each}</div><div class="mx-auto mt-7 flex max-w-[540px] flex-col items-center overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:flex-row sm:gap-6 sm:px-6"><div class="relative h-[150px] w-[180px] shrink-0"><Scene3D variant={`inspector-${selected}`}/></div><div class="text-center sm:text-left"><div class="font-display text-[11px] tracking-[0.26em] text-glow uppercase">Objeto 3D portátil</div><div class="mt-1 font-display text-xl capitalize">{items.find(i=>i.id===selected)?.label}</div><p class="mt-1.5 text-[13.5px] leading-relaxed text-bone/55">{items.find(i=>i.id===selected)?.note}</p></div></div><p class="mx-auto mt-14 font-display text-[clamp(1.5rem,4.5vw,3rem)] leading-tight tracking-[-0.035em] text-balance">Si funciona en un sitio, <span class="text-ember">funciona en todos.</span></p></div>
</section>
