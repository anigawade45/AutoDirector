import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsController } from '../controllers/projectsController.js';
import { ProjectModel } from '../models/Project.js';
import { Request, Response } from 'express';

vi.mock('../models/Project.js', () => ({
  ProjectModel: {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../models/Timeline.js', () => ({
  TimelineModel: {
    create: vi.fn().mockResolvedValue({ _id: 'tml_123' }),
  },
}));

describe('ProjectsController - Project Rename & Archive Lifecycle', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: any;
  let jsonMock: any;
  let statusMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
    nextFn = vi.fn();
  });

  it('updates project title and settings via PATCH', async () => {
    const mockProject: any = {
      publicId: 'prj_123',
      title: 'Old Title',
      settings: { aspect: '16:9', fps: 30 },
      save: vi.fn().mockResolvedValue(true),
    };

    (ProjectModel.findOne as any).mockResolvedValue(mockProject);

    mockReq = {
      params: { id: 'prj_123' },
      body: {
        title: 'New Vacation Highlights',
        settings: { aspect: '9:16', fps: 60 },
      },
      user: { _id: 'usr_abc', id: 'usr_abc' } as any,
      id: 'req_test_1',
    };

    await ProjectsController.updateProject(mockReq as Request, mockRes as Response, nextFn);

    expect(mockProject.title).toBe('New Vacation Highlights');
    expect(mockProject.settings.aspect).toBe('9:16');
    expect(mockProject.settings.fps).toBe(60);
    expect(mockProject.save).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it('archives a project and updates status to "archived"', async () => {
    const mockProject: any = {
      publicId: 'prj_123',
      status: 'ready',
      save: vi.fn().mockResolvedValue(true),
    };

    (ProjectModel.findOne as any).mockResolvedValue(mockProject);

    mockReq = {
      params: { id: 'prj_123' },
      user: { _id: 'usr_abc', id: 'usr_abc' } as any,
      id: 'req_test_2',
    };

    await ProjectsController.archiveProject(mockReq as Request, mockRes as Response, nextFn);

    expect(mockProject.status).toBe('archived');
    expect(mockProject.save).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it('unarchives a project back to "ready" when baseAssetId exists', async () => {
    const mockProject: any = {
      publicId: 'prj_123',
      status: 'archived',
      baseAssetId: 'ast_456',
      save: vi.fn().mockResolvedValue(true),
    };

    (ProjectModel.findOne as any).mockResolvedValue(mockProject);

    mockReq = {
      params: { id: 'prj_123' },
      user: { _id: 'usr_abc', id: 'usr_abc' } as any,
      id: 'req_test_3',
    };

    await ProjectsController.unarchiveProject(mockReq as Request, mockRes as Response, nextFn);

    expect(mockProject.status).toBe('ready');
    expect(mockProject.save).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
  });

  it('filters active projects vs archived projects in listProjects', async () => {
    const sortMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ publicId: 'prj_active' }]),
    });
    (ProjectModel.find as any).mockReturnValue({ sort: sortMock });

    // Test active filter
    mockReq = {
      query: { status: 'active' },
      user: { _id: 'usr_abc', id: 'usr_abc' } as any,
      id: 'req_test_4',
    };

    await ProjectsController.listProjects(mockReq as Request, mockRes as Response, nextFn);

    expect(ProjectModel.find).toHaveBeenCalledWith({
      userId: 'usr_abc',
      deletedAt: null,
      status: { $ne: 'archived' },
    });

    // Test archived filter
    mockReq = {
      query: { status: 'archived' },
      user: { _id: 'usr_abc', id: 'usr_abc' } as any,
      id: 'req_test_5',
    };

    await ProjectsController.listProjects(mockReq as Request, mockRes as Response, nextFn);

    expect(ProjectModel.find).toHaveBeenCalledWith({
      userId: 'usr_abc',
      deletedAt: null,
      status: 'archived',
    });
  });
});

