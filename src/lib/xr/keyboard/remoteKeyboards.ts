import { Color3, DynamicTexture, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import type { KeyboardPresence } from './presence';

/**
 * The stand-in of another player's keyboard: a blank board with rows of unlabelled keys where theirs is, so everyone can
 * see who is typing. Nothing on it moves and nothing is written on it: which key goes down would show what is typed.
 */
export class RemoteKeyboards {
	private boards = new Map<string, { root: TransformNode; body: Mesh; keys: Mesh }>();
	private bodyMaterial: StandardMaterial;
	private keysMaterial: StandardMaterial;
	private keysTexture: DynamicTexture;

	constructor(private scene: Scene) {
		this.bodyMaterial = new StandardMaterial('remote-keyboard-body', scene);
		this.bodyMaterial.diffuseColor = Color3.FromHexString('#0b1220');
		this.bodyMaterial.specularColor = Color3.Black();
		this.keysTexture = new DynamicTexture('remote-keyboard-keys', { width: 512, height: 256 }, scene, true);
		const context = this.keysTexture.getContext() as unknown as CanvasRenderingContext2D;
		context.fillStyle = '#0b1220';
		context.fillRect(0, 0, 512, 256);
		context.fillStyle = '#334155';
		const rows = 5, columns = 12;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < columns; c++) {
				const wide = r === rows - 1 && c >= 3 && c <= 8;
				if (r === rows - 1 && c > 3 && c <= 8) continue; // the space bar is one long key
				const w = wide ? (512 / columns) * 6 : 512 / columns;
				context.fillRect(c * (512 / columns) + 3, r * (256 / rows) + 3, w - 6, 256 / rows - 6);
			}
		}
		this.keysTexture.update(true);
		this.keysMaterial = new StandardMaterial('remote-keyboard-keys', scene);
		this.keysMaterial.diffuseTexture = this.keysTexture;
		this.keysMaterial.specularColor = Color3.Black();
	}

	/** Shows, moves or (when `keyboard` is undefined) removes a player's stand-in. */
	update(playerId: string, keyboard: KeyboardPresence | undefined): void {
		if (!keyboard) {
			this.remove(playerId);
			return;
		}
		let board = this.boards.get(playerId);
		if (!board) {
			const root = new TransformNode(`remote-keyboard-${playerId}`, this.scene);
			const body = MeshBuilder.CreateBox(`remote-keyboard-body-${playerId}`, { size: 1 }, this.scene);
			body.material = this.bodyMaterial;
			body.parent = root;
			body.isPickable = false;
			// The keys lie on the board, seen from above (a plane faces -Z until turned).
			const keys = MeshBuilder.CreatePlane(`remote-keyboard-keys-${playerId}`, { size: 1 }, this.scene);
			keys.material = this.keysMaterial;
			keys.parent = root;
			keys.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2);
			keys.isPickable = false;
			board = { root, body, keys };
			this.boards.set(playerId, board);
		}
		board.root.position = Vector3.FromArray(keyboard.position);
		board.root.rotationQuaternion = Quaternion.FromArray(keyboard.rotation);
		board.body.scaling.set(keyboard.width, 0.016, keyboard.depth);
		board.body.position.set(0, -0.008, 0);
		board.keys.scaling.set(keyboard.width * 0.85, keyboard.depth * 0.6, 1);
		board.keys.position.set(0, 0.001, -keyboard.depth * 0.08);
	}

	remove(playerId: string): void {
		this.boards.get(playerId)?.root.dispose();
		this.boards.delete(playerId);
	}

	dispose(): void {
		for (const playerId of [...this.boards.keys()]) this.remove(playerId);
		this.bodyMaterial.dispose();
		this.keysMaterial.dispose();
		this.keysTexture.dispose();
	}
}
