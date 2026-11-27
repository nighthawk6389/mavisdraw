import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from './client.js';
import { users, projects, diagrams } from './schema.js';

async function seed() {
  // A demo account with a published password must never exist in production
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed a production database (it creates a demo account with a known password).');
    process.exit(1);
  }
  console.log('Seeding database...');

  // Check if demo user already exists
  const existing = await db.select().from(users).where(eq(users.email, 'demo@mavisdraw.dev'));
  if (existing.length > 0) {
    console.log('Demo user already exists, skipping seed.');
    process.exit(0);
  }

  // Create a demo user
  const userId = nanoid();
  const now = new Date();
  const passwordHash = await bcrypt.hash('password123', 10);

  await db.insert(users).values({
    id: userId,
    email: 'demo@mavisdraw.dev',
    emailVerifiedAt: new Date(),
    name: 'Demo User',
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  // Create a demo project
  const projectId = nanoid();
  const rootDiagramId = nanoid();

  await db.insert(projects).values({
    id: projectId,
    name: 'My First Project',
    ownerId: userId,
    rootDiagramId,
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  });

  // Create root diagram
  await db.insert(diagrams).values({
    id: rootDiagramId,
    projectId,
    title: 'Root Diagram',
    elements: [],
    layers: [
      {
        id: nanoid(),
        name: 'Layer 1',
        isVisible: true,
        isLocked: false,
        opacity: 100,
        order: 0,
      },
    ],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });

  console.log('Seed complete!');
  console.log(`Demo user: demo@mavisdraw.dev / password123`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
