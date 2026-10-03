<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
	import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
	import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
	import { lintCode } from './lint/code';
	import 'monaco-editor/min/vs/editor/editor.main.css';

	interface CodeEditorProps {
		value: string;
		language?: 'javascript' | 'json';
		onChange?: (value: string) => void;
		onFormatReady?: (format: () => void) => void;
	}

	let { value = '', language = 'javascript', onChange = () => {}, onFormatReady = () => {} }: CodeEditorProps = $props();
	let host: HTMLDivElement;
	let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
	let isReady = $state(false);
	let isFormatting = $state(false);
	let disposeEditor: (() => void) | undefined;

	$effect(() => {
		if (!isReady || !editor) return;
		const model = editor.getModel();
		if (model && model.getValue() !== value) model.setValue(value);
	});

	const completionEntries = [
		{ label: 'ctx', detail: 'CodeBlockContext', documentation: 'Bounded runtime context available to every code block.' },
		{ label: 'ctx.self', detail: 'Self API', documentation: 'Read and manipulate this slot.' },
		{ label: 'ctx.world', detail: 'World API', documentation: 'Host-aware spawning, deletion and shared state.' },
		{ label: 'ctx.hierarchy', detail: 'Hierarchy API', documentation: 'Query slots, children and parents.' },
		{ label: 'ctx.grab', detail: 'Grab API', documentation: 'Inspect whether this slot is held and by whom.' },
		{ label: 'ctx.math', detail: 'Math API', documentation: 'Small vector and quaternion helpers.' },
		{ label: 'ctx.net.fetchJson(url)', detail: '(url: string) => Promise<unknown>', documentation: 'GET JSON from a local route or HTTPS endpoint.' },
		{ label: 'ctx.net.postJson(url, body)', detail: '(url: string, body: unknown) => Promise<unknown>', documentation: 'POST JSON to a local route or HTTPS endpoint.' },
		{ label: 'ctx.ui.getMedia(id)', detail: '(id: string) => { currentTime, duration, paused, ended, ready, error } | undefined', documentation: 'Playback state of a video UI element on this peer.' },
		{ label: 'ctx.ui.getInputText(id)', detail: '(id: string) => string | undefined', documentation: 'Current text of an input UI element on this peer.' },
		{ label: 'ctx.log', detail: '(…args: unknown[]) => void', documentation: 'Write a message to the Inspector debug feed.' },
		{ label: 'ctx.self.getSlot()', detail: '() => Slot | undefined', documentation: 'Return the current Slot data.' },
		{ label: 'ctx.self.getWorldPosition()', detail: '() => Vec3', documentation: 'Read this slot world position.' },
		{ label: 'ctx.self.setWorldPosition(value)', detail: '(value: Vec3) => void', documentation: 'Set this slot world position.' },
		{ label: 'ctx.grab.isHeld()', detail: '() => boolean', documentation: 'Whether at least one player is holding this slot.' },
		{ label: 'ctx.grab.heldBy()', detail: '() => string[]', documentation: 'Grabber ids currently holding this slot.' },
		{ label: 'ctx.world.spawn({ name })', detail: '(partial: Slot) => void', documentation: 'Request a new slot from the host.' },
		{ label: 'ctx.world.deleteSelf()', detail: '() => void', documentation: 'Request deletion of this slot.' },
		{ label: 'ctx.world.setSlotEnabled(id, enabled)', detail: '(id: string, enabled: boolean) => boolean', documentation: 'Switch a slot and everything below it on or off for all players (hidden, not pickable). Host only; returns whether it changed.' },
		{ label: 'ctx.storage.player(player)', detail: '(player: { id }) => StorageHandle', documentation: 'Saved data of one player for this published world: get(key, default), set, increment(key, by, { min, max }), addToSet, removeFromSet, remove, transaction(ops). All async. Store stable ids such as "generator-2".' },
		{ label: 'ctx.storage.world', detail: 'StorageHandle', documentation: 'Saved data shared by every session of this published world.' },
		{ label: 'ctx.storage.available', detail: 'boolean', documentation: 'False when nothing can be saved (a published world played without an account).' },
		{ label: 'ctx.leaderboards.submit(name, player, score)', detail: '(name, player, score, { order?: "high" | "low" }) => Promise', documentation: 'Keep the player\'s best score. The first submit to a name creates the board and sets its order.' },
		{ label: 'ctx.leaderboards.best(name, player)', detail: '(name, player) => Promise<{ score, rank } | null>', documentation: 'A player\'s best score and rank.' },
		{ label: 'ctx.leaderboards.top(name, { limit })', detail: '(name, options?) => Promise<{ rank, displayName, score, isMe }[]>', documentation: 'The best rows of a board.' },
		{ label: 'ctx.leaderboards.showOn(scoreboardId, name)', detail: '(scoreboardSlotId, name, options?) => Promise', documentation: 'Fill a scoreboard slot with a board\'s top rows.' },
		{ label: 'ctx.audio.analyze(source)', detail: '(source: SourceRef) => Promise<{ duration, bpm, bpmConfidence, onsets, energy }>', documentation: 'Decode an audio source and read its onsets ({ t, strength, band: low | mid | high }), tempo and band energy. Cached per source.' },
		{ label: 'ctx.audio.playTrack(source)', detail: '(source: SourceRef, { volume?, loop?, offset? }) => Promise<{ time(), duration, playing, ended, pause(), resume(), stop(), setVolume(v) }>', documentation: 'Play an audio source now, not positioned in the world. time() is the position on the audio clock, for syncing gameplay or visuals.' },
		{ label: 'ctx.world.isHost()', detail: '() => boolean', documentation: 'Check whether this peer is authoritative.' },
		{ label: 'ctx.hierarchy.getChildren(id)', detail: '(id: string | null) => Slot[]', documentation: 'Return direct children of a slot.' },
		{ label: 'ctx.math.vecAdd(a, b)', detail: '(a: Vec3, b: Vec3) => Vec3', documentation: 'Add two vectors.' },
		{ label: 'ctx.hierarchy.getWorldPose(id)', detail: '(id: string) => { position, rotation, forward, up, right } | undefined', documentation: 'True world pose of any slot, e.g. a gun Muzzle child. Correct under nested rotation and scale.' },
		{ label: 'ctx.equip.isEquipped()', detail: '() => boolean', documentation: 'Whether this object (or the one it belongs to) is equipped in a hand.' },
		{ label: 'ctx.equip.holder()', detail: '() => { playerId, hand } | null', documentation: 'Which player and hand have this object equipped.' },
		{ label: 'ctx.math.rotateVec(q, v)', detail: '(q: Quat, v: Vec3) => Vec3', documentation: 'Rotate a vector by a quaternion.' },
		{ label: 'ctx.math.quatMultiply(a, b)', detail: '(a: Quat, b: Quat) => Quat', documentation: 'Combine two rotations.' },
		{ label: 'ctx.math.vecScale(value, scalar)', detail: '(value: Vec3, scalar: number) => Vec3', documentation: 'Scale a vector.' }
	];

	const handlerSnippets = [
		{ label: 'onEquip', detail: '(event) => void', insertText: 'onEquip(e) {\n\t$0\n}' },
		{ label: 'onUnequip', detail: '(event) => void', insertText: 'onUnequip(e) {\n\t$0\n}' },
		{ label: 'onTrigger', detail: '(event) => boolean | void — return false to not consume the press', insertText: 'onTrigger(e) {\n\tif (e.phase !== \'press\') return true;\n\t$0\n\treturn true;\n}' },
		{ label: 'onSpawn', detail: 'lifecycle handler', insertText: 'onSpawn() {\n\t$0\n}' },
		{ label: 'onPlayerReady', detail: '(player: { id, name }) => void | Promise — restore saved data', insertText: 'async onPlayerReady(player) {\n\t$0\n}' },
		{ label: 'onGrab', detail: 'lifecycle handler', insertText: 'onGrab() {\n\t$0\n}' },
		{ label: 'onRelease', detail: 'lifecycle handler', insertText: 'onRelease() {\n\t$0\n}' },
		{ label: 'onPress', detail: 'button handler', insertText: 'onPress() {\n\t$0\n}' },
		{ label: 'onUIEvent', detail: '(event: { type: press|change|submit, slotId, text? }) => void', insertText: 'onUIEvent(e) {\n\t$0\n}' },
		{ label: 'tick', detail: '(dt: number) => void', insertText: 'tick(dt) {\n\t$0\n}' },
		{ label: 'getRadialItems', detail: 'radial menu handler', insertText: 'getRadialItems() {\n\treturn [];\n}' }
	];

	onMount(() => {
		void initialize();
	});

	async function initialize() {
		const monaco = await import('monaco-editor');
		(globalThis as typeof globalThis & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
			getWorker(_workerId: string, label: string) {
				if (label === 'json') return new JsonWorker();
				return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker();
			}
		};

		const isJs = language === 'javascript';
		if (isJs) monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
			target: monaco.languages.typescript.ScriptTarget.ES2020,
			allowNonTsExtensions: true,
			checkJs: false
		});
		// CodeBlocks contain a function body, not a complete JS module. Monaco still
		// supplies tokenization/completions; custom Slot-aware markers provide lint.
		if (isJs) monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
			noSemanticValidation: true,
			noSyntaxValidation: true
		});

		const completionDisposable = isJs ? monaco.languages.registerCompletionItemProvider('javascript', {
			triggerCharacters: ['.', '('],
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position);
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
				const lineBeforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
				const insertForContext = (label: string) => {
					if (lineBeforeCursor.endsWith('ctx.')) return label.startsWith('ctx.') ? label.slice(4) : label;
					if (/ctx\.(self|world|hierarchy|grab|math|net|ui)\.$/.test(lineBeforeCursor)) return label.split('.').at(-1) ?? label;
					return label;
				};
				const suggestions = [
					...completionEntries.map((entry) => ({
						label: entry.label,
						kind: monaco.languages.CompletionItemKind.Method,
						detail: entry.detail,
						documentation: entry.documentation,
						insertText: insertForContext(entry.label),
						range
					})),
					...handlerSnippets.map((entry) => ({
						label: entry.label,
						kind: monaco.languages.CompletionItemKind.Function,
						detail: entry.detail,
						insertText: entry.insertText,
						insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
						range
					}))
				];
				return { suggestions };
			}
		}) : undefined;

		const hoverDisposable = isJs ? monaco.languages.registerHoverProvider('javascript', {
			provideHover(model, position) {
				const token = model.getWordAtPosition(position);
				if (!token) return null;
				const match = completionEntries.find((entry) => entry.label.endsWith(token.word) || entry.label === token.word);
				return match ? { contents: [{ value: `**${match.label}**` }, { value: match.documentation }] } : null;
			}
		}) : undefined;

		editor = monaco.editor.create(host, {
			value,
			language,
			theme: 'vs-dark',
			automaticLayout: true,
			minimap: { enabled: true, scale: 1 },
			fontFamily: "'DM Mono', 'SFMono-Regular', Consolas, monospace",
			fontSize: 12,
			lineHeight: 20,
			padding: { top: 14, bottom: 14 },
			renderLineHighlight: 'all',
			renderWhitespace: 'selection',
			lineNumbersMinChars: 3,
			bracketPairColorization: { enabled: true },
			 guides: { bracketPairs: true, indentation: true },
			quickSuggestions: true,
			suggestOnTriggerCharacters: true,
			scrollBeyondLastLine: false,
			wordWrap: 'on',
			autoIndent: 'full',
			tabSize: 2,
			insertSpaces: true,
			overviewRulerBorder: false,
			fixedOverflowWidgets: true
		});

		const model = editor.getModel();
		const updateMarkers = () => {
			if (!model || !isJs) return;
			const markers = lintCode(model.getValue()).map((diagnostic) => ({
				severity: diagnostic.severity === 'error' ? monaco.MarkerSeverity.Error : diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
				message: diagnostic.message,
				startLineNumber: diagnostic.line,
				startColumn: 1,
				endLineNumber: diagnostic.line,
				endColumn: Math.max(2, model.getLineLength(diagnostic.line) + 1)
			}));
			monaco.editor.setModelMarkers(model, 'studio-codeblock', markers);
		};
		updateMarkers();
		const changeDisposable = model?.onDidChangeContent(() => {
			updateMarkers();
			onChange(model.getValue());
		});
		editor.addAction({
			id: 'studio.format-codeblock',
			label: 'Format CodeBlock',
			keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
			run: () => formatEditor()
		});
		isReady = true;
		onFormatReady(formatEditor);

		disposeEditor = () => {
			changeDisposable?.dispose();
			completionDisposable?.dispose();
			hoverDisposable?.dispose();
			if (model) {
				monaco.editor.setModelMarkers(model, 'studio-codeblock', []);
				model.dispose();
			}
			editor?.dispose();
		};
	}

	onDestroy(() => disposeEditor?.());

	function formatCode(source: string): string {
		if (language === 'json') {
			try { return JSON.stringify(JSON.parse(source), null, 2); } catch { return source; }
		}
		let depth = 0;
		return source.split('\n').map((line) => {
			const trimmed = line.trim();
			if (!trimmed) return '';
			if (/^[}\])]/.test(trimmed)) depth = Math.max(0, depth - 1);
			const result = `${'  '.repeat(depth)}${trimmed}`;
			const opens = (trimmed.match(/[({[]/g) ?? []).length;
			const closes = (trimmed.match(/[)}\]]/g) ?? []).length;
			depth = Math.max(0, depth + opens - closes);
			return result;
		}).join('\n');
	}

	function formatEditor(): void {
		if (!editor || isFormatting) return;
		isFormatting = true;
		const model = editor.getModel();
		if (model) {
			const formatted = formatCode(model.getValue());
			editor.executeEdits('studio-format', [{ range: model.getFullModelRange(), text: formatted }]);
			editor.pushUndoStop();
		}
		isFormatting = false;
	}
</script>

<div class="monaco-editor-root" class:ready={isReady} bind:this={host} aria-label={language === 'json' ? 'Monaco JSON editor' : 'Monaco JavaScript editor'}>
	{#if !isReady}<div class="editor-loading"><span class="spinner"></span>Starting Monaco language services…</div>{/if}
</div>

<style>
	.monaco-editor-root { position: relative; min-height: 360px; flex: 1; overflow: hidden; background: #0b0e14; }
	.editor-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; color: #697184; background: #0b0e14; font: 10px 'DM Mono', monospace; }
	.spinner { width: 14px; height: 14px; border: 2px solid #343b4b; border-top-color: #a99cf7; border-radius: 50%; animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
