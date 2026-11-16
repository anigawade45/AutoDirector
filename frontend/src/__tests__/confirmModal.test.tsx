import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmModal } from '../components/common/ConfirmModal';

describe('ConfirmModal Component & Accessibility Suite', () => {
  it('does not render anything when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <ConfirmModal
        isOpen={false}
        title="Delete Item"
        description="Are you sure?"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('renders accessible alertdialog with title, description, and item target', () => {
    const html = renderToStaticMarkup(
      <ConfirmModal
        isOpen={true}
        title="Delete Project"
        description="This will permanently delete the project from cloud storage."
        itemName="Teaser Video 4K"
        confirmLabel="Permanently Delete"
        cancelLabel="Keep Project"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="confirm-dialog-title"');
    expect(html).toContain('aria-describedby="confirm-dialog-desc"');
    expect(html).toContain('Delete Project');
    expect(html).toContain('This will permanently delete the project from cloud storage.');
    expect(html).toContain('Teaser Video 4K');
    expect(html).toContain('Permanently Delete');
    expect(html).toContain('Keep Project');
    expect(html).toContain('This action cannot be undone');
  });

  it('renders non-destructive variant when isDestructive is false', () => {
    const html = renderToStaticMarkup(
      <ConfirmModal
        isOpen={true}
        title="Archive Project"
        description="Archive this project to library."
        isDestructive={false}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('Archive Project');
    expect(html).toContain('Archive this project to library.');
    expect(html).not.toContain('This action cannot be undone');
  });

  it('renders loading indicator and disabled buttons when isLoading is true', () => {
    const html = renderToStaticMarkup(
      <ConfirmModal
        isOpen={true}
        title="Delete Project"
        description="Are you sure?"
        isLoading={true}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('Deleting...');
    expect(html).toContain('disabled=""');
  });
});
