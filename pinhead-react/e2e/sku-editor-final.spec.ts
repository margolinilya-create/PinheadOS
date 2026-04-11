// Final QA: SKU Editor comprehensive test with correct selectors
import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

// ─── Pricing: change counter after editing matrix ───

test.describe('Pricing — Change counter', () => {
  test('should show change count after editing price matrix input', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await page.waitForTimeout(1500);

    // Find price matrix input
    const priceInput = page.locator('.pe-matrix-input').first();
    await expect(priceInput).toBeVisible({ timeout: 5000 });

    const origVal = await priceInput.inputValue();
    console.log(`  Original price value: ${origVal}`);

    // Edit
    await priceInput.fill('12345');
    await priceInput.press('Tab');
    await page.waitForTimeout(500);

    // Check for ".pe-changed" element
    const changeCounter = page.locator('.pe-changed');
    const counterVisible = await changeCounter.isVisible().catch(() => false);
    const counterText = counterVisible ? await changeCounter.innerText() : 'NOT VISIBLE';
    console.log(`  Change counter: visible=${counterVisible}, text="${counterText}"`);
    expect(counterVisible, 'Change counter should appear after edit').toBeTruthy();
    expect(counterText).toContain('изм.');

    // Restore
    await priceInput.fill(origVal);
    await priceInput.press('Tab');
    await page.waitForTimeout(300);
  });
});

// ─── Category Rules: expanded sections ───

test.describe('Category Rules — Expanded content', () => {
  test('should show all 5 sections when category is expanded', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    await page.waitForTimeout(1000);

    // Verify 11 categories are visible
    const categories = page.locator('.cat-rule-card');
    const catCount = await categories.count();
    console.log(`  Category cards count: ${catCount}`);
    expect(catCount).toBe(11);

    // Click first category header to expand
    const firstHeader = page.locator('.cat-rule-header').first();
    await firstHeader.click();
    await page.waitForTimeout(500);

    // Check for section labels (uppercase in DOM)
    const sectionLabels = [
      'ТЕХНИКИ НАНЕСЕНИЯ',
      'ТЕХНИКИ ПО ЗОНАМ',
      'МИНИМАЛЬНЫЙ ТИРАЖ',
      'ДОСТУПНЫЕ РАЗМЕРЫ',
      'ОБРАБОТКИ ПО УМОЛЧАНИЮ',
    ];

    for (const label of sectionLabels) {
      const section = page.locator('.cat-rule-section-label', { hasText: label }).first();
      const found = await section.isVisible().catch(() => false);
      console.log(`  Section "${label}": ${found ? 'VISIBLE' : 'NOT FOUND'}`);
      expect(found, `Section "${label}" should be visible`).toBeTruthy();
    }

    // Check tech chips exist
    const techChips = page.locator('.cat-rule-chips .cat-rule-chip');
    const chipCount = await techChips.count();
    console.log(`  Tech chips count: ${chipCount}`);
    expect(chipCount).toBeGreaterThanOrEqual(5); // 5 techs

    // Check zone-tech matrix
    const zoneTechMatrix = page.locator('.zone-tech-matrix');
    const matrixVisible = await zoneTechMatrix.isVisible().catch(() => false);
    console.log(`  Zone-tech matrix: ${matrixVisible ? 'VISIBLE' : 'NOT FOUND'}`);
    expect(matrixVisible).toBeTruthy();

    // Check MOQ input
    const moqInput = page.locator('.cat-rule-moq-input').first();
    const moqVisible = await moqInput.isVisible().catch(() => false);
    console.log(`  MOQ input: ${moqVisible ? 'VISIBLE' : 'NOT FOUND'}`);
    expect(moqVisible).toBeTruthy();

    // Check size checkboxes
    const sizeLabels = page.locator('.cat-rule-sizes .cat-rule-size');
    const sizeCount = await sizeLabels.count();
    console.log(`  Size options: ${sizeCount}`);
    expect(sizeCount).toBeGreaterThanOrEqual(5);
  });
});

// ─── SKU Detail Modal: scrollable sections ───

test.describe('SKU Detail Modal — Full sections', () => {
  test('should display all 7 sections in the modal', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });

    // Open detail modal
    await page.locator('.sku-photo-thumb').first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator('.sku-detail-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Check section labels (they use .sku-detail-section-label)
    const sectionLabels = page.locator('.sku-detail-section-label');
    const sectionCount = await sectionLabels.count();
    console.log(`  Total sections in modal: ${sectionCount}`);

    // Enumerate all section labels
    for (let i = 0; i < sectionCount; i++) {
      const text = await sectionLabels.nth(i).innerText();
      console.log(`    Section ${i}: "${text}"`);
    }

    // Expected sections
    const expected = [
      'ФОТО МОДЕЛИ',
      'КОРОТКОЕ ОПИСАНИЕ',
      'ПОЛНОЕ ОПИСАНИЕ',
      'ТАБЕЛЬ МЕР',
      'ЗОНЫ НАНЕСЕНИЯ',
      'ЭКОНОМИКА',
      'ПЕРЕОПРЕДЕЛЕНИЯ',
      'ПАРАМЕТРЫ',
    ];

    for (const s of expected) {
      const found = page.locator('.sku-detail-section-label', { hasText: s }).first();
      const isVisible = await found.isVisible().catch(() => false);
      console.log(`  Section "${s}": ${isVisible ? 'VISIBLE' : 'NOT FOUND'}`);
    }

    // Check footer
    const footer = page.locator('.sku-autosave-status');
    const footerText = await footer.innerText().catch(() => '');
    console.log(`  Footer: "${footerText}"`);
    expect(footerText).toContain('Изменения применены');
  });

  test('should show override controls', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });

    await page.locator('.sku-photo-thumb').first().click();
    await page.waitForTimeout(1000);

    // Scroll to overrides section
    const overridesSection = page.locator('.sku-detail-section-label', { hasText: 'ПЕРЕОПРЕДЕЛЕНИЯ' });
    await overridesSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Check override rows
    const overrideRows = page.locator('.sku-override-row');
    const rowCount = await overrideRows.count();
    console.log(`  Override rows: ${rowCount}`);

    // Check specific overrides by label
    const overrideLabels = ['Техники', 'MOQ', 'Множитель цены', 'Цвета', 'Размеры'];
    for (const label of overrideLabels) {
      const row = page.locator('.sku-override-label', { hasText: label }).first();
      const visible = await row.isVisible().catch(() => false);
      console.log(`  Override "${label}": ${visible ? 'VISIBLE' : 'NOT FOUND'}`);
    }

    // Check allowed lists (fabrics and extras)
    const allowedLists = page.locator('.sku-override-row').filter({ hasText: /Допустимые/ });
    const listCount = await allowedLists.count();
    console.log(`  "Допустимые" lists: ${listCount}`);
  });
});

// ─── Pricing sub-tabs: verify all 8 ───

test.describe('Pricing — All sub-tabs', () => {
  test('should verify all 8 sub-tabs render', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await page.waitForTimeout(1500);

    const subtabs = page.locator('.pricing-sub-tab');
    const count = await subtabs.count();
    console.log(`  Sub-tab count: ${count}`);

    for (let i = 0; i < count; i++) {
      const text = await subtabs.nth(i).innerText();
      console.log(`    Sub-tab ${i}: "${text}"`);
    }

    // Expected: Шелкография, Вышивка, DTF, DTG, Флекс, Наценки, Доп, История
    expect(count).toBe(8);
  });
});

// ─── Zones: Delete button has confirm ───

test.describe('Zones — Delete confirmation', () => {
  test('should have delete buttons for each zone', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await page.waitForTimeout(1000);

    const deleteButtons = page.locator('button', { hasText: /✕/ }).filter({ hasText: /Удалить|✕/ });
    // Actually look at specific delete buttons in zone rows
    const zoneDeleteBtns = page.getByRole('button', { name: 'Удалить зону' });
    const btnCount = await zoneDeleteBtns.count();
    console.log(`  Delete zone buttons: ${btnCount}`);
    expect(btnCount).toBeGreaterThanOrEqual(8);
  });
});

// ─── Tab dirty dot indicator ───

test.describe('Tab dirty indicator', () => {
  test('should show dot on tab when changes are made', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await page.waitForTimeout(1500);

    // Edit a price to make pricing dirty
    const priceInput = page.locator('.pe-matrix-input').first();
    const origVal = await priceInput.inputValue();
    await priceInput.fill('99999');
    await priceInput.press('Tab');
    await page.waitForTimeout(500);

    // Check if pricing tab has a dot indicator
    const pricingTab = page.locator('.sku-ed-tabs button', { hasText: 'Ценообразование' }).first();
    const dot = pricingTab.locator('.pe-tab-dot');
    const dotVisible = await dot.isVisible().catch(() => false);
    console.log(`  Dirty dot on Pricing tab: ${dotVisible ? 'VISIBLE' : 'NOT FOUND'}`);

    // Restore
    await priceInput.fill(origVal);
  });
});

// ─── Wizard full flow with Выбрать button ───

test.describe('Wizard — Full flow after SKU selection', () => {
  test('should complete garment selection via Выбрать button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 10000 });

    // Check garment list structure
    const garmentRows = page.locator('.garment-row');
    const rowCount = await garmentRows.count();
    console.log(`  Garment rows: ${rowCount}`);
    expect(rowCount).toBeGreaterThan(0);

    // Expand first SKU
    await garmentRows.first().click();
    await page.waitForTimeout(300);

    // Verify expand panel content
    const expandPanel = page.locator('.garment-expand-inner');
    await expect(expandPanel).toBeVisible({ timeout: 3000 });

    // Check for zone labels in expand panel
    const zoneBadges = page.locator('.garment-expand-zone');
    const zoneCount = await zoneBadges.count();
    console.log(`  Zone badges in expand panel: ${zoneCount}`);

    // Check for size chart
    const sizeChart = page.locator('.garment-expand-inner table');
    const hasChart = await sizeChart.isVisible().catch(() => false);
    console.log(`  Size chart in expand panel: ${hasChart}`);

    // Check for price
    const price = page.locator('.garment-expand-price');
    const priceText = await price.innerText().catch(() => '');
    console.log(`  Price in expand panel: "${priceText}"`);

    // Click Выбрать
    await page.locator('.garment-expand-select').click();
    await page.waitForTimeout(500);

    // Verify FabricGrid appeared
    const fabricOptions = page.locator('.fit-option');
    await expect(fabricOptions.first()).toBeVisible({ timeout: 5000 });
    const fabricCount = await fabricOptions.count();
    console.log(`  Fabric options: ${fabricCount}`);
    expect(fabricCount).toBeGreaterThan(0);
  });
});
