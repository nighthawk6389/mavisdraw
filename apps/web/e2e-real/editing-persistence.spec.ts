import { test, expect } from '@playwright/test';
import {
  registerUser,
  apiCreateProject,
  openProject,
  dragOnCanvas,
  getActiveElements,
  interactiveCanvas,
  waitForSaved,
} from './helpers';

test('stacking order, locks and labels survive a reload', async ({ page, context }) => {
  const user = await registerUser(context, 'Editor');
  await apiCreateProject(context.request, user, 'Order Service');
  await openProject(page, 'Order Service');

  // Two overlapping shapes; label the first
  await page.keyboard.press('r');
  await dragOnCanvas(page, { x: 200, y: 200 }, { x: 340, y: 300 });
  await page.keyboard.press('r');
  await dragOnCanvas(page, { x: 260, y: 240 }, { x: 400, y: 340 });
  const box = (await interactiveCanvas(page).boundingBox())!;
  await page.mouse.dblclick(box.x + 215, box.y + 215);
  await page.keyboard.type('Orders DB');
  await page.keyboard.press('Enter');

  // Send the top shape to the back and lock it
  await page.mouse.click(box.x + 380, box.y + 330, { button: 'right' });
  await page.getByRole('menuitem', { name: /Send to back/ }).click();
  await page.mouse.click(box.x + 380, box.y + 330, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Lock/ }).click();
  await waitForSaved(page);

  const before = await getActiveElements(page);
  const top = before.find((e) => e.type === 'rectangle' && e.x === 260)!;
  const first = before.find((e) => e.type === 'rectangle' && e.x === 200)!;
  expect(top.isLocked).toBe(true);
  expect((top.zIndex as number)).toBeLessThan(first.zIndex as number);

  await page.reload();
  await openProject(page, 'Order Service');
  await expect.poll(async () => (await getActiveElements(page)).length).toBe(3);
  const after = await getActiveElements(page);
  const topAfter = after.find((e) => e.id === top.id)!;
  const firstAfter = after.find((e) => e.id === first.id)!;
  const label = after.find((e) => e.type === 'text')!;
  expect(topAfter.isLocked).toBe(true);
  expect(topAfter.zIndex as number).toBeLessThan(firstAfter.zIndex as number);
  expect(label.text).toBe('Orders DB');
  expect(label.containerId).toBe(first.id);
});
