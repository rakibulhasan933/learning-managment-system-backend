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
