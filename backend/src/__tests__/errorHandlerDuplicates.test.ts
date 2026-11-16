import { describe, it, expect } from 'vitest';
import { errorHandler } from '../middleware/errorHandler.js';
import { Request, Response } from 'express';

describe('Error Handler Duplicate Key Mapping Suite', () => {
  function createMockContext() {
    const req: Partial<Request> = {
      id: 'req_test_12345',
    };

    let responseStatusCode = 200;
    let responseBody: any = null;

    const res: Partial<Response> = {
      status(code: number) {
        responseStatusCode = code;
        return this as Response;
      },
      json(body: any) {
        responseBody = body;
        return this as Response;
      },
    };

    const next = () => {};

    return {
      req: req as Request,
      res: res as Response,
      next,
      getStatus: () => responseStatusCode,
      getBody: () => responseBody,
    };
  }

  it('maps users collection or email duplicate key to 409 USER_EXISTS', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.users index: email_1 dup key: { email: "alex@example.com" }',
      keyPattern: { email: 1 },
      keyValue: { email: 'alex@example.com' },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('USER_EXISTS');
    expect(body.error.message).toContain('An account with this email already exists');
    expect(body.error.details[0].field).toBe('email');
  });

  it('maps editplans or version duplicate key to 409 VERSION_CONFLICT', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.editplans index: projectId_1_version_-1 dup key: { projectId: "prj_1", version: 2 }',
      keyPattern: { projectId: 1, version: -1 },
      keyValue: { projectId: 'prj_1', version: 2 },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.message).toContain('version conflict occurred');
  });

  it('maps projects collection duplicate key to 409 PROJECT_CONFLICT', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.projects index: publicId_1 dup key: { publicId: "prj_demo" }',
      keyPattern: { publicId: 1 },
      keyValue: { publicId: 'prj_demo' },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PROJECT_CONFLICT');
    expect(body.error.message).toContain('project with this identifier already exists');
  });

  it('maps catalogs collection duplicate key to 409 CATALOG_EXISTS', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.catalogs index: key_1 dup key: { key: "cinematic" }',
      keyPattern: { key: 1 },
      keyValue: { key: 'cinematic' },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CATALOG_EXISTS');
    expect(body.error.message).toContain("catalog entry with key 'cinematic' already exists");
  });

  it('maps assets collection duplicate key to 409 ASSET_EXISTS', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.assets index: publicId_1 dup key: { publicId: "ast_abc123" }',
      keyPattern: { publicId: 1 },
      keyValue: { publicId: 'ast_abc123' },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ASSET_EXISTS');
    expect(body.error.message).toContain('An asset with this identifier already exists');
  });

  it('maps general unknown duplicate keys to 409 RESOURCE_CONFLICT without falsely labeling as user', () => {
    const ctx = createMockContext();
    const mongoError = {
      name: 'MongoServerError',
      code: 11000,
      message:
        'E11000 duplicate key error collection: ai_video_production.customs index: tag_1 dup key: { tag: "vivid" }',
      keyPattern: { tag: 1 },
      keyValue: { tag: 'vivid' },
    };

    errorHandler(mongoError, ctx.req, ctx.res, ctx.next);

    expect(ctx.getStatus()).toBe(409);
    const body = ctx.getBody();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
    expect(body.error.message).toContain('tag');
    expect(body.error.message).not.toContain('account');
    expect(body.error.code).not.toBe('USER_EXISTS');
  });
});
