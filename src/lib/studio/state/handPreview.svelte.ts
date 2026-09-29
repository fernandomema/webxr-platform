/** Which hand (if any) the Studio viewport is previewing the selected equippable object in. */
class HandPreview {
	hand = $state<'left' | 'right' | null>(null);

	toggle(hand: 'left' | 'right'): void {
		this.hand = this.hand === hand ? null : hand;
	}
}

export const handPreview = new HandPreview();
