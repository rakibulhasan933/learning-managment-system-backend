import { notifications } from '../database/index.js';

import { db } from './database.js';

export async function createNotification(input: {
  profileId: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
}) {
  await db.insert(notifications).values({
    body: input.body,
    href: input.href ?? null,
    profileId: input.profileId,
    title: input.title,
    type: input.type,
  });
}

export async function createNotifications(
  inputs: Array<Parameters<typeof createNotification>[0]>,
) {
  if (inputs.length === 0) return;
  await db
    .insert(notifications)
    .values(inputs.map((input) => ({ ...input, href: input.href ?? null })));
}

/**
 * Best-effort notification wrapper. Swallows every error (missing table,
 * DB outage, etc.) and NEVER throws, so the surrounding business flow —
 * payments, refunds, grading — always completes regardless of whether the
 * notification was saved. Never use this where the caller needs to know
 * whether the notification was delivered.
 */
export async function notifySafely(
  input: Parameters<typeof createNotification>[0],
): Promise<void> {
  try {
    await createNotification(input);
  } catch (error) {
    console.error('Notification could not be saved.', error);
  }
}

/**
 * Best-effort batch version of notifySafely. Never throws.
 */
export async function notifyManySafely(
  inputs: Array<Parameters<typeof createNotification>[0]>,
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await createNotifications(inputs);
  } catch (error) {
    console.error('Notifications could not be saved.', error);
  }
}
