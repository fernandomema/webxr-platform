import { BakeError, runBake, type BakeReply, type BakeRequest } from './bakeJob.ts';

// The project also includes DOM code, so use the small worker surface rather than mixing DOM and WebWorker lib types.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<BakeRequest>) => void) | null;
	postMessage(reply: BakeReply, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data }) => {
	try {
		let last = 0;
		const { bytes, stats } = await runBake(data, (fraction) => {
			if (fraction - last >= 0.01 || fraction >= 1) { last = fraction; scope.postMessage({ type: 'progress', fraction }); }
		});
		scope.postMessage({ type: 'done', bytes, stats }, [bytes.buffer]);
	} catch (error) {
		scope.postMessage({ type: 'error', message: error instanceof BakeError || error instanceof Error ? error.message : 'The bake failed.' });
	}
};
