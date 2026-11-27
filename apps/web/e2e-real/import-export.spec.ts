import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
  API_URL,
  apiCreateProject,
  apiGetDiagram,
  getActiveElements,
  openProject,
  registerUser,
  waitForSaved,
} from './helpers';

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const box = (id: string, diagramId: string, x: number) => ({
  id,
  type: 'rectangle',
  diagramId,
  x,
  y: 100,
  width: 120,
  height: 80,
  angle: 0,
  opacity: 100,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 0,
  seed: 1,
  renderMode: 'clean',
  layerId: 'default',
  groupIds: [],
  isLocked: false,
  isDeleted: false,
  boundElements: [],
  version: 1,
});

/** Export the open project as a .mavisdraw file and return its text. */
async function exportFile(page: Page): Promise<string> {
  await page.locator('button[title="Export diagram"]').click();
  await page.locator('select').selectOption('mavisdraw');
  const download = page.waitForEvent('download');
  await page.locator('button.bg-blue-600:has-text("Export")').click();
  return readFile(await (await download).path(), 'utf8');
}

test.describe('Import and export', () => {
  test('a map exported from one project and imported into another lands there and stays', async ({
    page,
    context,
  }, testInfo) => {
    const user = await registerUser(context, 'Mover');
    const auth = { Authorization: `Bearer ${user.accessToken}` };
    const nameA = `Source ${uniq()}`;
    const nameB = `Target ${uniq()}`;
    const a = await apiCreateProject(context.request, user, nameA);
    const b = await apiCreateProject(context.request, user, nameB);
    for (const [project, boxes] of [
      [a, [box('a-web', a.rootDiagramId, 100), box('a-api', a.rootDiagramId, 400)]],
      [b, [box('b-own', b.rootDiagramId, 100)]],
    ] as const) {
      const res = await context.request.put(`${API_URL}/api/diagrams/${project.rootDiagramId}`, {
        headers: auth,
        data: { elements: boxes },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }

    // Export A
    await openProject(page, nameA);
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(2);
    const file = await exportFile(page);
    expect(
      JSON.parse(file)
        .scene.elements.map((e: { id: string }) => e.id)
        .sort(),
    ).toEqual(['a-api', 'a-web']);
    const path = testInfo.outputPath('source.mavisdraw');
    await writeFile(path, file);

    // Import it into B
    await openProject(page, nameB);
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(1);
    page.once('dialog', (d) => void d.accept());
    await page.locator('#import-file-input').setInputFiles(path);
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(3);
    await waitForSaved(page);

    // B has its own shape and the imported ones — on the server, after a reload
    const onServer = async (diagramId: string) =>
      ((await apiGetDiagram(context.request, user, diagramId)).diagram?.elements ?? [])
        .filter((e) => !e.isDeleted)
        .map((e) => e.x as number)
        .sort((x, y) => x - y);
    await expect.poll(() => onServer(b.rootDiagramId), { timeout: 15_000 }).toHaveLength(3);
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect.poll(async () => (await getActiveElements(page)).length).toBe(3);
    // …and A, where the file came from, is untouched
    expect(await onServer(a.rootDiagramId)).toEqual([100, 400]);
  });
});
