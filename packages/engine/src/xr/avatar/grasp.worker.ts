import { solveGraspPose, type GraspJob, type GraspReply } from './graspPose.ts';

// The project also includes DOM code, so use the small worker surface rather than mixing DOM and WebWorker lib types.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<GraspJob>) => void) | null;
	postMessage(reply: GraspReply): void;
};
scope.onmessage = ({ data }) => scope.postMessage({ id: data.id, pose: solveGraspPose(data.input) });
