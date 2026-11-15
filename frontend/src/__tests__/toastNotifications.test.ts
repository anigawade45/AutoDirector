import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore, toast } from '../stores/toastStore';

describe('Global Toast Notification System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a success toast with title and message', () => {
    toast.success('EditPlan v2 applied successfully', 'Director Cut Applied');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Director Cut Applied');
    expect(toasts[0].message).toBe('EditPlan v2 applied successfully');
    expect(toasts[0].id).toBeDefined();
  });

  it('adds an error toast', () => {
    toast.error('Network connection lost during export', 'Export Error');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].title).toBe('Export Error');
    expect(toasts[0].message).toBe('Network connection lost during export');
  });

  it('adds a warning toast', () => {
    toast.warning('Selected layer duration exceeds track length', 'Validation Warning');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('warning');
    expect(toasts[0].title).toBe('Validation Warning');
    expect(toasts[0].message).toBe('Selected layer duration exceeds track length');
  });

  it('adds an info toast', () => {
    toast.info('Timeline proxy preview encoding in progress...', 'Proxy Rendering');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('info');
    expect(toasts[0].title).toBe('Proxy Rendering');
  });

  it('auto-dismisses toasts after duration', () => {
    toast.info('Temporary alert', 'Auto Dismiss', 3000);

    expect(useToastStore.getState().toasts).toHaveLength(1);

    // Fast-forward 2999ms - should still be there
    vi.advanceTimersByTime(2999);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    // Fast-forward another 1ms (total 3000ms) - should be dismissed
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('supports manual dismissal by ID', () => {
    const id = toast.success('Saved item');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    toast.dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('caps max visible toasts cleanly', () => {
    for (let i = 0; i < 8; i++) {
      toast.info(`Message ${i}`);
    }

    const toasts = useToastStore.getState().toasts;
    // Maximum 5 stacked toasts
    expect(toasts.length).toBeLessThanOrEqual(5);
  });

  it('clears all toasts immediately', () => {
    toast.success('One');
    toast.warning('Two');
    toast.error('Three');
    expect(useToastStore.getState().toasts).toHaveLength(3);

    toast.clear();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
