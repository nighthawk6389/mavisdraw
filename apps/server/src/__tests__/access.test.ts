import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/client.js', () => ({ db: {} }));
const { accessFromWorkspace, combineAccess } = await import('../services/diagramService.js');

describe('project access', () => {
  const none = { isOwner: false, projectRole: null, workspaceRole: null, isPublic: false };

  it('the owner is the owner', () => {
    expect(combineAccess({ ...none, isOwner: true, projectRole: 'viewer' })).toBe('owner');
  });

  it('workspace members can edit, workspace admins and owners administer', () => {
    expect(accessFromWorkspace('member')).toBe('editor');
    expect(accessFromWorkspace('admin')).toBe('admin');
    expect(accessFromWorkspace('owner')).toBe('admin');
    expect(combineAccess({ ...none, workspaceRole: 'member' })).toBe('editor');
  });

  it('takes the higher of a direct share and workspace membership', () => {
    expect(combineAccess({ ...none, projectRole: 'viewer', workspaceRole: 'member' })).toBe(
      'editor',
    );
    expect(combineAccess({ ...none, projectRole: 'admin', workspaceRole: 'member' })).toBe('admin');
  });

  it('public projects are viewable; otherwise no access', () => {
    expect(combineAccess({ ...none, isPublic: true })).toBe('viewer');
    expect(combineAccess(none)).toBeNull();
    // A direct share beats public
    expect(combineAccess({ ...none, isPublic: true, projectRole: 'editor' })).toBe('editor');
  });
});
