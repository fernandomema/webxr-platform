<script lang="ts" module>
	export type IconName =
		| 'back' | 'plus' | 'undo' | 'redo' | 'save' | 'play' | 'publish' | 'trash' | 'copy' | 'folder'
		| 'cube' | 'world' | 'search' | 'chevron-right' | 'chevron-down' | 'code' | 'json' | 'close'
		| 'check' | 'cloud' | 'device' | 'warning' | 'user' | 'layers' | 'sliders' | 'command' | 'folder-plus';
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 16 }: Props = $props();

	const PATHS: Record<IconName, string> = {
		back: 'M15 18l-6-6 6-6',
		plus: 'M12 5v14M5 12h14',
		undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
		redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
		save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
		play: 'M7 4l13 8-13 8z',
		publish: 'M12 16V4M7 9l5-5 5 5M4 20h16',
		trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
		copy: 'M9 9h11v11H9zM5 15V4h11',
		folder: 'M3 6h6l2 2h10v11H3z',
		'folder-plus': 'M3 6h6l2 2h10v11H3zM12 11v6M9 14h6',
		cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
		world: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
		search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
		'chevron-right': 'M9 6l6 6-6 6',
		'chevron-down': 'M6 9l6 6 6-6',
		code: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14',
		json: 'M9 4C6 4 7 8 5 9c2 1 1 5 4 5M15 4c3 0 2 4 4 5-2 1-1 5-4 5',
		close: 'M6 6l12 12M18 6L6 18',
		check: 'M5 12l5 5 9-10',
		cloud: 'M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18z',
		device: 'M4 5h16v11H4zM9 20h6M12 16v4',
		warning: 'M12 4l9 16H3zM12 10v4M12 17v.5',
		user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
		layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
		sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
		command: 'M9 9h6v6H9zM9 9V6a3 3 0 10-3 3h3M15 9h3a3 3 0 10-3-3M9 15H6a3 3 0 103 3M15 15v3a3 3 0 103-3'
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d={PATHS[name]} />
</svg>
