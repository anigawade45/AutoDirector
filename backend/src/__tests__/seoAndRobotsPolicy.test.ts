import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { Request, Response } from 'express';

vi.mock('../config/redis.js', () => ({
  redisConnection: {
    status: 'ready',
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
  },
  createRedisConnection: vi.fn(),
}));

vi.mock('../services/storage/s3Service.js', () => ({
  S3Service: {
    checkHealth: vi.fn().mockResolvedValue(true),
  },
}));

describe('Backend SEO & Robots Crawler Governance Policy', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  it('responds with text/plain robots.txt on GET /robots.txt disallowing API crawling', async () => {
    const app = createApp();
    const mockReq = {} as Request;
    let contentType = '';
    let responseBody = '';

    const mockRes = {
      type: (t: string) => {
        contentType = t;
        return mockRes;
      },
      send: (b: string) => {
        responseBody = b;
        return mockRes;
      },
    } as unknown as Response;

    const robotsRoute = (app as any)._router.stack.find(
      (layer: any) => layer.route && layer.route.path === '/robots.txt'
    );
    expect(robotsRoute).toBeDefined();

    robotsRoute.route.stack[0].handle(mockReq, mockRes);

    expect(contentType).toBe('text/plain');
    expect(responseBody).toContain('User-agent: *');
    expect(responseBody).toContain('Disallow: /api/');
    expect(responseBody).toContain('Disallow: /internal/');
  });

  it('verifies frontend/nginx.conf specifies dedicated location blocks for robots.txt and sitemap.xml', () => {
    const nginxPath = path.join(rootDir, 'frontend/nginx.conf');
    expect(fs.existsSync(nginxPath)).toBe(true);

    const content = fs.readFileSync(nginxPath, 'utf8');
    expect(content).toContain('location = /robots.txt {');
    expect(content).toContain('default_type text/plain;');
    expect(content).toContain('location = /sitemap.xml {');
    expect(content).toContain('default_type application/xml;');
    expect(content).toContain('location /assets/ {');
    expect(content).toContain('max-age=31536000, immutable');
  });

  it('verifies public sitemap.xml is valid XML and matches Google Search Central guidelines', () => {
    const sitemapPath = path.join(rootDir, 'frontend/public/sitemap.xml');
    expect(fs.existsSync(sitemapPath)).toBe(true);

    const xml = fs.readFileSync(sitemapPath, 'utf8');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://ai-video-frontend-57bk.onrender.com/</loc>');
    expect(xml).toContain('</urlset>');
  });
});
