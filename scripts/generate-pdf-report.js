import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve root directory of the project
const rootDir = path.resolve(__dirname, '..');

async function run() {
  const htmlPath = path.join(rootDir, 'playwright-report', 'index.html');
  const pdfPath = path.join(rootDir, 'cart-drawer-ninja-test-report.pdf');
  const copiedHtmlPath = path.join(rootDir, 'cart-drawer-ninja-test-report.html');

  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Playwright HTML report not found at ${htmlPath}. Please make sure you have run the tests first.`);
  }

  // Also make a copy of the HTML file as cart-drawer-ninja-test-report.html in the root as requested/implied
  console.log(`Copying HTML report to ${copiedHtmlPath}...`);
  fs.copyFileSync(htmlPath, copiedHtmlPath);

  console.log('Launching Playwright Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const fileUrl = `file://${copiedHtmlPath.replace(/\\/g, '/')}`;
  console.log(`Loading HTML report from: ${fileUrl}`);
  
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  
  // Wait for the report's main elements to be rendered
  console.log('Waiting for report elements to render...');
  await page.waitForSelector('body', { timeout: 10000 });
  
  // Wait an extra moment to ensure animations and charts are settled
  await page.waitForTimeout(2500);
  
  console.log('Generating PDF...');
  await page.pdf({
    path: pdfPath,
    format: 'Letter',
    margin: {
      top: '0.4in',
      bottom: '0.4in',
      left: '0.4in',
      right: '0.4in'
    },
    printBackground: true,
    scale: 0.85, // Scale slightly down so everything fits comfortably on the page
  });
  
  console.log(`PDF successfully generated at: ${pdfPath}`);
  await browser.close();
}

run().catch(err => {
  console.error('Error during PDF generation:', err);
  process.exit(1);
});
