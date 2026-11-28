import { test, expect } from '@playwright/test';
import { API_URL, apiCreateProject, openProject, registerUser, runSql } from './helpers';

test('a share link can expire: the dialog says when, and past it nobody new joins', async ({
  browser,
}) => {
  const ownerCtx = await browser.newContext();
  const owner = await registerUser(ownerCtx, 'Link Owner');
  const project = await apiCreateProject(ownerCtx.request, owner, 'Expiring Links');
  const page = await ownerCtx.newPage();
  await openProject(page, 'Expiring Links');

  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByLabel('Link expires').selectOption({ label: 'Expires in 7 days' });
  await page.getByRole('button', { name: 'Create Link' }).click();
  const link = await page.locator('input[readonly]').inputValue();
  const token = link.split('/share/')[1];
  await expect(page.getByTestId('share-link-item')).toContainText('Expires in 7 days');

  // Before it expires, it works
  const joinerCtx = await browser.newContext();
  const joiner = await registerUser(joinerCtx, 'Early Joiner');
  const joinerPage = await joinerCtx.newPage();
  await joinerPage.goto(`/share/${token}`);
  await expect(joinerPage).toHaveURL(new RegExp(`/p/${project.id}`));

  // A week later
  runSql(
    `update project_permissions set expires_at = now() - interval '1 minute' where share_token = $1`,
    [token],
  );

  const lateCtx = await browser.newContext();
  const late = await registerUser(lateCtx, 'Late Joiner');
  const latePage = await lateCtx.newPage();
  await latePage.goto(`/share/${token}`);
  await expect(latePage.getByTestId('toast')).toContainText(
    "This share link doesn't work: It has expired. Ask whoever sent it for a new one.",
  );
  await expect(latePage).toHaveURL(/\/$/);
  const lateAccess = await lateCtx.request.get(`${API_URL}/api/projects/${project.id}`, {
    headers: { Authorization: `Bearer ${late.accessToken}` },
  });
  expect(lateAccess.status()).toBe(403);

  // Whoever joined in time keeps access
  const joinerAccess = await joinerCtx.request.get(`${API_URL}/api/projects/${project.id}`, {
    headers: { Authorization: `Bearer ${joiner.accessToken}` },
  });
  expect(joinerAccess.status()).toBe(200);

  // The owner sees it has expired
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByTestId('share-link-item')).toContainText('Expired');

  await ownerCtx.close();
  await joinerCtx.close();
  await lateCtx.close();
});
