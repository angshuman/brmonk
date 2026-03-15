import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import type { AgentEventBus } from '../events.js';
import { randomDelay } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

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
  private cdpUrl: string | null = null;

  constructor(headless = false, persistContext = true, cdpUrl?: string) {
    this.headless = headless;
    this.persistContext = persistContext;
    this.cdpUrl = cdpUrl ?? null;
  }

  setEventBus(bus: AgentEventBus): void {
    this.eventBus = bus;
  }

  /**
   * Resolve a CDP HTTP endpoint to a WebSocket URL.
   * Chrome's /json/version returns a webSocketDebuggerUrl with the local
   * hostname (127.0.0.1 or 0.0.0.0), which is unreachable from Docker.
   * We rewrite the hostname to match the original endpoint URL.
   */
  private async resolveCdpWsUrl(httpUrl: string): Promise<string> {
    const endpoint = new URL(httpUrl);
    const versionUrl = `${endpoint.origin}/json/version`;

    // Retry a few times — Chrome may still be starting when Docker boots
    const maxRetries = 10;
    const retryDelay = 2000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Fetching CDP debug info from ${versionUrl} (attempt ${attempt}/${maxRetries})`);
        const res = await fetch(versionUrl);
        if (!res.ok) {
          throw new Error(`CDP /json/version returned ${res.status}: ${res.statusText}`);
        }
        const json = await res.json() as { webSocketDebuggerUrl?: string };
        const wsUrl = json.webSocketDebuggerUrl;
        if (!wsUrl) {
          throw new Error('CDP /json/version did not return webSocketDebuggerUrl');
        }

        // Rewrite hostname/port to match the original endpoint so it works from Docker
        const wsUrlParsed = new URL(wsUrl);
        wsUrlParsed.hostname = endpoint.hostname;
        wsUrlParsed.port = endpoint.port;
        const resolved = wsUrlParsed.toString();
        logger.info(`Resolved CDP WebSocket URL: ${resolved}`);
        return resolved;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          logger.info(`CDP not ready (${lastError.message}), retrying in ${retryDelay / 1000}s...`);
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }
    }

    throw new Error(
      `Could not connect to Chrome CDP at ${httpUrl} after ${maxRetries} attempts. ` +
      `Last error: ${lastError?.message}. ` +
      `Make sure Chrome is running with --remote-debugging-port and --remote-debugging-address=0.0.0.0`
    );
  }

  async launch(): Promise<void> {
    // Remote CDP mode: connect to an existing browser on the host
    if (this.cdpUrl) {
      // Resolve the WS URL ourselves so we can fix the hostname for Docker
      const wsUrl = await this.resolveCdpWsUrl(this.cdpUrl);
      this.browser = await chromium.connectOverCDP(wsUrl);
      const contexts = this.browser.contexts();
      this.context = contexts[0] ?? await this.browser.newContext();
      const existingPages = this.context.pages();
      if (existingPages.length > 0) {
        this.pages = existingPages;
        for (const page of this.pages) {
          this.setupPage(page);
        }
      } else {
        const page = await this.context.newPage();
        this.setupPage(page);
        this.pages = [page];
      }
      this.activePageIndex = 0;
      return;
    }

    const contextOptions = {
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      deviceScaleFactor: 1,
      hasTouch: false,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ];

    if (this.persistContext) {
      const dataDir = path.join(os.homedir(), '.brmonk', 'browser-data');
      await fs.mkdir(dataDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(dataDir, {
        headless: this.headless,
        args: launchArgs,
        ...contextOptions,
      });
      this.browser = null;
    } else {
      this.browser = await chromium.launch({ headless: this.headless, args: launchArgs });
      this.context = await this.browser.newContext(contextOptions);
    }

    // Apply stealth scripts to evade bot detection
    await this.applyStealthScripts();

    const page = await this.context.newPage();
    this.setupPage(page);
    this.pages = [page];
    this.activePageIndex = 0;
  }

  private async applyStealthScripts(): Promise<void> {
    if (!this.context) return;

    await this.context.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Override plugins to look like a real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Fix chrome object for headless detection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).chrome = {
        runtime: {},
        loadTimes() { /* noop */ },
        csi() { /* noop */ },
        app: {},
      };

      // Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery.call(window.navigator.permissions, parameters);

      // Remove automation-related properties
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__playwright;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__pw_manual;
    });
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
      '#consent-banner', '.consent-banner', '#privacy-banner',
      '.privacy-banner', '#sp-cc', '#sp_message_container',
      '[class*="cookie-policy" i]', '[class*="cookie_consent" i]',
      '.truste-consent-content', '#truste-consent-content',
      '[data-testid*="cookie" i]', '[data-testid*="consent" i]',
      '.qc-cmp-ui-container', '#qc-cmp-ui-container',
      '#didomi-host', '.didomi-popup-container',
    ];

    const acceptBtnSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept Cookies")',
      'button:has-text("I agree")',
      'button:has-text("I Agree")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      'button:has-text("Agree")',
      'button:has-text("Allow")',
      'button:has-text("Allow All")',
      'button:has-text("Continue")',
      'button:has-text("Confirm")',
      '[class*="accept" i]',
      '[class*="agree" i]',
      '[data-testid*="accept" i]',
    ].join(', ');

    for (const sel of cookieSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const acceptBtn = await el.$(acceptBtnSelectors);
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

    // Fallback: hide cookie/consent banners via JS
    try {
      const hiddenByJs = await page.evaluate(() => {
        const fixedElements = document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]');
        let count = 0;
        for (const el of fixedElements) {
          const rect = el.getBoundingClientRect();
          const text = (el.textContent || '').toLowerCase();
          if ((text.includes('cookie') || text.includes('consent') || text.includes('privacy') || text.includes('gdpr')) &&
            (rect.height < 300)) {
            (el as HTMLElement).style.display = 'none';
            count++;
          }
        }
        return count;
      });
      if (hiddenByJs > 0) {
        dismissed.push(`Hid ${hiddenByJs} cookie/consent banner(s) via JS`);
      }
    } catch {
      // page not ready
    }

    return dismissed;
  }

  async attemptCaptchaSolve(): Promise<boolean> {
    const page = this.currentPage();

    // Try clicking reCAPTCHA checkbox
    try {
      const recaptchaFrame = page.frameLocator('iframe[src*="recaptcha"]');
      const checkbox = recaptchaFrame.locator('.recaptcha-checkbox-border, #recaptcha-anchor');
      if (await checkbox.isVisible({ timeout: 2000 })) {
        await page.waitForTimeout(randomDelay(500, 1500));
        await checkbox.click();
        await page.waitForTimeout(3000);
        const checked = await recaptchaFrame.locator('.recaptcha-checkbox-checked').isVisible({ timeout: 3000 }).catch(() => false);
        if (checked) return true;
      }
    } catch {
      // Not a simple checkbox captcha
    }

    // Try clicking hCaptcha checkbox
    try {
      const hcaptchaFrame = page.frameLocator('iframe[src*="hcaptcha"]');
      const checkbox = hcaptchaFrame.locator('#checkbox');
      if (await checkbox.isVisible({ timeout: 2000 })) {
        await page.waitForTimeout(randomDelay(500, 1500));
        await checkbox.click();
        await page.waitForTimeout(3000);
        return true;
      }
    } catch {
      // Not a simple hCaptcha
    }

    // Try Cloudflare Turnstile
    try {
      const turnstileFrame = page.frameLocator('iframe[src*="turnstile"]');
      const checkbox = turnstileFrame.locator('input[type="checkbox"]');
      if (await checkbox.isVisible({ timeout: 2000 })) {
        await page.waitForTimeout(randomDelay(500, 1500));
        await checkbox.click();
        await page.waitForTimeout(3000);
        return true;
      }
    } catch {
      // Not a simple turnstile
    }

    return false;
  }

  async detectCaptcha(): Promise<{ detected: boolean; type: string | null; element: string | null }> {
    const page = this.currentPage();
    return await page.evaluate(() => {
      // Helper: check if element is actually visible and has meaningful size
      function isVisibleAndSized(el: Element): boolean {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        // Must be at least 30x30 pixels to be a real CAPTCHA widget
        if (rect.width < 30 || rect.height < 30) return false;
        // Must be within the viewport (not positioned off-screen)
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        // Check parent visibility too
        let parent = el.parentElement;
        while (parent) {
          const ps = window.getComputedStyle(parent);
          if (ps.display === 'none' || ps.visibility === 'hidden') return false;
          parent = parent.parentElement;
        }
        return true;
      }

      // 1. Check for reCAPTCHA v2 challenge (the iframe that shows the puzzle)
      const recaptchaFrames = document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"]');
      for (const frame of recaptchaFrames) {
        if (isVisibleAndSized(frame)) {
          return { detected: true, type: 'recaptcha-v2-challenge', element: 'iframe' };
        }
      }

      // 2. Check for reCAPTCHA checkbox that is NOT already checked
      const recaptchaCheckboxes = document.querySelectorAll('iframe[src*="recaptcha"][src*="anchor"]');
      for (const frame of recaptchaCheckboxes) {
        if (isVisibleAndSized(frame)) {
          return { detected: true, type: 'recaptcha-v2-checkbox', element: 'iframe' };
        }
      }

      // 3. Check for hCaptcha challenge
      const hcaptchaFrames = document.querySelectorAll('iframe[src*="hcaptcha.com"]');
      for (const frame of hcaptchaFrames) {
        if (isVisibleAndSized(frame)) {
          return { detected: true, type: 'hcaptcha', element: 'iframe' };
        }
      }

      // 4. Check for Cloudflare Turnstile
      const turnstileFrames = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]');
      for (const frame of turnstileFrames) {
        if (isVisibleAndSized(frame)) {
          return { detected: true, type: 'cloudflare-turnstile', element: 'iframe' };
        }
      }

      // 5. Check for visible CAPTCHA challenge overlays/modals (NOT just any element with captcha class)
      const challengeSelectors = [
        '.g-recaptcha:not(.g-recaptcha-response)',
        '#captcha-container',
        '.captcha-challenge',
        '.captcha-modal',
        '[data-captcha-challenge]',
      ];

      for (const sel of challengeSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (isVisibleAndSized(el)) {
            return { detected: true, type: 'generic-captcha', element: sel };
          }
        }
      }

      return { detected: false, type: null, element: null };
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

  async screenshotToBase64(): Promise<string | null> {
    try {
      const page = this.currentPage();
      const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 60 });
      return buffer.toString('base64');
    } catch {
      return null;
    }
  }

  getCurrentUrl(): string {
    try {
      return this.currentPage().url();
    } catch {
      return '';
    }
  }
}
