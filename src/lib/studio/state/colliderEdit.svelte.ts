/** The slot whose collider box is being edited with handles in the Studio viewport, if any. */
class ColliderEdit {
	slotId = $state<string | null>(null);

	toggle(slotId: string): void {
		this.slotId = this.slotId === slotId ? null : slotId;
	}
}

export const colliderEdit = new ColliderEdit();
