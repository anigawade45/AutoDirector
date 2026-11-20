import { describe, it, expect } from 'vitest';
import { parseRoute } from '../utils/routeParser';

describe('Frontend HTML5 Routing & Deep Linking Engine', () => {
  it('parses root / as landing page', () => {
    const route = parseRoute('/');
    expect(route).toEqual({ view: 'landing', projectId: null });
  });

  it('parses /dashboard as dashboard view', () => {
    const route = parseRoute('/dashboard');
    expect(route).toEqual({ view: 'dashboard', projectId: null });
  });

  it('parses /projects/:id as editor view with project id', () => {
    const route = parseRoute('/projects/prj_cinema_001');
    expect(route).toEqual({ view: 'editor', projectId: 'prj_cinema_001' });
  });

  it('parses /editor/:id alias as editor view with project id', () => {
    const route = parseRoute('/editor/prj_doc_999');
    expect(route).toEqual({ view: 'editor', projectId: 'prj_doc_999' });
  });

  it('correctly ignores query parameters and trailing fragments', () => {
    const route = parseRoute('/projects/prj_param_123?tab=inspector&mode=preview#timeline');
    expect(route).toEqual({ view: 'editor', projectId: 'prj_param_123' });
  });

  it('decodes URI encoded project identifiers', () => {
    const route = parseRoute('/projects/prj%20film%26music');
    expect(route).toEqual({ view: 'editor', projectId: 'prj film&music' });
  });

  it('supports SPA hash routes (#/projects/:id) as fallback', () => {
    const route = parseRoute('/', '#/projects/prj_hash_007');
    expect(route).toEqual({ view: 'editor', projectId: 'prj_hash_007' });
  });

  it('supports SPA hash routes (#/dashboard) as fallback', () => {
    const route = parseRoute('/', '#/dashboard');
    expect(route).toEqual({ view: 'dashboard', projectId: null });
  });

  it('falls back to landing view for unknown root-level paths', () => {
    const route = parseRoute('/about');
    expect(route).toEqual({ view: 'landing', projectId: null });
  });
});
