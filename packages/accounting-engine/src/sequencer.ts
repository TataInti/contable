/**
 * Secuenciador de asientos por cliente/ejercicio.
 * Fuera de transacción sólo valida; la asignación atómica ocurre en la base.
 */

export interface SequenceState {
  clientId: string;
  fiscalYearId: string;
  next: number;
}

const states = new Map<string, SequenceState>();

function key(clientId: string, fiscalYearId: string): string {
  return `${clientId}:${fiscalYearId}`;
}

/** Consulta el próximo número sin consumirlo. */
export function peekNext(clientId: string, fiscalYearId: string): number {
  return states.get(key(clientId, fiscalYearId))?.next ?? 1;
}

/** Reserva el próximo número (usa el estado en memoria). */
export function reserveNext(clientId: string, fiscalYearId: string): number {
  const k = key(clientId, fiscalYearId);
  const state = states.get(k) ?? { clientId, fiscalYearId, next: 1 };
  const next = state.next;
  states.set(k, { ...state, next: next + 1 });
  return next;
}

/** Permite al adaptor persistente registrar el estado inicial desde la base. */
export function seedState(clientId: string, fiscalYearId: string, next: number): void {
  states.set(key(clientId, fiscalYearId), { clientId, fiscalYearId, next });
}

/** Utilizado en tests para resetear. */
export function resetSequencer(): void {
  states.clear();
}