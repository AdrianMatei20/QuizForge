import { expect, test } from '@playwright/test';

/**
 * The teacher's whole flow in demo mode: open a seeded sample lesson,
 * generate a quiz (streamed, from the fake provider's fixtures), approve a
 * question, publish, and land on the published quiz with its student link.
 */
test('create a quiz from a sample lesson, approve a question and publish it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('note', { name: 'Demo mode' })).toContainText('sample lessons');

  // Seeded on first start; a lesson may be listed more than once after earlier runs.
  await page.getByRole('link', { name: 'Binary search' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Binary search' })).toBeVisible();

  await page.getByRole('button', { name: 'Generate another quiz' }).click();
  await page.getByRole('button', { name: 'Generate quiz' }).click();

  await expect(page).toHaveURL(/\/quizzes\/[0-9a-f-]{36}\/review$/);
  // Every question has arrived when generation is done and Publish waits only for an approval.
  await expect(page.getByText('Approve at least one question to publish.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(5);

  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Approved', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Publish quiz' }).click();

  await expect(page).toHaveURL(/\/quizzes\/[0-9a-f-]{36}\/published$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Published quiz' })).toBeVisible();
  await expect(page.locator('#student-link')).toHaveValue(/\/q\/[0-9a-f-]{36}$/);
});
