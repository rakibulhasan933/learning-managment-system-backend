import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq, profiles, users } from '../database/index.js';

import { db } from '../lib/database.js';

const seedAdminSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(160),
  password: z.string().min(8),
});

function readSeedAdminInput() {
  return seedAdminSchema.parse({
    email: process.env.SEED_ADMIN_EMAIL,
    name: process.env.SEED_ADMIN_NAME,
    password: process.env.SEED_ADMIN_PASSWORD,
  });
}

async function seedAdmin() {
  const input = readSeedAdminInput();
  const now = new Date();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!existingUser) {
    const createdUser = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          authProvider: 'password',
          email: input.email,
          emailVerifiedAt: now,
          passwordHash,
          suspendedAt: null,
        })
        .returning();

      if (!user) {
        throw new Error('Admin user could not be created.');
      }

      const [profile] = await tx
        .insert(profiles)
        .values({
          fullName: input.name,
          role: 'admin',
          userId: user.id,
        })
        .returning();

      if (!profile) {
        throw new Error('Admin profile could not be created.');
      }

      return user;
    });

    console.log(`Created admin user ${input.email} (${createdUser.id})`);
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        authProvider: 'password',
        emailVerifiedAt: now,
        passwordHash,
        suspendedAt: null,
        updatedAt: now,
      })
      .where(eq(users.id, existingUser.id));

    const existingProfile = await tx.query.profiles.findFirst({
      where: eq(profiles.userId, existingUser.id),
    });

    if (existingProfile) {
      await tx
        .update(profiles)
        .set({
          fullName: input.name,
          role: 'admin',
          updatedAt: now,
        })
        .where(eq(profiles.userId, existingUser.id));
    } else {
      const [profile] = await tx
        .insert(profiles)
        .values({
          fullName: input.name,
          role: 'admin',
          userId: existingUser.id,
        })
        .returning();

      if (!profile) {
        throw new Error('Admin profile could not be created.');
      }
    }
  });

  console.log(`Updated admin user ${input.email} (${existingUser.id})`);
}

void seedAdmin().catch((error) => {
  console.error('Failed to seed admin user.');
  console.error(error);
  process.exitCode = 1;
});
