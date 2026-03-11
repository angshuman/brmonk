import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import type { AgentEventBus } from '../events.js';

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  private activePageIndex = 0;
  private headless: boolean;
  private persistContext: boolean;
  private eventBus: AgentEventBus | null = null;
  private authenticatedDomains: Set<string> = new Set();
  private userActionResolver: (() => void) | null = null;
  private lastDismissedUrl = '';

  constructor(headless = false, persistContext = true) {
    this.headless = headless;
    this.persistContext = persistContext;
  }

  setEventBus(bus: AgentEventBus): void {
    this.eventBus = bus;
  }

  async launch(): Promise<void> {
    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (this.persistContext) {
      const dataDir = path.join(os.homedir(), '.brmonk', 'browser-data');
      await fs.mkdir(dataDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(dataDir, {
        headless: this.headless,
        ...contextOptions,
      });
      this.browser = null;
    } else {
      this.browser = await chromium.launch({ headless: this.headless });
      this.context = await this.browser.newContext(contextOptions);
    }

    const page = await this.context.newPage();
    this.setupPage(page);
    this.pages = [page];
    this.activePageIndex = 0;
  }

  private setupPage(page: Page): void {
    page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
        this.eventBus?.emitPopupDismissed(`Auto-accepted ${dialog.type()} dialog: "${dialog.message().slice(0, 100)}"`);
      } catch {
        // Dialog may have already been dismissed
      }
    });
  }

  async goto(url: string): Promise<void> {
    const page = this.currentPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.waitForStability(page);
    this.eventBus?.emitPageNavigated(url);
  }

  currentPage(): Page {
    const page = this.pages[this.activePageIndex];
    if (!page) throw new Error('No active page available');
    return page;
  }

  async newTab(url?: string): Promise<void> {
    if (!this.context) throw new Error('Browser not launched');
    const page = await this.context.newPage();
    this.setupPage(page);
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.waitForStability(page);
      this.eventBus?.emitPageNavigated(url);
    }
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;
  }

  async switchTab(index: number): Promise<void> {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Tab index ${index} out of range (0-${this.pages.length - 1})`);
    }
    this.activePageIndex = index;
  }

  async closeTab(): Promise<void> {
    if (this.pages.length <= 1) {
      throw new Error('Cannot close the last tab');
    }
    const page = this.pages[this.activePageIndex];
    if (page) await page.close();
    this.pages.splice(this.activePageIndex, 1);
    if (this.activePageIndex >= this.pages.length) {
      this.activePageIndex = this.pages.length - 1;
    }
  }

  getTabCount(): number {
    return this.pages.length;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    } else if (this.context) {
      await this.context.close();
      this.context = null;
    }
    this.pages = [];
    this.activePageIndex = 0;
  }

  isLaunched(): boolean {
    return this.context !== null;
  }

  shouldDismissPopups(): boolean {
    try {
      const currentUrl = this.currentPage().url();
      if (currentUrl !== this.lastDismissedUrl) {
        return true;
      }
    } catch {
      // No page
    }
    return false;
  }

  async dismissPopups(): Promise<string[]> {
    const page = this.currentPage();
    const dismissed: string[] = [];
    this.lastDismissedUrl = page.url();

    const cookieSelectors = [
      '.cookie-banner', '#cookie-consent', '#cookie-banner',
      '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
      '.cc-banner', '#onetrust-banner-sdk', '.gdpr-banner',
      '#CybotCookiebotDialog', '.cookie-notice', '#cookieNotice',
    ];

    for (const sel of cookieSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const acceptBtn = await el.$('button:has-text("Accept"), button:has-text("Accept All"), button:has-text("I agree"), button:has-text("OK"), button:has-text("Got it"), [class*="accept" i]');
          if (acceptBtn) {
            await acceptBtn.click();
            dismissed.push(`Cookie consent: clicked accept button`);
          } else {
            const closeBtn = await el.$('button[aria-label*="close" i], button:has-text("X"), .close-button, [class*="close" i]');
            if (closeBtn) {
              await closeBtn.click();
              dismissed.push(`Cookie banner: clicked close`);
            }
          }
        }
      } catch {
        // Element removed
      }
    }

    const overlaySelectors = [
      '[class*="modal" i][class*="overlay" i]',
      '[class*="popup" i]:not([class*="cookie" i])',
      '[role="dialog"]',
    ];

    for (const sel of overlaySelectors) {
      try {
        const modals = await page.$$(sel);
        for (const modal of modals) {
          const visible = await modal.isVisible();
          if (!visible) continue;
          const text = await modal.textContent() ?? '';
          const lowerText = text.toLowerCase();
          const isNuisance = lowerText.includes('subscribe') || lowerText.includes('newsletter') ||
            lowerText.includes('notification') || lowerText.includes('sign up for') ||
            lowerText.includes('don\'t miss');
          if (!isNuisance) continue;

          const closeBtn = await modal.$('button[aria-label*="close" i], button:has-text("No thanks"), button:has-text("Close"), button:has-text("X"), [class*="close" i], button:has-text("Dismiss")');
          if (closeBtn) {
            await closeBtn.click();
            dismissed.push(`Overlay popup dismissed`);
          }
        }
      } catch {
        // Element removed
      }
    }

    return dismissed;
  }

  async detectCaptcha(): Promise<boolean> {
    const page = this.currentPage();
    return await page.evaluate(() => {
      const recaptcha = document.querySelector('iframe[src*="recaptcha"]') ??
        document.querySelector('.g-recaptcha') ??
        document.querySelector('#recaptcha');
      const hcaptcha = document.querySelector('iframe[src*="hcaptcha"]') ??
        document.querySelector('.h-captcha');
      const turnstile = document.querySelector('iframe[src*="turnstile"]') ??
        document.querySelector('.cf-turnstile');
      const generic = document.querySelector('[class*="captcha" i]') ??
        document.querySelector('[id*="captcha" i]');
      return !!(recaptcha || hcaptcha || turnstile || generic);
    });
  }

  async detectLoginPage(): Promise<boolean> {
    const page = this.currentPage();
    return await page.evaluate(() => {
      const passwordFields = document.querySelectorAll('input[type="password"]');
      if (passwordFields.length === 0) return false;
      for (const field of passwordFields) {
        const el = field as HTMLElement;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
        if (visible) return true;
      }
      return false;
    });
  }

  async waitForStability(page: Page): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // Timeout is fine
    }
    await page.waitForTimeout(300);
  }

  async waitForUserAction(prompt: string): Promise<void> {
    this.eventBus?.emitUserActionRequired(prompt, 'confirmation');
    return new Promise<void>((resolve) => {
      this.userActionResolver = resolve;
    });
  }

  resolveUserAction(): void {
    if (this.userActionResolver) {
      this.userActionResolver();
      this.userActionResolver = null;
      this.eventBus?.emitUserActionResolved();
    }
  }

  markAuthenticated(domain: string): void {
    this.authenticatedDomains.add(domain);
  }

  isAuthenticated(domain: string): boolean {
    return this.authenticatedDomains.has(domain);
  }

  getCurrentDomain(): string {
    try {
      const url = this.currentPage().url();
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  async screenshotToFile(filePath: string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const page = this.currentPage();
      await page.screenshot({ path: filePath, fullPage: false });
    } catch {
      // Screenshot failed, not critical
    }
  }
}
