export const MOVE_DIRECTIONS = ['forward', 'back', 'left', 'right'] as const;
export type MoveDirection = typeof MOVE_DIRECTIONS[number];

/** Multiple contacts can hold one direction; releasing one must not cancel the other. */
export function createDirectionHolds(onChange: (direction: MoveDirection, pressed: boolean) => void) {
  const contacts = new Map<string, MoveDirection>();
  let enabled = true;
  function release(contact: string) {
    const previous = contacts.get(contact); if (!previous) return;
    contacts.delete(contact);
    if (![...contacts.values()].includes(previous)) onChange(previous, false);
  }
  function releaseAll() {
    const held = new Set(contacts.values()); contacts.clear();
    for (const direction of held) onChange(direction, false);
  }
  return {
    press(contact: string, direction: MoveDirection) {
      if (!enabled) return;
      if (contacts.get(contact) === direction) return;
      release(contact);
      const alreadyHeld = [...contacts.values()].includes(direction);
      contacts.set(contact, direction);
      if (!alreadyHeld) onChange(direction, true);
    },
    release,
    releaseAll,
    /** Reopening a view accepts fresh presses only; old contacts never resume. */
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) releaseAll();
    },
  };
}
