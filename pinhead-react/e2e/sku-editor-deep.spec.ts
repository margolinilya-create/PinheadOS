// Deep QA investigation: SKU Editor edge cases and details
import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

// ─── Deep investigation: Pricing tab change counter ───

test.describe('Pricing — Change counter investigation', () => {
  test('should show change counter when editing price matrix', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await page.waitForTimeout(1500);

    // Log all visible elements with "change" or "dirty" in their class/text
    const snapshot = await page.content();
    const hasChangeBadge = snapshot.includes('change') || snapshot.includes('dirty') || snapshot.includes('badge');
    console.log(`  Page has change/dirty/badge elements: ${hasChangeBadge}`);

    // Find price inputs in the matrix
    const allInputs = page.locator('.pe-matrix input[type="number"], .pe-cell input, .pe-matrix td input');
    const inputCount = await allInputs.count();
    console.log(`  Price matrix inputs count: ${inputCount}`);

    if (inputCount > 0) {
      const firstInput = allInputs.first();
      const origVal = await firstInput.inputValue();
      console.log(`  Original value: ${origVal}`);

      // Change value
      await firstInput.fill('12345');
      await firstInput.press('Tab');
      await page.waitForTimeout(800);

      // Check for any change indicator anywhere on page
      const changeBadge = page.locator('[class*="change"], [class*="dirty"], [class*="badge"], [class*="count"]');
      const count = await changeBadge.count();
      for (let i = 0; i < Math.min(count, 10); i++) {
        const text = await changeBadge.nth(i).innerText().catch(() => '');
        const cls = await changeBadge.nth(i).getAttribute('class').catch(() => '');
        if (text || cls) console.log(`  Indicator ${i}: class="${cls}" text="${text}"`);
      }

      // Check Save button text
      const saveBtn = page.getByRole('button', { name: /сохранить/i }).first();
      const saveText = await saveBtn.innerText().catch(() => '');
      console.log(`  Save button text: "${saveText}"`);

      // Restore
      await firstInput.fill(origVal);
      await firstInput.press('Tab');
    }
  });
});

// ─── Deep investigation: Category Rules sections ───

test.describe('Category Rules — Expanded sections', () => {
  test('should show all sections when category is expanded', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    await page.waitForTimeout(1500);

    // Log all visible text content
    const mainContent = await page.locator('main').first().innerText();
    console.log(`  Rules tab main content (first 500 chars):\n${mainContent.substring(0, 500)}`);

    // Try clicking on each category
    const categories = ['Футболки', 'Худи', 'Свитшоты'];
    for (const cat of categories) {
      const catEl = page.getByText(cat, { exact: false }).first();
      const visible = await catEl.isVisible().catch(() => false);
      if (visible) {
        console.log(`\n  --- Expanding "${cat}" ---`);
        await catEl.click();
        await page.waitForTimeout(500);

        // Log all text within the expanded section
        const content = await page.locator('main').first().innerText();
        // Check for expected section titles
        const sectionNames = [
          'Техники нанесения',
          'Техники по зонам',
          'MOQ',
          'Размеры',
          'Обработки по умолчанию',
          'Разрешённые техники',
          'Допустимые',
        ];
        for (const s of sectionNames) {
          const found = content.includes(s);
          console.log(`    Section "${s}": ${found ? 'FOUND' : 'NOT FOUND'}`);
        }

        // Click again to collapse
        await catEl.click();
        await page.waitForTimeout(300);
      }
    }
  });
});

// ─── Deep investigation: Zones tab rename ───

test.describe('Zones — Zone rename', () => {
  test('should find and edit zone name inputs', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await page.waitForTimeout(1000);

    // Find all textbox inputs in zone table
    const inputs = page.locator('tbody td input, tbody td [role="textbox"], tbody textbox');
    const inputCount = await inputs.count();
    console.log(`  Zone name input count: ${inputCount}`);

    // Try by role
    const textboxes = page.getByRole('textbox');
    const textboxCount = await textboxes.count();
    console.log(`  Total textboxes on page: ${textboxCount}`);

    for (let i = 0; i < Math.min(textboxCount, 12); i++) {
      const val = await textboxes.nth(i).inputValue().catch(() => '');
      const placeholder = await textboxes.nth(i).getAttribute('placeholder').catch(() => '');
      console.log(`    Textbox ${i}: value="${val}" placeholder="${placeholder}"`);
    }

    // Try editing the first zone name
    if (textboxCount > 0) {
      // Find the zone name textbox (should be in a table cell)
      const zoneTextbox = page.locator('tbody tr td').nth(1).locator('input, [contenteditable]').first();
      const zoneVisible = await zoneTextbox.isVisible().catch(() => false);
      console.log(`  First zone name input visible: ${zoneVisible}`);

      if (zoneVisible) {
        const origVal = await zoneTextbox.inputValue().catch(() => '');
        console.log(`  Zone name original: "${origVal}"`);
      }
    }
  });
});

// ─── Pricing sub-tabs deep check ───

test.describe('Pricing — Sub-tabs content', () => {
  test('should switch between pricing sub-tabs', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await page.waitForTimeout(1500);

    const subtabs = ['Шелкография', 'Вышивка', 'DTF', 'DTG', 'Флекс', 'Наценки', 'Доп'];
    for (const st of subtabs) {
      const tab = page.getByRole('button', { name: st }).first();
      const visible = await tab.isVisible().catch(() => false);
      if (visible) {
        await tab.click();
        await page.waitForTimeout(500);

        // Check if content changed
        const hasMatrix = await page.locator('.pe-matrix, table').first().isVisible().catch(() => false);
        const hasContent = await page.locator('.pe-tab-content, main').first().isVisible().catch(() => false);
        console.log(`  Sub-tab "${st}": matrix=${hasMatrix}, content=${hasContent}`);
      } else {
        console.log(`  Sub-tab "${st}": NOT VISIBLE as button`);
      }
    }

    // Check for История tab
    const histTab = page.getByText('История').first();
    const histVisible = await histTab.isVisible().catch(() => false);
    console.log(`  Sub-tab "История": ${histVisible ? 'VISIBLE' : 'NOT FOUND'}`);
  });
});

// ─── SKU Detail Modal — full inspection ───

test.describe('SKU Detail Modal — Full inspection', () => {
  test('should inspect all sections in detail', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });

    // Open first SKU detail
    await page.locator('.sku-photo-thumb').first().click();
    await page.waitForTimeout(1000);

    // Get full modal content
    const modalContent = await page.locator('.sku-detail-modal, [class*="modal"]').first().innerText().catch(() => '');
    console.log(`  Modal content length: ${modalContent.length} chars`);

    // Check specific sections
    const sections = [
      'Фото модели',
      'Описание',
      'Табель мер',
      'Зоны нанесения',
      'Экономика',
      'Переопределения',
      'Параметры',
      'Изменения применены',
    ];
    for (const s of sections) {
      const found = modalContent.includes(s);
      console.log(`  Section "${s}": ${found ? 'FOUND in modal' : 'NOT FOUND'}`);
    }

    // Check for override sub-sections
    const overrideSections = [
      'Разрешённые техники',
      'MOQ (минимальный заказ)',
      'Множитель цены',
      'Разрешённые цвета',
      'Разрешённые ткани',
      'Разрешённые обработки',
      'Доступные размеры',
    ];
    for (const o of overrideSections) {
      const found = modalContent.includes(o);
      console.log(`  Override "${o}": ${found ? 'FOUND' : 'NOT FOUND'}`);
    }

    // Check for footer
    const footer = page.getByText(/Изменения применены|сохраните каталог/i).first();
    const footerVisible = await footer.isVisible().catch(() => false);
    console.log(`  Footer visible: ${footerVisible}`);
  });
});

// ─── Mobile viewport deep check ───

test.describe('Mobile — Detailed check', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('should work on mobile for all critical tabs', async ({ page }) => {
    // Check SKU items tab on mobile
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });

    // Check if table is visible and not cut off
    const table = page.locator('.sku-ed-table').first();
    const tableVisible = await table.isVisible().catch(() => false);
    console.log(`  SKU items table on mobile: ${tableVisible ? 'VISIBLE' : 'NOT FOUND'}`);

    // Check if toolbar buttons are accessible
    const addBtn = page.locator('.sku-ed-add-btn').first();
    const addVisible = await addBtn.isVisible().catch(() => false);
    console.log(`  Add SKU button on mobile: ${addVisible ? 'VISIBLE' : 'NOT FOUND'}`);

    // Switch to pricing tab
    await page.getByRole('button', { name: 'Ценообразование' }).click();
    await page.waitForTimeout(500);
    const priceMatrix = page.locator('.pe-matrix, table').first();
    const priceVisible = await priceMatrix.isVisible().catch(() => false);
    console.log(`  Price matrix on mobile: ${priceVisible ? 'VISIBLE' : 'NOT FOUND'}`);

    // Switch to zones tab
    await page.getByRole('button', { name: 'Зоны нанесения' }).click();
    await page.waitForTimeout(500);
    const zonesTable = page.locator('table').first();
    const zonesVisible = await zonesTable.isVisible().catch(() => false);
    console.log(`  Zones table on mobile: ${zonesVisible ? 'VISIBLE' : 'NOT FOUND'}`);
  });
});
