export type Assignable = { id: number; lastAssignedAt: Date | null };

/** Round-robin: ең ұзақ лид алмаған менеджер (ешқашан алмаған — бірінші). */
export function pickManager(managers: Assignable[]): Assignable | null {
  if (!managers.length) return null;
  return [...managers].sort((a, b) => {
    const ta = a.lastAssignedAt?.getTime() ?? 0;
    const tb = b.lastAssignedAt?.getTime() ?? 0;
    return ta - tb || a.id - b.id;
  })[0];
}
