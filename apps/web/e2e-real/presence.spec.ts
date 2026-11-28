import { test, expect } from '@playwright/test';
import { liveBarrier, twoPeople } from './helpers';

/** The signed-in user's id, from their access token. */
const userIdOf = (accessToken: string) =>
  (JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString()) as { userId: string })
    .userId;

test('people show up as who they signed in as, whatever their app claims', async ({ browser }) => {
  const { ctxA, ctxB, a, b, owner } = await twoPeople(browser, 'editor', {
    owner: 'Olivia Owner',
    guest: 'Gus Guest',
  });
  await expect(a.getByRole('button', { name: 'Follow Gus Guest' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Follow Olivia Owner' })).toBeVisible();

  // The guest's app says it's the owner
  await b.evaluate(async (ownerId) => {
    const m = await import('/src/stores/collaborationStore.ts');
    m.useCollaborationStore
      .getState()
      .provider!.setAwarenessField('user', { id: ownerId, name: 'Olivia Owner', color: '#000' });
  }, userIdOf(owner.accessToken));
  await liveBarrier(b, a);

  // The owner still sees the guest as the guest
  await expect(a.getByRole('button', { name: 'Follow Gus Guest' })).toBeVisible();
  await expect(a.getByRole('button', { name: /Follow Olivia/ })).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
