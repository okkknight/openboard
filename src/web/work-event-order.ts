export interface OrderedWorkEvent { work_id?: string; sequence?: number; }

/** Returns false without changing state when an event cannot advance its work stream. */
export function acceptWorkEvent(lastSequence: Map<string, number>, event: OrderedWorkEvent): boolean {
  if (!event.work_id || !Number.isInteger(event.sequence)) return false;
  const previous = lastSequence.get(event.work_id) ?? 0;
  if (event.sequence! <= previous) return false;
  lastSequence.set(event.work_id, event.sequence!);
  return true;
}
