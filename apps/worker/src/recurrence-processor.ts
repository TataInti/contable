import { withWorkerTenant } from "./lib/prisma.js";

/**
 * F2.4: procesador de recurrencias (cola recurrences).
 *
 * Procesa recordatorios de obligaciones programados (obligation_reminders).
 * El job es idempotente: si el recordatorio ya fue despachado, no se duplica.
 */

export interface RecurrenceJobData {
  reminderId: string;
  firmId: string;
  clientId: string;
}

export async function processRecurrence(name: string, data: unknown): Promise<void> {
  const job = data as RecurrenceJobData;
  if (!job?.reminderId) {
    throw new Error(`INVALID_RECURRENCE_JOB:${name}`);
  }

  await withWorkerTenant(job.firmId, job.clientId, async (tx) => {
    const reminder = await tx.obligationReminder.findUnique({
      where: { id: job.reminderId },
    });
    if (!reminder) throw new Error(`REMINDER_NOT_FOUND:${job.reminderId}`);
    if (!reminder.instanceId) throw new Error(`REMINDER_NO_INSTANCE:${job.reminderId}`);

    // Idempotente: si ya se despachó para la instancia, no duplica.
    const existing = await tx.reminderDispatch.findFirst({
      where: { reminderId: job.reminderId, instanceId: reminder.instanceId },
    });
    if (existing) return;

    // Crea una notificación interna para el usuario responsable.
    const notification = await tx.userNotification.create({
      data: {
        userId: job.firmId,
        firmId: job.firmId,
        clientId: job.clientId,
        type: "OBLIGATION_REMINDER",
        severity: "INFO",
        title: "Recordatorio de obligación",
        body: `La obligación tiene un recordatorio programado.`,
        resourceType: "obligation_reminder",
        resourceId: job.reminderId,
        deduplicationKey: `reminder:${job.reminderId}`,
      },
    });

    await tx.reminderDispatch.create({
      data: {
        firmId: job.firmId,
        clientId: job.clientId,
        reminderId: job.reminderId,
        instanceId: reminder.instanceId,
        scheduledFor: new Date(),
        status: "SENT",
        providerMessageId: notification.id,
      },
    });
  });
}