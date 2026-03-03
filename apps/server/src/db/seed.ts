import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { db } from './client.js';
import { users, projects, diagrams } from './schema.js';

async function seed() {
  console.log('Seeding database...');

  // Create a demo user
  const userId = nanoid();
  const now = new Date();
  const passwordHash = await bcrypt.hash('password123', 10);

  await db.insert(users).values({
    id: userId,
    email: 'demo@mavisdraw.dev',
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
