import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveApiBaseUrl } from '../api/client';

describe('API Base URL Resolution & Environment Decoupling Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Default Fallbacks & Relative Routing', () => {
    it('defaults to relative "/api" when input is empty string or undefined', () => {
      expect(resolveApiBaseUrl('')).toBe('/api');
      expect(resolveApiBaseUrl('   ')).toBe('/api');
      expect(resolveApiBaseUrl(undefined)).toBe('/api');
    });

    it('normalizes relative path "/api" and trims trailing slashes', () => {
      expect(resolveApiBaseUrl('/api')).toBe('/api');
      expect(resolveApiBaseUrl('/api/')).toBe('/api');
      expect(resolveApiBaseUrl('/api///')).toBe('/api');
      expect(resolveApiBaseUrl('/v1/api/')).toBe('/v1/api');
    });
  });

  describe('2. Absolute URL Normalization', () => {
    it('preserves valid absolute HTTPS API URLs', () => {
      expect(resolveApiBaseUrl('https://api.mycompany.com/api')).toBe(
        'https://api.mycompany.com/api'
      );
      expect(resolveApiBaseUrl('https://api.mycompany.com/api/')).toBe(
        'https://api.mycompany.com/api'
      );
    });

    it('appends "/api" suffix when absolute URL has root path', () => {
      expect(resolveApiBaseUrl('https://api.mycompany.com')).toBe('https://api.mycompany.com/api');
      expect(resolveApiBaseUrl('https://api.mycompany.com/')).toBe('https://api.mycompany.com/api');
    });

    it('supports local development HTTP endpoints with ports', () => {
      expect(resolveApiBaseUrl('http://localhost:4000')).toBe('http://localhost:4000/api');
      expect(resolveApiBaseUrl('http://localhost:4000/api')).toBe('http://localhost:4000/api');
      expect(resolveApiBaseUrl('http://127.0.0.1:8080/api')).toBe('http://127.0.0.1:8080/api');
    });

    it('preserves internal Docker container hostnames without injecting external domains', () => {
      expect(resolveApiBaseUrl('http://backend:4000/api')).toBe('http://backend:4000/api');
      expect(resolveApiBaseUrl('http://api-service:3000')).toBe('http://api-service:3000/api');
    });
  });

  describe('3. Elimination of Hardcoded Tenant Fallback Coupling', () => {
    it('does not force hardcoded ai-video-api-eaui.onrender.com when running on onrender.com host with empty env', () => {
      // Mock window.location.hostname to an onrender.com domain (e.g. staging or review app)
      const originalWindow = global.window;
      (global as any).window = {
        location: { hostname: 'ai-video-staging-review-pr12.onrender.com' },
      };

      try {
        // When VITE_API_BASE_URL is not set on a custom Render host, it must cleanly default to relative '/api'
        // and NOT hijack requests to the hardcoded production service ai-video-api-eaui.onrender.com
        const resolved = resolveApiBaseUrl('');
        expect(resolved).toBe('/api');
        expect(resolved).not.toContain('ai-video-api-eaui');
      } finally {
        (global as any).window = originalWindow;
      }
    });

    it('honors explicitly configured Render API URL from environment', () => {
      const explicitUrl = 'https://my-custom-api.onrender.com/api';
      expect(resolveApiBaseUrl(explicitUrl)).toBe(explicitUrl);
    });
  });
});
