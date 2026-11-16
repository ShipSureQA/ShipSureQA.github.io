import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const FORM_ENDPOINT = 'https://api.web3forms.com/submit';

/** Block third-party fonts so tests are fast and don't depend on the network. */
async function open(page: Page, path = '/') {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(path);
}

test.describe('Page basics', () => {
  test('loads with correct title, description and social meta', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle(/ShipSure QA/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /7\+ years/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+\.png$/);
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  });

  test('has no JavaScript errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      // ignore resource errors caused by the font blocking above
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await open(page);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('has no horizontal overflow (responsive layout)', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('custom 404 page links back home', async ({ page }) => {
    await open(page, '/404.html');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('404');
    await expect(page.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });
});

test.describe('Navigation', () => {
  test('every in-page link points to an existing section', async ({ page }) => {
    await open(page);
    const hashes = await page.$$eval('a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')!));
    expect(hashes.length).toBeGreaterThan(0);
    for (const h of hashes) {
      expect(h, 'empty "#" link found').not.toBe('#');
      await expect(page.locator(h), `target for ${h}`).toHaveCount(1);
    }
  });

  test('external links are https and open safely', async ({ page }) => {
    await open(page);
    const links = await page.$$eval('a[href^="http"]', (as) =>
      as.map((a) => ({ href: a.getAttribute('href')!, rel: a.getAttribute('rel') ?? '' })));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.href, 'insecure link').toMatch(/^https:\/\//);
      expect(l.rel, `${l.href} missing rel=noopener`).toContain('noopener');
    }
  });

  test('project links point to real ShipSureQA repos', async ({ page }) => {
    await open(page);
    const repos = await page.$$eval('#projects a', (as) => as.map((a) => a.getAttribute('href')!));
    expect(repos.length).toBeGreaterThanOrEqual(3);
    for (const r of repos) expect(r).toMatch(/^https:\/\/(github\.com\/ShipSureQA\/|shipsureqa\.github\.io\/)/);
  });

  test('mobile menu opens, navigates and closes', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await open(page);
    const btn = page.getByRole('button', { name: /menu/i });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#menu').getByRole('link', { name: 'Contact' }).click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#contact')).toBeInViewport();
  });
});

test.describe('Contact form', () => {
  test('requires name, valid email and message', async ({ page }) => {
    await open(page);
    const form = page.locator('#contact-form');
    await form.getByRole('button', { name: /send/i }).click();
    expect(await form.locator('input[name="name"]').evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
    await form.getByLabel('Name').fill('Jane');
    await form.getByLabel('Email').fill('not-an-email');
    expect(await form.getByLabel('Email').evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
  });

  test('shows success message and resets after a successful send', async ({ page }) => {
    await open(page);
    await page.route(FORM_ENDPOINT, (r) => r.fulfill({ json: { success: true } }));
    await page.evaluate(() => {
      (document.querySelector('input[name="access_key"]') as HTMLInputElement).value = 'test-key';
    });
    const form = page.locator('#contact-form');
    await form.getByLabel('Name').fill('Jane Client');
    await form.getByLabel('Email').fill('jane@example.com');
    await form.getByLabel('Project details').fill('Need a Playwright suite');
    await form.getByRole('button', { name: /send/i }).click();
    await expect(page.locator('#form-status')).toContainText(/thanks/i);
    await expect(form.getByLabel('Name')).toHaveValue('');
  });

  test('shows a helpful error when the service fails', async ({ page }) => {
    await open(page);
    await page.route(FORM_ENDPOINT, (r) => r.fulfill({ status: 500, json: { success: false } }));
    await page.evaluate(() => {
      (document.querySelector('input[name="access_key"]') as HTMLInputElement).value = 'test-key';
    });
    const form = page.locator('#contact-form');
    await form.getByLabel('Name').fill('Jane');
    await form.getByLabel('Email').fill('jane@example.com');
    await form.getByLabel('Project details').fill('Hello');
    await form.getByRole('button', { name: /send/i }).click();
    await expect(page.locator('#form-status')).toContainText(/linkedin/i);
    await expect(form.getByLabel('Name')).toHaveValue('Jane'); // input kept so nothing is lost
  });

  test('shows a helpful error on network failure', async ({ page }) => {
    await open(page);
    await page.route(FORM_ENDPOINT, (r) => r.abort());
    await page.evaluate(() => {
      (document.querySelector('input[name="access_key"]') as HTMLInputElement).value = 'test-key';
    });
    const form = page.locator('#contact-form');
    await form.getByLabel('Name').fill('Jane');
    await form.getByLabel('Email').fill('jane@example.com');
    await form.getByLabel('Project details').fill('Hello');
    await form.getByRole('button', { name: /send/i }).click();
    await expect(page.locator('#form-status')).toContainText(/linkedin/i);
  });

  test('blocks double submission while sending', async ({ page }) => {
    await open(page);
    let calls = 0;
    await page.route(FORM_ENDPOINT, async (r) => {
      calls++;
      await new Promise((res) => setTimeout(res, 500));
      await r.fulfill({ json: { success: true } });
    });
    await page.evaluate(() => {
      (document.querySelector('input[name="access_key"]') as HTMLInputElement).value = 'test-key';
    });
    const form = page.locator('#contact-form');
    await form.getByLabel('Name').fill('Jane');
    await form.getByLabel('Email').fill('jane@example.com');
    await form.getByLabel('Project details').fill('Hello');
    const send = form.getByRole('button', { name: /send/i });
    await send.click();
    await expect(send).toBeDisabled();
    await expect(page.locator('#form-status')).toContainText(/thanks/i);
    expect(calls).toBe(1);
  });
});

test.describe('Accessibility', () => {
  test('has no serious or critical WCAG 2.1 AA violations', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(800); // let the hero animation finish
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s) - ${v.help}`)).toEqual([]);
  });
});
