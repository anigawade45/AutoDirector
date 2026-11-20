import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { updateDocumentSeo } from '../utils/seo';

describe('SEO & Technical Indexing Verification Suite', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const frontendDir = path.join(rootDir, 'frontend');
  const publicDir = path.join(frontendDir, 'public');
  const indexHtmlPath = path.join(frontendDir, 'index.html');

  describe('1. Static File Verification (Robots, Sitemap, Manifest, OpenGraph)', () => {
    it('verifies robots.txt exists and enforces strict crawl policies', () => {
      const robotsPath = path.join(publicDir, 'robots.txt');
      expect(fs.existsSync(robotsPath)).toBe(true);

      const content = fs.readFileSync(robotsPath, 'utf8');
      expect(content).toContain('User-agent: *');
      expect(content).toContain('Allow: /');
      expect(content).toContain('Allow: /assets/');
      expect(content).toContain('Disallow: /dashboard');
      expect(content).toContain('Disallow: /projects/');
      expect(content).toContain('Disallow: /editor/');
      expect(content).toContain('Disallow: /api/');
      expect(content).toContain('Sitemap: https://ai-video-frontend-57bk.onrender.com/sitemap.xml');
    });

    it('verifies sitemap.xml exists and conforms to Sitemaps.org 0.9 XML schema', () => {
      const sitemapPath = path.join(publicDir, 'sitemap.xml');
      expect(fs.existsSync(sitemapPath)).toBe(true);

      const content = fs.readFileSync(sitemapPath, 'utf8');
      expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(content).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(content).toContain('<loc>https://ai-video-frontend-57bk.onrender.com/</loc>');
      expect(content).toContain('<changefreq>weekly</changefreq>');
      expect(content).toContain('<priority>1.0</priority>');
      expect(content).toContain('</urlset>');

      // Ensures private routes are not indexed in the sitemap
      expect(content).not.toContain('/dashboard');
      expect(content).not.toContain('/projects');
      expect(content).not.toContain('/api');
    });

    it('verifies site.webmanifest exists and contains valid PWA metadata', () => {
      const manifestPath = path.join(publicDir, 'site.webmanifest');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      expect(manifest.name).toBe('AutoDirector • The Editorial Video Suite');
      expect(manifest.short_name).toBe('AutoDirector');
      expect(manifest.start_url).toBe('/');
      expect(manifest.theme_color).toBe('#18191B');
      expect(manifest.background_color).toBe('#18191B');
      expect(manifest.display).toBe('standalone');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThan(0);
    });

    it('verifies social preview cards and icons exist on disk', () => {
      const faviconSvgPath = path.join(publicDir, 'favicon.svg');
      const ogImagePath = path.join(publicDir, 'og-image.png');
      const ogImageSvgPath = path.join(publicDir, 'og-image.svg');

      expect(fs.existsSync(faviconSvgPath)).toBe(true);
      expect(fs.statSync(faviconSvgPath).size).toBeGreaterThan(100);

      expect(fs.existsSync(ogImagePath)).toBe(true);
      expect(fs.statSync(ogImagePath).size).toBeGreaterThan(10000); // 1200x630 PNG

      expect(fs.existsSync(ogImageSvgPath)).toBe(true);
      expect(fs.statSync(ogImageSvgPath).size).toBeGreaterThan(500);
    });
  });

  describe('2. index.html Metadata & Open Graph Protocol Verification', () => {
    let indexHtml: string;

    beforeEach(() => {
      indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    });

    it('includes primary search metadata (title, description, canonical, robots)', () => {
      expect(indexHtml).toContain(
        '<title>AutoDirector • AI Video Editor &amp; Conversational Cutting Room</title>'
      );
      expect(indexHtml).toContain('name="description"');
      expect(indexHtml).toContain('name="robots"');
      expect(indexHtml).toContain(
        'content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"'
      );
      expect(indexHtml).toContain(
        '<link rel="canonical" href="https://ai-video-frontend-57bk.onrender.com/" />'
      );
    });

    it('includes full Open Graph protocol tags for rich social unfurls', () => {
      expect(indexHtml).toContain('<meta property="og:type" content="website" />');
      expect(indexHtml).toContain('<meta property="og:site_name" content="AutoDirector Studio" />');
      expect(indexHtml).toContain('property="og:title"');
      expect(indexHtml).toContain('property="og:description"');
      expect(indexHtml).toContain(
        '<meta property="og:url" content="https://ai-video-frontend-57bk.onrender.com/" />'
      );
      expect(indexHtml).toMatch(
        /property="og:image"\s+content="https:\/\/ai-video-frontend-57bk\.onrender\.com\/og-image\.png"/
      );
      expect(indexHtml).toContain('<meta property="og:image:width" content="1200" />');
      expect(indexHtml).toContain('<meta property="og:image:height" content="630" />');
      expect(indexHtml).toContain('<meta property="og:locale" content="en_US" />');
    });

    it('includes Twitter/X summary_large_image card tags', () => {
      expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
      expect(indexHtml).toContain('name="twitter:title"');
      expect(indexHtml).toContain('name="twitter:description"');
      expect(indexHtml).toMatch(
        /name="twitter:image"\s+content="https:\/\/ai-video-frontend-57bk\.onrender\.com\/og-image\.png"/
      );
    });

    it('contains valid Schema.org JSON-LD structured data', () => {
      const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      expect(match).not.toBeNull();

      const jsonLd = JSON.parse(match![1]);
      expect(jsonLd['@context']).toBe('https://schema.org');
      expect(Array.isArray(jsonLd['@graph'])).toBe(true);

      const types = jsonLd['@graph'].map((entity: any) => entity['@type']);
      expect(types).toContain('SoftwareApplication');
      expect(types).toContain('Organization');
      expect(types).toContain('WebSite');
      expect(types).toContain('FAQPage');

      // Check SoftwareApplication properties
      const softwareApp = jsonLd['@graph'].find((e: any) => e['@type'] === 'SoftwareApplication');
      expect(softwareApp.name).toBe('AutoDirector Studio');
      expect(softwareApp.applicationCategory).toBe('MultimediaApplication');
      expect(Array.isArray(softwareApp.offers)).toBe(true);
      expect(softwareApp.offers.length).toBe(3); // Free, Pro, Studio House
      expect(Array.isArray(softwareApp.featureList)).toBe(true);

      // Check FAQPage questions
      const faqPage = jsonLd['@graph'].find((e: any) => e['@type'] === 'FAQPage');
      expect(Array.isArray(faqPage.mainEntity)).toBe(true);
      expect(faqPage.mainEntity.length).toBeGreaterThanOrEqual(5);
    });

    it('includes semantic noscript fallback for search crawlers without JavaScript execution', () => {
      expect(indexHtml).toContain('<noscript>');
      expect(indexHtml).toContain('AutoDirector • The Editorial Video Suite');
      expect(indexHtml).toContain('5-pass rendering');
      expect(indexHtml).toContain('Voice Activity Excision');
      expect(indexHtml).toContain('Kinetic Subtitle Typography');
      expect(indexHtml).toContain('</noscript>');
    });
  });

  describe('3. Dynamic Client-Side Document SEO Manager (updateDocumentSeo)', () => {
    let originalDocument: any;
    let mockElements: Map<string, any>;

    beforeEach(() => {
      originalDocument = (globalThis as any).document;
      mockElements = new Map();

      const createMockElement = (tag: string) => {
        const attrs = new Map<string, string>();
        return {
          tagName: tag.toUpperCase(),
          setAttribute: (k: string, v: string) => attrs.set(k, v),
          getAttribute: (k: string) => attrs.get(k) || null,
        };
      };

      (globalThis as any).document = {
        title: '',
        head: {
          appendChild: (el: any) => el,
        },
        createElement: (tag: string) => createMockElement(tag),
        querySelector: (selector: string) => {
          if (!mockElements.has(selector)) {
            mockElements.set(selector, createMockElement('meta'));
          }
          return mockElements.get(selector);
        },
      };
    });

    afterEach(() => {
      (globalThis as any).document = originalDocument;
    });

    it('sets public indexable metadata when isPrivate is false', () => {
      updateDocumentSeo({
        title: 'AutoDirector • Custom Title',
        description: 'Custom description text',
        isPrivate: false,
      });

      expect(document.title).toBe('AutoDirector • Custom Title');
      const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content');
      expect(robots).toContain('index, follow');
      expect(robots).not.toContain('noindex');

      const desc = document.querySelector('meta[name="description"]')?.getAttribute('content');
      expect(desc).toBe('Custom description text');
    });

    it('strictly enforces noindex, nofollow on private views (dashboard & project sequences)', () => {
      updateDocumentSeo({
        title: 'Studio Dashboard • AutoDirector',
        isPrivate: true,
      });

      expect(document.title).toBe('Studio Dashboard • AutoDirector');
      const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content');
      expect(robots).toBe('noindex, nofollow');
    });
  });
});
