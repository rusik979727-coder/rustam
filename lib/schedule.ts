export type Slot = { id?: number; startAt: Date; endAt: Date };

/** Екі уақыт аралығы қиылыса ма (шеттері тиіп тұрса — қиылыспайды). */
export function overlaps(a: Slot, b: Slot) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Жаңа жазба бар жазбалармен қақтығыса ма. */
export function findConflict(candidate: Slot, existing: Slot[]) {
  return existing.find((e) => e.id !== candidate.id && overlaps(candidate, e)) ?? null;
}
