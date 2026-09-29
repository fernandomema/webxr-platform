export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CodeDiagnostic {
	severity: DiagnosticSeverity;
	message: string;
	/** 1-based. */
	line: number;
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * Finds the first bracket problem, ignoring brackets inside strings, template
 * literals and comments. Regex literals are not understood, which is an
 * acceptable trade-off for a hint that only runs alongside a real syntax check.
 */
export function findBracketProblem(code: string): { message: string; line: number } | null {
	const stack: { char: string; line: number }[] = [];
	let line = 1;
	for (let i = 0; i < code.length; i++) {
		const char = code[i];
		const next = code[i + 1];
		if (char === '\n') line++;
		else if (char === '/' && next === '/') {
			while (i < code.length && code[i] !== '\n') i++;
			line++;
		} else if (char === '/' && next === '*') {
			i += 2;
			while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
				if (code[i] === '\n') line++;
				i++;
			}
			i++;
		} else if (char === '"' || char === "'" || char === '`') {
			for (i++; i < code.length && code[i] !== char; i++) {
				if (code[i] === '\\') i++;
				else if (code[i] === '\n') {
					line++;
					if (char !== '`') break;
				}
			}
		} else if (char in CLOSERS) stack.push({ char, line });
		else if (char === ')' || char === ']' || char === '}') {
			const open = stack.pop();
			if (!open) return { message: `Unexpected "${char}".`, line };
			if (CLOSERS[open.char] !== char) return { message: `Expected "${CLOSERS[open.char]}" to close "${open.char}" from line ${open.line}, found "${char}".`, line };
		}
	}
	const open = stack.pop();
	return open ? { message: `"${open.char}" is never closed.`, line: open.line } : null;
}

/** Compiles (never runs) the block the same way the game does, to surface syntax errors. */
export function findSyntaxError(code: string): string | null {
	try {
		new Function('ctx', code);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : 'Invalid code.';
	}
}

export function lintCode(code: string): CodeDiagnostic[] {
	const diagnostics: CodeDiagnostic[] = [];
	const lines = code.split('\n');

	const bracket = findBracketProblem(code);
	const syntax = findSyntaxError(code);
	if (bracket) diagnostics.push({ severity: 'error', message: bracket.message, line: bracket.line });
	else if (syntax) diagnostics.push({ severity: 'error', message: syntax, line: 1 });
	if (syntax || bracket) return diagnostics;

	if (!code.trim()) {
		diagnostics.push({ severity: 'info', message: 'This code block is empty.', line: 1 });
		return diagnostics;
	}
	if (!/return\s*\{/.test(code)) diagnostics.push({ severity: 'warning', message: 'Return an object to expose event handlers.', line: 1 });
	else if (!/(onSpawn|onGrab|onRelease|onPress|onEquip|onUnequip|onTrigger|tick|getRadialItems)\s*[(:]/.test(code)) {
		diagnostics.push({ severity: 'info', message: 'Add at least one lifecycle handler to make this block active.', line: 1 });
	}
	lines.forEach((text, index) => {
		if (/\b(document|window)\.|\bfetch\(/.test(text.replace(/\/\/.*$/, ''))) {
			diagnostics.push({ severity: 'warning', message: 'Prefer the bounded ctx API inside a code block.', line: index + 1 });
		}
	});
	return diagnostics;
}
