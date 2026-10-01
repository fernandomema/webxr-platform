<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { registerScene } from './renderer';
	import {
		addStandardLights,
		createAvatar3D,
		createArcadeButton3D,
		createBrush3D,
		createCamera3D,
		createDice3D,
		createFloatingParticles,
		createInstrument3D,
		createSpatialFloor,
		createTurntable3D,
		createWeirdThing3D,
		createWorldOrb3D
	} from './models';

	let { variant = 'world', class: className = '', progress = 0, controls }: { variant?: string; class?: string; progress?: number; controls?: {down:boolean; clicks:number; color:number; playing:boolean; mode:number; equipped?:boolean; flash?:number} } = $props();
	let canvas: HTMLCanvasElement;
	const pointer = { x: 0, y: 0 };
	const liveProgress = { value: 0 };
	$effect(() => { liveProgress.value = progress; });

	onMount(() => {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const scene = new THREE.Scene();
		scene.fog = new THREE.FogExp2(0x07070c, 0.065);
		addStandardLights(scene, { warm: 0xffd19a, cool: 0x7a6cff, ambient: 1.2 });
		const floor = createSpatialFloor({ size: 28, divisions: 28, y: -1.12 });
		if (variant.startsWith('card-') || variant.startsWith('inspector-')) floor.visible = false;
		scene.add(floor);
		const particles = createFloatingParticles(70, 15, 0xffcf7a);
		if (variant.startsWith('card-') || variant.startsWith('inspector-')) particles.visible = false;
		scene.add(particles);
		const actors: ReturnType<typeof createAvatar3D>[] = [];
		const objects: THREE.Object3D[] = [];
		const memories: { object: THREE.Object3D; position: THREE.Vector3; scale: number }[] = [];
		let passBrush: THREE.Group | undefined;
		let carryState: any;
		let orbState: any;
		let peerState: any;
		let vrState: any;
		let socialState: any;
		let editorState: any;
		let closingState: any;
		let orbParts: ReturnType<typeof createWorldOrb3D> | undefined;
		let orbOuter: THREE.Group | undefined;
		let orbInner: THREE.Group | undefined;
		let socialGuest: ReturnType<typeof createAvatar3D> | undefined;
		let socialSpawnRing: THREE.Mesh | undefined;
		let socialVoiceWave: THREE.Mesh | undefined;
		const peerIntroLines: THREE.Mesh[] = [];
		const peerDirectLines: THREE.Mesh[] = [];
		const addAvatar = (color: number, x: number, y = -1.12, z = 0, scale = 1) => {
			const avatar = createAvatar3D(color, scale);
			avatar.group.position.set(x, y, z);
			scene.add(avatar.group);
			actors.push(avatar);
			return avatar;
		};
		const addObject = (object: THREE.Object3D, x: number, y: number, z: number, scale = 1) => {
			object.position.set(x, y, z);
			object.scale.setScalar(scale);
			scene.add(object);
			objects.push(object);
			return object;
		};

		if (variant === 'peers') {
			scene.fog=new THREE.FogExp2(0x07070c,.065);scene.add(createSpatialFloor({size:22,divisions:22,y:-1.15}));
			const node=new THREE.Group();node.position.set(0,1.55,-.4);const core=new THREE.Mesh(new THREE.SphereGeometry(.34,28,28),new THREE.MeshStandardMaterial({color:0xffcf7a,emissive:0xff7a45,emissiveIntensity:.85,roughness:.2}));const ring=new THREE.Mesh(new THREE.TorusGeometry(.52,.02,12,48),new THREE.MeshBasicMaterial({color:0xffcf7a,transparent:true,opacity:.6}));ring.rotation.x=Math.PI/2;node.add(core,ring);scene.add(node);
			const coords=[{color:0x9b8cff,pos:new THREE.Vector3(-1.85,-1.15,-.35),rot:.6},{color:0x8ff0cf,pos:new THREE.Vector3(1.85,-1.15,-.35),rot:-.6},{color:0x6ec3ff,pos:new THREE.Vector3(0,-1.15,1.25),rot:Math.PI}];const peers=coords.map(p=>{const av=createAvatar3D(p.color,.78);av.group.position.copy(p.pos);av.group.rotation.y=p.rot;scene.add(av.group);return {av};});
			const beams=coords.map(p=>{const curve=new THREE.LineCurve3(new THREE.Vector3(0,1.55,-.4),p.pos.clone().add(new THREE.Vector3(0,1.05,0)));const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,16,.018,8,false),new THREE.MeshBasicMaterial({color:0xffcf7a,transparent:true,opacity:.65}));scene.add(mesh);return mesh;});const links=[[0,1,0x9b8cff],[1,2,0x8ff0cf],[2,0,0x6ec3ff]].map(([i,j,color])=>{const a=coords[i].pos.clone().add(new THREE.Vector3(0,.75,0)),b=coords[j].pos.clone().add(new THREE.Vector3(0,.75,0)),mid=a.clone().lerp(b,.5).add(new THREE.Vector3(0,.22,0)),curve=new THREE.QuadraticBezierCurve3(a,mid,b),tube=new THREE.Mesh(new THREE.TubeGeometry(curve,28,.024,8,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.1})),packet1=new THREE.Mesh(new THREE.SphereGeometry(.08,14,14),new THREE.MeshBasicMaterial({color:0xffffff})),packet2=new THREE.Mesh(new THREE.SphereGeometry(.07,14,14),new THREE.MeshBasicMaterial({color}));scene.add(tube,packet1,packet2);return {curve,tube,packet1,packet2};});peerState={node,core,ring,peers,beams,links};
		} else if (variant === 'social') {
			scene.add(createSpatialFloor({size:20,divisions:20,y:-1.05}));const host=createAvatar3D(0xffcf7a,.96);host.group.position.set(-1.15,-1.05,.25);host.group.rotation.y=.55;scene.add(host.group);const guest=createAvatar3D(0x8ff0cf,.96);guest.group.position.set(1.15,-2.2,.25);guest.group.rotation.y=-.55;scene.add(guest.group);
			const spawn=new THREE.Mesh(new THREE.TorusGeometry(.65,.025,12,48),new THREE.MeshBasicMaterial({color:0x8ff0cf,transparent:true,opacity:.5}));spawn.rotation.x=Math.PI/2;spawn.position.set(1.15,-1.02,.25);scene.add(spawn);const wave=new THREE.Mesh(new THREE.RingGeometry(.5,.56,48),new THREE.MeshBasicMaterial({color:0x8ff0cf,side:THREE.DoubleSide,transparent:true,opacity:0}));wave.rotation.x=-Math.PI/2;wave.position.set(0,-1.01,.25);scene.add(wave);actors.push(host,guest);socialState={host,guest,spawn,wave};
		} else if (variant === 'vr') {
			scene.add(createSpatialFloor({size:22,divisions:22,y:-1}));const a=createAvatar3D(0x8ff0cf,.92);a.group.position.set(-1.35,-1,-.4);a.group.rotation.y=.45;scene.add(a.group);const b=createAvatar3D(0x9b8cff,.88);b.group.position.set(1.45,-1,-.7);b.group.rotation.y=-.5;scene.add(b.group);const inst=createInstrument3D();inst.group.position.set(-.2,-.1,.65);inst.group.scale.setScalar(.75);scene.add(inst.group);const orb=createWorldOrb3D();orb.group.position.set(.75,.35,.25);orb.group.scale.setScalar(.45);scene.add(orb.group);
			const rig=new THREE.Group();scene.add(rig);const handMat=new THREE.MeshStandardMaterial({color:0xf4f1ea,emissive:0x9b8cff,emissiveIntensity:.22,roughness:.3});const leftHand=new THREE.Group(),lp=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.12,8,16),handMat),lr=new THREE.Mesh(new THREE.TorusGeometry(.11,.015,10,28),new THREE.MeshBasicMaterial({color:0x8ff0cf}));lp.rotation.x=Math.PI/3;lr.position.set(0,-.08,.06);leftHand.add(lp,lr);leftHand.position.set(-.55,-1.4,2.25);rig.add(leftHand);const rightHand=new THREE.Group(),rp=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.12,8,16),handMat),brush=createBrush3D();rp.rotation.x=Math.PI/3;brush.group.scale.setScalar(.55);brush.group.position.set(-.04,.16,-.12);brush.group.rotation.x=-.55;rightHand.add(rp,brush.group);rightHand.position.set(.55,-1.4,2.25);rig.add(rightHand);actors.push(a,b);socialState=undefined;vrState={a,b,inst,orb,rig,leftHand,rightHand};
		} else if (variant.startsWith('editor-')) {
			scene.add(createSpatialFloor({size:16,divisions:16,y:-.85}));const gizmo=new THREE.Group();const axis=(color:number,rz:number,rx:number)=>{const g=new THREE.Group(),shaft=new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.85,10),new THREE.MeshBasicMaterial({color})),tip=new THREE.Mesh(new THREE.ConeGeometry(.065,.16,12),new THREE.MeshBasicMaterial({color}));shaft.position.y=.42;tip.position.y=.88;g.add(shaft,tip);g.rotation.set(rx,0,rz);return g;};gizmo.add(axis(0xff5f56, -Math.PI/2,0),axis(0x4cd964,0,0),axis(0x5ac8fa,0,Math.PI/2));gizmo.position.set(0,.05,0);scene.add(gizmo);
			const holder=new THREE.Group();holder.position.set(0,.05,0);scene.add(holder);const material=new THREE.MeshStandardMaterial({color:0xffcf7a,roughness:.25,metalness:.2}),cube=new THREE.Mesh(new THREE.BoxGeometry(.68,.68,.68),material),knot=new THREE.Mesh(new THREE.TorusKnotGeometry(.32,.1,64,16),material),cameraModel=createCamera3D().group;cameraModel.scale.setScalar(.75);holder.add(cube,knot,cameraModel);const cage=new THREE.Mesh(new THREE.BoxGeometry(.92,.92,.92),new THREE.MeshBasicMaterial({color:0x8ff0cf,wireframe:true,transparent:true,opacity:0}));holder.add(cage);const avatar=createAvatar3D(0x8ff0cf,.85);avatar.group.position.set(1.15,-.85,-.2);avatar.group.rotation.y=-.65;scene.add(avatar.group);editorState={gizmo,holder,material,cube,knot,cameraModel,cage,avatar};
		} else if (variant === 'carry') {
			const world1 = new THREE.Group();
			const archMat = new THREE.MeshStandardMaterial({ color: 0x4b283d, roughness: .45, metalness: .15 });
			[-3.4,0,3.4].forEach((x,i)=>{const col=new THREE.Mesh(new THREE.CylinderGeometry(.22,.26,3.2,20),archMat);col.position.set(x,.5,-3.2-(i===1?.8:0));world1.add(col);});
			const sun=new THREE.Mesh(new THREE.SphereGeometry(.9,32,32),new THREE.MeshBasicMaterial({color:0xff9d5c,transparent:true,opacity:.35}));sun.position.set(-2.4,1.9,-4.5);world1.add(sun);scene.add(world1);
			const world2=new THREE.Group();const crystalMat=new THREE.MeshStandardMaterial({color:0x1b6678,emissive:0x0d3845,emissiveIntensity:.5,roughness:.2,flatShading:true});
			[-3.2,2.9,-.4].forEach((x,i)=>{const shard=new THREE.Mesh(new THREE.OctahedronGeometry(.65+i*.15,0),crystalMat);shard.scale.set(.7,2.1,.7);shard.position.set(x,.8+(i%2)*.4,-3.4-i*.5);world2.add(shard);});
			const portal=new THREE.Mesh(new THREE.TorusGeometry(1.7,.04,16,64),new THREE.MeshBasicMaterial({color:0x8ff0cf,transparent:true,opacity:.5}));portal.position.set(-1.5,1.1,-3.8);world2.add(portal);world2.position.y=-6;scene.add(world2);
			const left=addAvatar(0x9b8cff,-2.35,-1.1,.2,.98);left.group.rotation.y=.65;
			const you=addAvatar(0x8ff0cf,1.65,-1.1,.4,1.02);you.group.rotation.y=-.55;
			const friend=addAvatar(0xff9f7a,2.55,-1.1,-.8,.92);friend.group.rotation.y=-.75;
			const makeStroke=(points:THREE.Vector3[],color:number,emissive:number,radius:number)=>{const curve=new THREE.CatmullRomCurve3(points);const geo=new THREE.TubeGeometry(curve,80,radius,12,false);const mat=new THREE.MeshStandardMaterial({color,emissive,emissiveIntensity:.9,roughness:.2,transparent:true});const mesh=new THREE.Mesh(geo,mat);scene.add(mesh);return {curve,geo,mat,total:geo.index?.count??0};};
			const s1=makeStroke(Array.from({length:49},(_,i)=>{const u=i/48;return new THREE.Vector3(.55+u*1.65,.1+Math.sin(u*Math.PI*1.5)*.95,.85+Math.cos(u*Math.PI*2)*.35);}),0xffcf7a,0xff9a3d,.055);
			const s2=makeStroke(Array.from({length:57},(_,i)=>{const u=i/56;return new THREE.Vector3(-1.65+u*2.55,-.05+Math.sin(u*Math.PI*2.2)*.85+u*.4,.85+Math.sin(u*Math.PI*3)*.35);}),0x8ff0cf,0x42d6a4,.06);
			const brush=createBrush3D(0xffcf7a);scene.add(brush.group);carryState={world1,world2,left,you,friend,s1,s2,brush,particles};
		} else if (variant === 'hero' || variant === 'world') {
			addAvatar(0x9b8cff, -2.65, -1.15, 0.4, 1.02);
			addAvatar(0x8ff0cf, 2.65, -1.15, 0.35, 1.05);
			addAvatar(0x6ec3ff, -1.1, -1.15, -2.6, 0.86);
			addAvatar(0xffcf7a, 1.5, -1.15, -3.1, 0.82);
			passBrush = addObject(createBrush3D().group, -2.05, -0.15, 0.58, 0.92) as THREE.Group;
			const portal = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.025, 12, 72), new THREE.MeshBasicMaterial({ color: 0xff7a45, transparent: true, opacity: 0.5 }));
			portal.position.set(0, 1.2, -5);
			scene.add(portal);
			objects.push(portal);
		} else if (variant === 'closing') {
			const you = addAvatar(0xf4f1ea, 0, -1.2, 0.2, 1.08);
			const memoryItems = [createBrush3D().group, createCamera3D().group, createDice3D().group, createInstrument3D().group, createWorldOrb3D().group, createTurntable3D().group, createArcadeButton3D().group, createWeirdThing3D().group];
			const placements = [[-2.4,.7,.5,.85],[2.5,.85,.3,.68],[-1.7,-.35,1.3,.85],[1.8,-.4,1.2,.72],[0,1.55,-.8,.55],[-2.9,-.5,-.9,.52],[2.9,-.55,-.8,.55],[1.4,1.35,-.5,.65]];
			memoryItems.forEach((object,index)=>{ const [x,y,z,scale]=placements[index]; addObject(object,x,y,z,scale); memories.push({object,position:object.position.clone(),scale}); });
			for (const [index,color] of [0x9b8cff,0x8ff0cf,0x6ec3ff,0xffcf7a].entries()) { const x=index<2?(index===0?-1.65:1.65):(index===2?-2.85:2.85); const z=index<2?-.5:-1.8; const companion=addAvatar(color,x,-1.2,z,.92); companion.group.rotation.y=x<0?.45:-.45; memories.push({object:companion.group,position:companion.group.position.clone(),scale:.92}); }
			closingState={you,memories};
		} else if (variant === 'people') {
			addAvatar(0x9b8cff, -1.4, -1.12, 0.3, 0.85);
			addAvatar(0x8ff0cf, 0, -1.12, 0.2, 0.8);
			addAvatar(0x6ec3ff, 1.35, -1.12, -1.2, 0.76);
			addAvatar(0xffcf7a, 2.1, -1.12, -2, 0.67);
		} else if (variant === 'things') {
			addObject(createBrush3D().group, -1.4, 0.3, 0, 0.8);
			addObject(createCamera3D().group, 0, 0.3, -0.7, 0.75);
			addObject(createDice3D().group, 1.3, 0.25, 0, 0.85);
			addObject(createInstrument3D().group, 2, 0.2, -1.1, 0.65);
			addObject(createWorldOrb3D().group, 0.5, 0.9, -1.5, 0.6);
		} else if (variant === 'orb') {
			orbOuter=new THREE.Group();scene.add(orbOuter);orbOuter.add(createSpatialFloor({size:28,divisions:28,y:-1.25}));
			const left=createAvatar3D(0x9b8cff,1.05);left.group.position.set(-2.1,-1.25,.2);left.group.rotation.y=.6;orbOuter.add(left.group);
			const right=createAvatar3D(0x8ff0cf,1.05);right.group.position.set(2.1,-1.25,.2);right.group.rotation.y=-.6;orbOuter.add(right.group);
			orbParts=createWorldOrb3D({islandColor:0x4b3b78,crystalColor:0xffcf7a,ringColor:0x9b8cff});scene.add(orbParts.group);orbParts.group.position.set(-1.15,.05,.6);orbParts.group.scale.setScalar(.42);orbParts.group.add(new THREE.PointLight(0xffcf7a,2.2,8));
			orbInner=new THREE.Group();scene.add(orbInner);orbInner.visible=false;orbInner.add(createSpatialFloor({size:36,divisions:36,color1:0x8ff0cf,color2:0x3b2a6b,y:-1.35}));
			const monolithMat=new THREE.MeshStandardMaterial({color:0xffcf7a,emissive:0xff9a3d,emissiveIntensity:.65,roughness:.2,flatShading:true});
			[[-3.2,.8,-3.5,1.2],[3.4,1.1,-3.8,1.4],[-1.8,2.1,-5.2,.9],[2.1,2.4,-5.5,1]].forEach(([x,y,z,scale])=>{const m=new THREE.Mesh(new THREE.OctahedronGeometry(.65*scale,0),monolithMat);m.scale.set(.75,1.8,.75);m.position.set(x,y,z);orbInner!.add(m);});
			const innerA=createAvatar3D(0x6ec3ff,.95);innerA.group.position.set(-1.6,-1.35,-1.2);innerA.group.rotation.y=.45;orbInner.add(innerA.group);
			const innerB=createAvatar3D(0xff9f7a,.92);innerB.group.position.set(1.7,-1.35,-1.4);innerB.group.rotation.y=-.45;orbInner.add(innerB.group);
			const nested=createWorldOrb3D({islandColor:0x1d6678,crystalColor:0x8ff0cf,ringColor:0xffcf7a});nested.group.scale.setScalar(.52);nested.group.position.set(0,-.15,-.6);orbInner.add(nested.group);
			const orbParticles=createFloatingParticles(100,16,0x9b8cff);scene.add(orbParticles);actors.push(left,right,innerA,innerB);orbState={left,right,innerA,innerB,nested,orbParticles};
		} else if (variant.startsWith('inspector-')) {
			const holder=new THREE.Group();scene.add(holder);const tool=(()=>{const g=new THREE.Group(),ring=new THREE.Mesh(new THREE.TorusGeometry(.42,.07,16,40),new THREE.MeshStandardMaterial({color:0x6ec3ff,metalness:.7,roughness:.2})),handle=new THREE.Mesh(new THREE.CylinderGeometry(.08,.1,.65,16),new THREE.MeshStandardMaterial({color:0xeae6df,metalness:.6,roughness:.25}));handle.position.y=-.45;g.add(ring,handle);return g})();const choices:Record<string,THREE.Object3D>={brush:createBrush3D().group,camera:createCamera3D().group,game:createDice3D(.75).group,instrument:createInstrument3D().group,tool,weird:createWeirdThing3D().group};Object.entries(choices).forEach(([key,obj])=>{obj.visible=key===variant.slice('inspector-'.length);holder.add(obj)});editorState={kind:'inspector',holder,choices};
		} else if (variant === 'card-brush') { const trail=new THREE.Group();scene.add(trail);const brush=createBrush3D();scene.add(brush.group);const geo=new THREE.SphereGeometry(.065,12,12);for(let i=0;i<22;i++){const u=i/21,m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0xffcf7a,emissive:0xffcf7a,emissiveIntensity:.7,roughness:.2}));m.position.set(Math.cos(u*Math.PI*2)*.65,-.3+u*.65,Math.sin(u*Math.PI*2)*.35);m.scale.setScalar(.5+Math.sin(u*Math.PI)*.7);trail.add(m)}scene.add(createSpatialFloor({size:12,divisions:12,y:-1.1}));editorState={kind:'brush',trail,brush,geo,last:0};
		} else if (variant === 'card-disc') {const tt=createTurntable3D();tt.group.position.y=-.12;scene.add(tt.group);editorState={kind:'disc',tt};
		} else if (variant === 'card-button') {const btn=createArcadeButton3D();btn.group.position.y=-.15;scene.add(btn.group);scene.add(createSpatialFloor({size:10,divisions:10,y:-.45}));const cubes:THREE.Mesh[]=[];const cols=[0xffcf7a,0x8ff0cf,0x9b8cff,0x6ec3ff,0xff7a45];for(let i=0;i<7;i++){const a=i/7*Math.PI*2,c=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.18),new THREE.MeshStandardMaterial({color:cols[i%5],emissive:cols[i%5],emissiveIntensity:.35}));c.position.set(Math.cos(a)*1.05,.15,Math.sin(a)*.85);scene.add(c);cubes.push(c)}editorState={kind:'button',btn,cubes,last:0};
		} else if (variant === 'card-camera') {const cam=createCamera3D();scene.add(cam.group);editorState={kind:'camera',cam};
		} else if (variant === 'card-game') {const dice=createDice3D(.68);dice.group.position.set(.52,-.1,.15);scene.add(dice.group);scene.add(createSpatialFloor({size:10,divisions:10,y:-.65}));editorState={kind:'game',dice,vy:0,rotVel:new THREE.Vector3(1.2,1.8,.9),clicks:0};
		} else if (variant === 'card-orb') {const orb=createWorldOrb3D();scene.add(orb.group);editorState={kind:'orb',orb,idx:0};
		} else if (variant === 'touch' || variant === 'inspector') {addObject(createBrush3D().group,-1.6,.2,0,.8);addObject(createCamera3D().group,0,.2,-.3,.8);addObject(createDice3D().group,1.5,.25,0,.9);addObject(createInstrument3D().group,2.4,.3,-1.3,.6);
		} else {
			addAvatar(0x9b8cff, -0.8, -1.12, 0.2, 0.95);
			addAvatar(0x8ff0cf, 0.8, -1.12, -0.5, 0.8);
			addObject(createWorldOrb3D().group, 0, 1.05, -1.2, 0.6);
		}

		const objectBaseY = objects.map((object) => object.position.y);
		const onPointerMove = (event: PointerEvent) => { const rect=canvas.getBoundingClientRect(); pointer.x=((event.clientX-rect.left)/Math.max(1,rect.width))*2-1; pointer.y=-(((event.clientY-rect.top)/Math.max(1,rect.height))*2-1); };
		const onPointerDown=()=>{if(controls){controls.down=true;controls.clicks++;if(variant==='card-camera')controls.equipped=!controls.equipped;if(variant==='card-orb'&&editorState)editorState.idx=(editorState.idx+1)%3;if(variant==='card-button'&&editorState)editorState.lastClick=performance.now()/1000}};const onPointerUp=()=>{if(controls)controls.down=false};
		canvas.addEventListener('pointermove', onPointerMove);canvas.addEventListener('pointerdown',onPointerDown);window.addEventListener('pointerup',onPointerUp);
		const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 120);
		camera.position.set(0,variant==='card-disc'?1.35:variant==='card-button' ? 1.15 : variant.startsWith('inspector-') ? .5 : .35,variant==='hero'?6.5:variant==='card-disc'?2.45:variant==='card-button'?2.65:variant==='card-game'?2.85:variant==='card-camera'?2.7:variant==='card-orb'?2.8:variant.startsWith('card-')?3.5:variant.startsWith('inspector-')?2.5:variant.startsWith('editor-')?3.8:5.4);
		camera.lookAt(0, 0.05, 0);
		const task = { canvas, ctx, scene, camera, pointer, visible: false, update: (time: number, pointer: {x:number;y:number}) => {
			if (variant === 'carry' && carryState) {
				const c=carryState,p=liveProgress.value,clamp=(n:number)=>Math.max(0,Math.min(1,n)),map=(n:number,a:number,b:number)=>clamp((n-a)/(b-a));
				const paint1=map(p,.18,.31),shift=map(p,.47,.57),retrieve=map(p,.63,.71),paint2=map(p,.72,.9),fly=map(p,.06,.17),store=map(p,.34,.43);
				c.world1.position.y=-shift*6.5;c.world2.position.y=(1-shift)*-6.5;c.left.group.position.y=-1.1-shift*4.5;c.friend.group.position.y=-1.1-(1-shift)*4.5;c.you.group.position.x=THREE.MathUtils.lerp(1.65,.85,shift);c.you.group.rotation.y=THREE.MathUtils.lerp(-.55,-.25,shift);
			c.left.animate(time,{speaking:p<.12,phase:0});c.you.animate(time,{speaking:false,phase:1.5});c.friend.animate(time,{speaking:p>.55&&p<.7,wave:p>.52&&p<.65,phase:2.7});
			c.s1.geo.setDrawRange(0,Math.floor(c.s1.total*paint1));c.s1.mat.opacity=1-shift*.85;c.s2.geo.setDrawRange(0,Math.floor(c.s2.total*paint2));c.s2.mat.opacity=shift;
				let bx=-1.75,by=.05,bz=.55,scale=.95,rot=-.35;
				if(p<.06){by+=Math.sin(time*3)*.06;}else if(fly<1){bx=THREE.MathUtils.lerp(-1.75,.55,fly);by=.05+Math.sin(fly*Math.PI)*1.45;bz=THREE.MathUtils.lerp(.55,.85,fly);rot=-.35-fly*Math.PI*4;}else if(p<.34){const pt=c.s1.curve.getPoint(paint1);bx=pt.x;by=pt.y-.18;bz=pt.z;rot=-.45+Math.sin(paint1*Math.PI*2)*.25;}else if(store<1){const pt=c.s1.curve.getPoint(1);bx=THREE.MathUtils.lerp(pt.x,0,store);by=THREE.MathUtils.lerp(pt.y-.18,-1.65,store);bz=THREE.MathUtils.lerp(pt.z,1.4,store);scale=.95*(1-store*.85);rot=store*Math.PI*2;}else if(p<.63){scale=.0001;}else if(retrieve<1){const pt=c.s2.curve.getPoint(0);bx=THREE.MathUtils.lerp(0,pt.x,retrieve);by=THREE.MathUtils.lerp(-1.65,pt.y-.18,retrieve);bz=THREE.MathUtils.lerp(1.4,pt.z,retrieve);scale=.1+retrieve*.85;rot=(1-retrieve)*Math.PI*2-.4;}else{const pt=c.s2.curve.getPoint(paint2);bx=pt.x;by=pt.y-.18;bz=pt.z;rot=-.4+Math.cos(paint2*Math.PI*3)*.25;}
				c.brush.group.position.set(bx,by,bz);c.brush.group.scale.setScalar(scale);c.brush.group.rotation.set(.3,time*.8,rot);c.particles.rotation.y=time*.05;
				camera.position.set(Math.sin(shift*Math.PI)*.9,1.35+Math.sin(shift*Math.PI)*.35,6.2);camera.lookAt(0,.15,0);return;
			}
			if (variant === 'closing' && closingState) {const cl=closingState,p=liveProgress.value,clamp=(n:number)=>Math.max(0,Math.min(1,n)),map=(n:number,a:number,b:number)=>clamp((n-a)/(b-a)),vanish=map(p,.05,.6),fin=map(p,.62,.86),total=cl.memories.length;cl.memories.forEach((m:any,i:number)=>{const g=clamp((vanish-i/total)/(.9/total));m.object.scale.setScalar(Math.max(.0001,m.scale*(1-g)));m.object.position.x=m.position.x*(1+g*.25);m.object.position.y=m.position.y+Math.sin(time*2+i)*.08*(1-g)+g*1.6;m.object.position.z=m.position.z;if(i<8)m.object.rotation.y=time*.6+i;});cl.you.animate(time,{speaking:false,phase:0});const scale=1.08*clamp(1-fin*.85);cl.you.group.scale.setScalar(scale);cl.you.group.position.y=-1.2-fin*.6;particles.rotation.y=time*.04;camera.position.set(pointer.x*.45,1.45+pointer.y*.2,6.6);camera.lookAt(0,.15,0);return;}
			particles.rotation.y = time * 0.04;
			if(variant.startsWith('inspector-')&&editorState){const e=editorState as any;Object.entries(e.choices).forEach(([k,o])=>((o as THREE.Object3D).visible=k===variant.slice(10)));e.holder.rotation.y=time*1.1+pointer.x*1.2;e.holder.rotation.x=.25+pointer.y*.6;e.holder.position.y=Math.sin(time*2.4)*.07;camera.lookAt(0,0,0);return;}
			if(variant.startsWith('card-')&&editorState){const e=editorState as any,c=controls??{down:false,clicks:0,color:0,mode:0};if(e.kind==='brush'){const color=[0xffcf7a,0x8ff0cf,0xff7a45,0x9b8cff][c.color]??0xffcf7a;e.brush.tipMat.color.setHex(color);e.brush.tipMat.emissive.setHex(color);(e.brush.halo.material as THREE.MeshBasicMaterial).color.setHex(color);const tx=pointer.x*1.35,ty=pointer.y*.85;e.brush.group.position.x+=(tx-e.brush.group.position.x)*.22;e.brush.group.position.y+=(ty-.15-e.brush.group.position.y)*.22;e.brush.group.position.z=.35;e.brush.group.rotation.z=-.35-(tx-e.brush.group.position.x)*.8;e.brush.group.rotation.x=c.down?.45:.2;if(!c.down)e.trail.rotation.y+=.008;if(c.down&&time-e.last>.018){e.last=time;const m=new THREE.Mesh(e.geo,new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.8})),p=new THREE.Vector3(e.brush.group.position.x-.12,e.brush.group.position.y+.38,.25);e.trail.worldToLocal(p);m.position.copy(p);e.trail.add(m);if(e.trail.children.length>95)e.trail.remove(e.trail.children[0])}}else if(e.kind==='disc'){const on=c.clicks%2===1;if(on)e.tt.platterGroup.rotation.y-=.06;e.tt.armPivot.rotation.y+=( (on?-.34:.12)-e.tt.armPivot.rotation.y)*.12;e.tt.bars.forEach((b:THREE.Mesh,i:number)=>{const y=on?.4+Math.abs(Math.sin(time*7+i*.7))*1.9:.2;b.scale.y+=(y-b.scale.y)*.2;b.position.y=b.scale.y*.15});e.tt.group.rotation.y=pointer.x*.35+Math.sin(time*.6)*.12}else if(e.kind==='button'){const pulse=c.clicks?Math.max(0,1-(time-e.last)*2.2):0,on=c.clicks%2===1;e.btn.cap.position.y=.16-Math.sin(pulse*Math.PI)*.14;e.btn.capMat.color.setHex(on?0x8ff0cf:0xff7a45);e.btn.capMat.emissive.setHex(on?0x2fae8a:0xff5522);e.btn.wave.scale.setScalar(pulse>.01?1+(1-pulse)*2.1:.001);e.btn.waveMat.opacity=pulse*.85;e.cubes.forEach((b:THREE.Mesh,i:number)=>{const a=time*(on?1.8:.6)+i/7*Math.PI*2;b.position.set(Math.cos(a)*1.05,.1+Math.sin(time*3+i)*.12+Math.sin(pulse*Math.PI)*.55,Math.sin(a)*.85);b.rotation.set(time*2+i,time*1.5,0)});camera.position.x=pointer.x*.35}else if(e.kind==='camera'){const eq=!!c.equipped,mode=c.mode??0;e.cam.group.scale.lerp(new THREE.Vector3(eq?1.08:.85,eq?1.08:.85,eq?1.08:.85),.12);e.cam.group.position.y+=( (eq?.15:Math.sin(time*2.2)*.08)-e.cam.group.position.y)*.12;e.cam.group.rotation.y+=(eq?pointer.x*.45+(mode===2?Math.PI:0):time*.7-e.cam.group.rotation.y)*.12;const col=[0x6ec3ff,0xff7a45,0x8ff0cf][mode];e.cam.lensMat.color.setHex(col);e.cam.lensMat.emissive.setHex(col);e.cam.lensMat.emissiveIntensity=.6+(c.flash?3:0);if(c.flash)c.flash=Math.max(0,c.flash-.04)}else if(e.kind==='game'){if(e.clicks!==c.clicks){e.clicks=c.clicks;e.vy=4.4;e.rotVel.set((Math.random()-.5)*18,(Math.random()-.5)*18,(Math.random()-.5)*18)}e.vy-=11.5/60;e.dice.group.position.y+=e.vy/60;if(e.dice.group.position.y<-.28){e.dice.group.position.y=-.28;e.vy=Math.abs(e.vy)>.6?-e.vy*.52:0}e.dice.group.rotation.x+=e.rotVel.x/60;e.dice.group.rotation.y+=e.rotVel.y/60;e.dice.group.rotation.z+=e.rotVel.z/60;e.rotVel.multiplyScalar(.95)}else if(e.kind==='orb'){const w=[{island:0x5c3d82,crystal:0xffcf7a,ring:0x9b8cff},{island:0x1d6278,crystal:0x8ff0cf,ring:0x6ec3ff},{island:0x7a2e3d,crystal:0xff7a45,ring:0xffcf7a}][e.idx];(e.orb.islandTop.material as THREE.MeshStandardMaterial).color.setHex(w.island);e.orb.crystalMat.color.setHex(w.crystal);e.orb.crystalMat.emissive.setHex(w.crystal);(e.orb.ring1.material as THREE.MeshBasicMaterial).color.setHex(w.ring);e.orb.innerWorld.rotation.y=time*.8+pointer.x*1.2;e.orb.innerWorld.rotation.x=pointer.y*.35;e.orb.ring1.rotation.z=time*.6;e.orb.ring2.rotation.x=-time*.5;e.orb.group.position.y=Math.sin(time*2.2)*.06}camera.lookAt(0,0,0);return;}
			objects.forEach((object, index) => {
				object.rotation.y = time * (index % 2 ? 0.45 : 0.7);
				object.position.y = objectBaseY[index] + Math.sin(time * 2 + index) * 0.08;
			});
			if (passBrush) { const cycle=(time%8)/8; let u=0; let inFlight=false; if(cycle<.15) u=0; else if(cycle<.42){u=(cycle-.15)/.27;inFlight=true;} else if(cycle<.58) u=1; else if(cycle<.85){u=1-(cycle-.58)/.27;inFlight=true;} const eased=u*u*(3-2*u); passBrush.position.set(-2.05+4.1*eased,-.15+Math.sin(eased*Math.PI)*1.55+(inFlight?0:Math.sin(time*4)*.08),.58+Math.sin(eased*Math.PI)*.35); passBrush.rotation.set(inFlight?time*3.2:.25,0,inFlight?time*5.5:Math.sin(time*2.5)*.35-.4); }
			memories.forEach((memory,index)=>{const disappear=Math.max(0,Math.min(1,(liveProgress.value*.85-index/memories.length)/(.9/memories.length)));const scale=memory.scale*(1-disappear);memory.object.scale.setScalar(Math.max(.0001,scale));memory.object.position.x=memory.position.x*(1+disappear*.25);memory.object.position.y=memory.position.y+Math.sin(time*2+index)*.08*(1-disappear)+disappear*1.6;});
			actors.forEach((avatar, index) => avatar.animate(time, { speaking: Math.sin(time + index) > 0.3, phase: index * 0.8 }));
			if (variant === 'peers') { const direct=liveProgress.value>.5;peerIntroLines.forEach((line)=>((line.material as THREE.MeshBasicMaterial).opacity=direct?0:.65));peerDirectLines.forEach((line)=>((line.material as THREE.MeshBasicMaterial).opacity=direct?.65:0)); }
			if (variant === 'social' && socialGuest) { const arrived=liveProgress.value>=2;const scale=arrived?.96:.001;socialGuest.group.scale.lerp(new THREE.Vector3(scale,scale,scale),.15);socialGuest.group.position.y+=((arrived?-1.05:-2.2)-socialGuest.group.position.y)*.15;if(socialSpawnRing){socialSpawnRing.scale.setScalar(.85+Math.sin(time*4)*.15);(socialSpawnRing.material as THREE.MeshBasicMaterial).opacity=liveProgress.value===1?.85:arrived?.35:.15;}if(socialVoiceWave){const active=liveProgress.value>=3;socialVoiceWave.scale.setScalar(active?.8+Math.sin(time*4)*.2:.001);(socialVoiceWave.material as THREE.MeshBasicMaterial).opacity=active?.55:0;} }
			if (variant.startsWith('editor-') && editorState) {const e=editorState,step=liveProgress.value,parts=variant.split('-'),shape=parts[1],colorIndex=Number(parts[2]||0),colors=[0xffcf7a,0x8ff0cf,0xff7a45,0x9b8cff];e.material.color.setHex(colors[colorIndex]??colors[0]);e.gizmo.visible=step<3;e.cube.visible=step>=1&&shape==='cube';e.knot.visible=step>=1&&shape==='torus';e.cameraModel.visible=step>=1&&shape==='camera';e.holder.scale.lerp(new THREE.Vector3(step>=1?1:.001,step>=1?1:.001,step>=1?1:.001),.15);const cageMat=e.cage.material as THREE.MeshBasicMaterial;cageMat.opacity+=((step===2?.55:0)-cageMat.opacity)*.15;e.cage.rotation.y=-time*.6;if(step===3){const bounce=Math.abs(Math.sin(time*3.8))*.65;e.holder.position.set(Math.sin(time*1.9)*.35,.1+bounce,.2);e.holder.rotation.set(time*2.2,time*1.6,0);}else{e.holder.position.set(0,.05,0);e.holder.rotation.set(.25+pointer.y*.3,time*.65+pointer.x*.6,0);}e.avatar.group.position.y+=((step===3?-.85:-3.2)-e.avatar.group.position.y)*.14;e.avatar.animate(time,{speaking:step===3,wave:step===3});camera.position.set(pointer.x*.35,1.15,3.8);camera.lookAt(0,.05,0);return;}
			if (variant === 'peers' && peerState) {const n=peerState,direct=liveProgress.value>=1,target=direct?.68:1.05;n.node.scale.lerp(new THREE.Vector3(target,target,target),.1);n.ring.rotation.z=time*.8;(n.core.material as THREE.MeshStandardMaterial).emissiveIntensity=direct?.25:.95;n.beams.forEach((b:THREE.Mesh)=>{const m=b.material as THREE.MeshBasicMaterial;m.opacity+=((direct?.08:.65)-m.opacity)*.1;});n.links.forEach((l:any,i:number)=>{const m=l.tube.material as THREE.MeshBasicMaterial;m.opacity+=((direct?.75:.1)-m.opacity)*.12;l.packet1.position.copy(l.curve.getPoint((time*.65+i*.33)%1));l.packet2.position.copy(l.curve.getPoint(1-(time*.55+i*.25)%1));l.packet1.visible=direct;l.packet2.visible=direct;});n.peers.forEach((p:any,i:number)=>p.av.animate(time,{speaking:direct,phase:i*1.4}));camera.position.set(pointer.x*.55,2.35+pointer.y*.25,6.2);camera.lookAt(0,.1,.2);return;}
			if (variant === 'social' && socialState) {const s=socialState,step=liveProgress.value;s.host.animate(time,{speaking:step>=3,wave:step===2,phase:0});s.guest.animate(time,{speaking:step>=3,wave:step===2,phase:1.5});const arrived=step>=2,scale=arrived?.96:.001;s.guest.group.scale.lerp(new THREE.Vector3(scale,scale,scale),.15);s.guest.group.position.y+=((arrived?-1.05:-2.2)-s.guest.group.position.y)*.15;s.spawn.scale.setScalar(.85+Math.sin(time*4)*.15);(s.spawn.material as THREE.MeshBasicMaterial).opacity=step===1?.85:arrived?.35:.15;const cyc=(time*.8)%1; s.wave.scale.setScalar(step>=3?.6+cyc*3.2:.001);(s.wave.material as THREE.MeshBasicMaterial).opacity=step>=3?(1-cyc)*.65:0;camera.position.x=pointer.x*.4;camera.lookAt(0,.05,0);return;}
			if (variant === 'vr' && vrState) {const v=vrState,on=liveProgress.value>0;v.a.animate(time,{speaking:true,wave:on,phase:0});v.b.animate(time,{speaking:false,phase:1.8});v.inst.group.position.y=-.1+Math.sin(time*2.2)*.06;v.inst.group.rotation.y=time*.4;v.orb.innerWorld.rotation.y=time*.9;v.orb.group.position.y=.35+Math.cos(time*2)*.06;v.rig.position.y+=((on?0:-1.4)-v.rig.position.y)*.14;v.leftHand.position.x=-.48+pointer.x*.25+Math.sin(time*2.3)*.05;v.leftHand.position.y=.25+pointer.y*.2+Math.cos(time*2.1)*.04;v.leftHand.rotation.z=.25-pointer.x*.3;v.rightHand.position.x=.48+pointer.x*.35+Math.cos(time*2.5)*.05;v.rightHand.position.y=.28+pointer.y*.25+Math.sin(time*2.5)*.05;v.rightHand.rotation.z=-.25-pointer.x*.3;const fov=on?64:46;camera.fov+=(fov-camera.fov)*.12;camera.updateProjectionMatrix();camera.position.set(pointer.x*.55+(on?Math.sin(time*1.4)*.12:0),.75+pointer.y*.25+(on?Math.cos(time*2.1)*.06:0),5.4);camera.rotation.z=on?Math.sin(time*1.2)*.03-pointer.x*.04:0;camera.lookAt(pointer.x*.4,.15+pointer.y*.2,0);return;}
			if (variant === 'orb' && orbState && orbOuter && orbInner && orbParts) {
				const o=orbState,p=liveProgress.value,clamp=(n:number)=>Math.max(0,Math.min(1,n)),map=(n:number,a:number,b:number)=>clamp((n-a)/(b-a));const pass=map(p,.34,.5),travel=map(p,.52,.66),open=map(p,.68,.88),inside=map(p,.75,.9);
				o.left.animate(time,{speaking:p<.2,phase:0});o.right.animate(time,{speaking:p>.42&&p<.65,phase:2});o.left.rightHand.position.set(.62,1.05,.35);o.right.leftHand.position.set(-.62,1.05,.35);orbOuter.position.y=-open*8;orbOuter.visible=open<.95;
				const handX=THREE.MathUtils.lerp(-1.15,1.15,pass),orbX=THREE.MathUtils.lerp(handX,0,map(p,.62,.75)),base=.42+map(p,.16,.32)*.38+travel*.12,burst=base+Math.pow(open,2.4)*9.5;orbParts.group.position.set(orbX,.05+Math.sin(pass*Math.PI)*.45+Math.sin(time*2.2)*.05*(1-open),.6);orbParts.group.scale.setScalar(burst);orbParts.innerWorld.rotation.y=time*.65+p*4;orbParts.ring1.rotation.z=time*.5;orbParts.ring2.rotation.x=time*.4;(orbParts.shell.material as THREE.MeshPhysicalMaterial).opacity=.34*clamp(1-open*1.35);orbParts.group.visible=open<.96;
				orbInner.visible=inside>.01;orbInner.scale.setScalar(.35+inside*.65);orbInner.position.y=(1-inside)*-2.2;o.innerA.animate(time,{speaking:inside>.8,wave:inside>.7,phase:.4});o.innerB.animate(time,{speaking:false,phase:1.9});o.nested.innerWorld.rotation.y=-time*.9;o.nested.group.position.y=-.15+Math.sin(time*2.4)*.08;
				camera.position.set(pointer.x*.45,1.2+pointer.y*.2,6.2-Math.sin(open*Math.PI)*2.1);camera.lookAt(0,.1,0);o.orbParticles.rotation.y=time*.05+travel*1.5;return;
			}
			if (variant === 'hero' || variant === 'world') { camera.position.x += (pointer.x*.65-camera.position.x)*.06; camera.position.y += (1.55+pointer.y*.28-camera.position.y)*.06; }
			if (variant !== 'hero' && variant !== 'world') { camera.position.x = pointer.x*.45; camera.position.y = 1.45+pointer.y*.2; }
			camera.lookAt(0, 0.05, 0);
		}};
		const dispose = registerScene(task);
		const observer = new IntersectionObserver(([entry]) => { task.visible = entry.isIntersecting; }, { rootMargin: '120px' });
		observer.observe(canvas);
		return () => { observer.disconnect();canvas.removeEventListener('pointermove',onPointerMove);canvas.removeEventListener('pointerdown',onPointerDown);window.removeEventListener('pointerup',onPointerUp);dispose(); scene.traverse((node) => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach((material) => material.dispose()); } }); };
	});
</script>

<canvas bind:this={canvas} class={`scene-canvas ${className}`} aria-hidden="true"></canvas>

<style>
	.scene-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
