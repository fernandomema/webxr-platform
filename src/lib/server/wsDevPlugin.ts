import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import signalingHandler from './signaling.ts';

const ROUTE = '/signaling';

/**
 * Attaches the signaling WebSocket to Vite's own dev http server, on the
 * same route/handler used in production (see ../../../server.ts). Only
 * intercepts upgrades for ROUTE — Vite's own HMR websocket upgrade handling
 * is untouched for every other path.
 */
export function signalingDevPlugin(): Plugin {
	return {
		name: 'webxr-platform:signaling-dev',
		configureServer(server: ViteDevServer) {
			if (!server.httpServer) return;
			const wss = new WebSocketServer({ noServer: true });

			server.httpServer.on('upgrade', (req, socket, head) => {
				if (!req.url) return;
				const { pathname } = new URL(req.url, 'http://localhost');
				if (pathname !== ROUTE) return;

				wss.handleUpgrade(req, socket, head, (ws) => {
					signalingHandler(ws, req);
				});
			});
		}
	};
}
