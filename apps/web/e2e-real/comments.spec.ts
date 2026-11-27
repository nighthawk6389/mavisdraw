import { test, expect, type Page } from '@playwright/test';
import {
  apiGetDiagram,
  linkIn,
  waitForEmail,
  dragOnCanvas,
  dragPage,
  getActiveElements,
  screenCenterOf,
  twoPeople,
} from './helpers';

const pins = (page: Page) => page.getByTestId('comment-pin');

async function pinBox(page: Page) {
  const box = await pins(page).first().boundingBox();
  if (!box) throw new Error('no pin');
  return box;
}

test.describe('Comments', () => {
  test('a viewer comments on a shape, @mentions the owner, and they talk it through live', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b, owner } = await twoPeople(browser, 'viewer', {
      owner: 'Olivia Owner',
      guest: 'Victor Viewer',
    });

    // Olivia draws the shape under discussion
    await a.keyboard.press('r');
    await dragOnCanvas(a, { x: 200, y: 180 }, { x: 360, y: 280 });
    await expect.poll(async () => (await getActiveElements(b)).length).toBe(1);

    // Victor can't edit, but he can comment: C, click the shape, type, @mention
    await expect(b.getByTestId('view-only-badge')).toBeVisible();
    await b.keyboard.press('c');
    const [shape] = await getActiveElements(b);
    const center = await screenCenterOf(b, shape);
    await b.mouse.click(center.x, center.y);
    const input = b.getByTestId('comment-input');
    await expect(input).toBeFocused();
    await input.pressSequentially('Should this call be async? @Oli');
    await expect(b.getByRole('option', { name: 'Olivia Owner' })).toBeVisible();
    await input.press('Enter'); // picks the suggestion
    await input.pressSequentially('what do you think?');
    await expect(input).toHaveValue('Should this call be async? @Olivia Owner what do you think?');
    await input.press('Enter'); // posts
    await expect(b.getByTestId('comment-thread')).toContainText('Victor Viewer');
    await expect(b.getByTestId('comment-thread').locator('.text-blue-700')).toHaveText(
      '@Olivia Owner',
    );

    // The mention also reaches Olivia by email, linking straight to the thread
    const mail = await waitForEmail(ctxA.request, owner.email, /Victor Viewer mentioned you in /);
    expect(mail.text).toContain('Should this call be async?');
    const threadLink = linkIn(mail);
    expect(threadLink).toMatch(/\/p\/[^/]+\/d\/[^/]+\?thread=/);

    // Olivia sees the pin appear without reloading, and gets a mention notification
    await expect(pins(a)).toHaveCount(1);
    await expect(a.getByTestId('notification-count')).toHaveText('1');
    await a.getByTestId('notification-bell').click();
    await expect(a.getByTestId('notification-item')).toContainText('Victor Viewer mentioned you');
    await a.getByTestId('notification-item').click();
    await expect(a.getByTestId('notification-count')).toHaveCount(0);
    const thread = a.getByTestId('comment-thread');
    await expect(thread).toContainText('Should this call be async?');

    // She replies; Victor sees it in his open thread, and is notified of the reply
    const reply = a.getByTestId('comment-reply');
    await reply.fill('Yes, let’s make it a queue.');
    await reply.press('Enter');
    await expect(b.getByTestId('comment-thread')).toContainText('let’s make it a queue');
    await expect(b.getByTestId('notification-count')).toHaveText('1', { timeout: 35_000 });
    await expect(thread.getByTestId('comment')).toHaveCount(2);

    // The pin is attached to the shape: when Olivia moves it, the pin follows on Victor's screen
    await a.keyboard.press('Escape');
    const before = await pinBox(b);
    const [moved] = await getActiveElements(a);
    const c = await screenCenterOf(a, moved);
    await dragPage(a, { x: c.x - 30, y: c.y + 20 }, { x: c.x + 170, y: c.y + 20 });
    await expect.poll(async () => (await pinBox(b)).x).toBeGreaterThan(before.x + 150);

    // Resolving hides it for everyone; it's still there under "Resolved"
    await pins(a).first().click();
    await a.getByRole('button', { name: '✓ Resolve' }).click();
    await expect(pins(a)).toHaveCount(0);
    // Victor still has it open (he might be mid-reply): it shows as resolved,
    // and disappears once he closes it
    await expect(b.getByTestId('comment-thread')).toContainText('Resolved');
    await b.getByTestId('comment-thread').getByRole('button', { name: 'Close' }).click();
    await expect(pins(b)).toHaveCount(0);
    await b.reload();
    await b.getByRole('button', { name: /^Comments/ }).click();
    await expect(b.getByTestId('comments-panel-item')).toHaveCount(0);
    await b.getByTestId('comments-panel').getByLabel('Resolved').check();
    await expect(b.getByTestId('comments-panel-item')).toContainText('Should this call be async?');

    // Later, Olivia opens the link from the email: straight to the thread
    await a.goto(new URL(threadLink).pathname + new URL(threadLink).search);
    await expect(a.getByTestId('comment-thread')).toContainText('Should this call be async?');

    await ctxA.close();
    await ctxB.close();
  });

  test('the comments panel spans every nested level and drills to the thread', async ({
    browser,
  }) => {
    const { ctxA, ctxB, a, b, owner, project } = await twoPeople(browser, 'editor', {
      owner: 'Olivia Owner',
      guest: 'Eli Editor',
    });

    // Olivia comments inside a nested diagram
    await a.keyboard.press('o');
    await dragOnCanvas(a, { x: 200, y: 160 }, { x: 420, y: 300 });
    const [portal] = await getActiveElements(a);
    const pc = await screenCenterOf(a, portal);
    await a.mouse.dblclick(pc.x, pc.y);
    await expect(a).toHaveURL(new RegExp(`/d/${portal.targetDiagramId}$`));
    await a.keyboard.press('c');
    await a.mouse.click(pc.x, pc.y);
    await a.getByTestId('comment-input').fill('Is the auth service in here too?');
    await a.getByTestId('comment-input').press('Enter');
    await expect(pins(a)).toHaveCount(1);

    // Eli is on the top level: nothing pinned here, but the panel lists it with where it lives
    await expect(pins(b)).toHaveCount(0);
    await b.getByRole('button', { name: /^Comments/ }).click();
    const item = b.getByTestId('comments-panel-item');
    await expect(item).toContainText('Is the auth service in here too?', { timeout: 10_000 });
    const nested = await apiGetDiagram(ctxA.request, owner, String(portal.targetDiagramId));
    const title = String((nested.diagram as { title?: string }).title);
    expect(title.length).toBeGreaterThan(0);
    await expect(item).toContainText(`⧉ ${title}`);

    // Clicking drills into that level and opens the thread
    await item.click();
    await expect(b).toHaveURL(new RegExp(`/p/${project.id}/d/${portal.targetDiagramId}$`));
    await expect(b.getByTestId('comment-thread')).toContainText('Is the auth service in here too?');
    await expect(pins(b)).toHaveCount(1);

    await ctxA.close();
    await ctxB.close();
  });
});
