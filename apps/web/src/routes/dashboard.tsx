import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import ConfirmEmailBanner from '../components/auth/ConfirmEmailBanner';
import { navigate, projectPath } from '../routing';
import {
  apiListProjects,
  apiCreateProject,
  apiDeleteProject,
  apiListWorkspaces,
  apiCreateWorkspace,
  apiUpdateProject,
  type ProjectResponse,
  type WorkspaceResponse,
} from '../services/api';
import WorkspaceMembersDialog from '../components/dashboard/WorkspaceMembersDialog';
import { useUIStore } from '../stores/uiStore';
import NotificationBell from '../components/comments/NotificationBell';
import TemplateCards, { BLANK } from '../components/templates/TemplateCards';
import { SAMPLE_TEMPLATE_ID, findTemplate } from '../templates/templates';

interface DashboardProps {
  onOpenProject: (projectId: string) => void;
}

/** Where a project lives on the dashboard. */
type Space =
  | { kind: 'recent' }
  | { kind: 'personal' }
  | { kind: 'shared' }
  | { kind: 'workspace'; id: string };

const isOwner = (p: ProjectResponse) => !p.role || p.role === 'owner';

function inSpace(p: ProjectResponse, space: Space): boolean {
  if (space.kind === 'recent') return true;
  if (space.kind === 'workspace') return p.workspaceId === space.id;
  if (p.workspaceId) return false;
  return space.kind === 'personal' ? isOwner(p) : !isOwner(p);
}

function initialSpace(): Space {
  const ws = new URLSearchParams(window.location.search).get('workspace');
  return ws ? { kind: 'workspace', id: ws } : { kind: 'recent' };
}

export default function Dashboard({ onOpenProject }: DashboardProps) {
  const { user, logout } = useAuthStore();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [space, setSpace] = useState<Space>(initialSpace);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newTemplate, setNewTemplate] = useState(BLANK);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membersOf, setMembersOf] = useState<WorkspaceResponse | null>(null);
  const [moving, setMoving] = useState<ProjectResponse | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [p, w] = await Promise.all([
        apiListProjects(),
        apiListWorkspaces().catch(() => ({ workspaces: [] as WorkspaceResponse[] })),
      ]);
      setProjects(p.projects);
      setWorkspaces(w.workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentWorkspace =
    space.kind === 'workspace' ? (workspaces.find((w) => w.id === space.id) ?? null) : null;
  const title =
    space.kind === 'recent'
      ? 'Recent projects'
      : space.kind === 'personal'
        ? 'Your projects'
        : space.kind === 'shared'
          ? 'Shared with you'
          : (currentWorkspace?.name ?? 'Workspace');

  const visible = useMemo(
    () =>
      projects
        .filter((p) => inSpace(p, space))
        .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [projects, space, searchQuery],
  );

  // Folders in this space, alphabetical; unfiled projects first
  const groups = useMemo(() => {
    const byFolder = new Map<string, ProjectResponse[]>();
    for (const p of visible) {
      // Recent is one list across spaces; folders belong to a space
      const key = space.kind === 'recent' ? '' : (p.folder ?? '');
      byFolder.set(key, [...(byFolder.get(key) ?? []), p]);
    }
    return Array.from(byFolder.entries()).sort(([a], [b]) =>
      a === '' ? -1 : b === '' ? 1 : a.localeCompare(b),
    );
  }, [visible, space.kind]);

  const folderNames = useMemo(
    () =>
      Array.from(
        new Set(projects.filter((p) => inSpace(p, space) && p.folder).map((p) => p.folder!)),
      ),
    [projects, space],
  );

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await apiCreateProject(
        newProjectName.trim(),
        space.kind === 'workspace' ? space.id : null,
      );
      setNewProjectName('');
      setShowCreateDialog(false);
      if (newTemplate !== BLANK) {
        // Open it and lay the template out (see templates/startup.ts)
        navigate(`${projectPath(response.project.id)}?template=${newTemplate}`);
        return;
      }
      setProjects((prev) => [{ ...response.project, role: 'owner' }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  /** First run: make a project and open it straight into what was picked. */
  const startProject = async (name: string, query: string) => {
    if (isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const { project } = await apiCreateProject(
        name,
        space.kind === 'workspace' ? space.id : null,
      );
      navigate(`${projectPath(project.id)}${query}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    setError(null);
    try {
      await apiDeleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const update = async (
    id: string,
    changes: { folder?: string | null; workspaceId?: string | null },
  ) => {
    setError(null);
    try {
      const { project } = await apiUpdateProject(id, changes);
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...project, role: p.role } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project');
    }
  };

  const fileInFolder = (p: ProjectResponse) => {
    const hint = folderNames.length ? ` (existing: ${folderNames.join(', ')})` : '';
    const name = prompt(
      `Folder for “${p.name}”${hint}. Leave empty to take it out of its folder.`,
      p.folder ?? '',
    );
    if (name === null) return;
    void update(p.id, { folder: name.trim() || null });
  };

  const newWorkspace = async () => {
    const name = prompt('Name your workspace (e.g. your team or company)');
    if (!name?.trim()) return;
    try {
      const { workspace } = await apiCreateWorkspace(name.trim());
      setWorkspaces((prev) => [...prev, workspace].sort((a, b) => a.name.localeCompare(b.name)));
      setSpace({ kind: 'workspace', id: workspace.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  };

  const spaceButton = (s: Space, label: string, count: number, extra?: string) => {
    const active =
      s.kind === space.kind &&
      (s.kind !== 'workspace' || (space.kind === 'workspace' && space.id === s.id));
    return (
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => setSpace(s)}
        className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm ${
          active ? 'bg-blue-50 font-medium text-blue-800' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="ml-2 text-xs text-gray-400">{extra ?? count}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-bold text-gray-900">MavisDraw</h1>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => useUIStore.getState().setShowAgentAccess(true)}
              className="text-sm text-gray-600 transition-colors hover:text-gray-900"
              title="Let coding agents (Claude Code, Cursor…) read your maps and propose updates"
            >
              Connect a coding agent
            </button>
            <NotificationBell />
            <span className="text-sm text-gray-600">{user?.name}</span>
            <button
              onClick={logout}
              className="text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <ConfirmEmailBanner />

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
        {/* Spaces */}
        <nav className="w-56 shrink-0 space-y-1" aria-label="Spaces">
          {spaceButton({ kind: 'recent' }, 'Recent', projects.length)}
          {spaceButton(
            { kind: 'personal' },
            'Your projects',
            projects.filter((p) => inSpace(p, { kind: 'personal' })).length,
          )}
          {spaceButton(
            { kind: 'shared' },
            'Shared with you',
            projects.filter((p) => inSpace(p, { kind: 'shared' })).length,
          )}
          <div className="flex items-center justify-between px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Workspaces
            <button
              type="button"
              onClick={() => void newWorkspace()}
              className="text-base font-normal leading-none text-gray-400 hover:text-blue-600"
              aria-label="New workspace"
              title="New workspace"
            >
              +
            </button>
          </div>
          {workspaces.length === 0 && (
            <p className="px-3 text-xs text-gray-400">
              Create a workspace to share every project with your team at once.
            </p>
          )}
          {workspaces.map((w) =>
            spaceButton({ kind: 'workspace', id: w.id }, w.name, 0, `${w.memberCount} 👤`),
          )}
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <h2 className="truncate text-2xl font-semibold text-gray-900">{title}</h2>
              {currentWorkspace && (
                <button
                  type="button"
                  onClick={() => setMembersOf(currentWorkspace)}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Members ({currentWorkspace.memberCount})
                </button>
              )}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {space.kind !== 'shared' && (
              <button
                onClick={() => setShowCreateDialog(true)}
                className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                New Project
              </button>
            )}
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {showCreateDialog && (
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow">
              <form onSubmit={handleCreateProject} className="flex items-center gap-3">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  autoFocus
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateDialog(false);
                    setNewProjectName('');
                    setNewTemplate(BLANK);
                  }}
                  className="px-4 py-2 text-sm text-gray-600 transition-colors hover:text-gray-800"
                >
                  Cancel
                </button>
              </form>
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Start from
                </p>
                <TemplateCards
                  value={newTemplate}
                  onChange={(id) => {
                    setNewTemplate(id);
                    // A sensible default name, until the person types their own
                    const template = findTemplate(id);
                    if (template && !newProjectName.trim()) setNewProjectName(template.name);
                  }}
                />
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              Loading projects...
            </div>
          ) : projects.length === 0 && !searchQuery && space.kind !== 'shared' ? (
            <Welcome
              busy={isCreating}
              onMapRepo={() => void startProject('My architecture', '?start=repo')}
              onSample={() =>
                void startProject('Sample: Online shop', `?template=${SAMPLE_TEMPLATE_ID}`)
              }
              onTemplate={() => setShowCreateDialog(true)}
            />
          ) : visible.length === 0 ? (
            <div className="py-12 text-center">
              <p className="mb-4 text-gray-500">
                {searchQuery
                  ? 'No projects match your search'
                  : space.kind === 'shared'
                    ? 'Nothing has been shared with you yet'
                    : 'No projects yet'}
              </p>
              {!searchQuery && space.kind !== 'shared' && (
                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="font-medium text-blue-600 hover:text-blue-500"
                >
                  Create your first project
                </button>
              )}
            </div>
          ) : (
            groups.map(([folder, list]) => (
              <section key={folder || '_'} className="mb-8" aria-label={folder || 'Projects'}>
                {folder && (
                  <h3
                    className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-600"
                    data-testid="folder-heading"
                  >
                    <span aria-hidden>📁</span> {folder}
                    <span className="font-normal text-gray-400">{list.length}</span>
                  </h3>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((project) => (
                    <a
                      key={project.id}
                      href={projectPath(project.id)}
                      data-testid="project-card"
                      className="group block cursor-pointer rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={(e) => {
                        // Let modified clicks open a new tab; plain clicks route in-app
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        if (project.rootDiagramId) onOpenProject(project.id);
                      }}
                    >
                      <div className="flex h-32 items-center justify-center rounded-t-lg bg-gray-100 text-3xl text-gray-300">
                        ⧉
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <h4 className="truncate font-medium text-gray-900">{project.name}</h4>
                          {project.role && project.role !== 'owner' && (
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                              {project.role}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {new Date(project.updatedAt).toLocaleDateString()}
                        </p>
                        <div className="mt-2 flex gap-3 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          {project.role !== 'viewer' && (
                            <button
                              type="button"
                              className="text-gray-500 hover:text-gray-800"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                fileInFolder(project);
                              }}
                            >
                              Folder…
                            </button>
                          )}
                          {isOwner(project) && (
                            <>
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-800"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMoving(project);
                                }}
                              >
                                Move…
                              </button>
                              <button
                                type="button"
                                className="text-red-500 hover:text-red-700"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleDeleteProject(project.id);
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      </div>

      {membersOf && (
        <WorkspaceMembersDialog
          workspace={membersOf}
          onClose={() => setMembersOf(null)}
          onChanged={() => void load()}
        />
      )}

      {moving && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setMoving(null)}
        >
          <div
            role="dialog"
            aria-label="Move project"
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 font-semibold text-gray-900">Move “{moving.name}”</h2>
            <p className="mb-4 text-sm text-gray-500">
              Everyone in a workspace can open and edit its projects.
            </p>
            <div className="space-y-1">
              {[
                { id: null as string | null, name: 'Your projects (personal)' },
                ...workspaces.map((w) => ({ id: w.id as string | null, name: w.name })),
              ].map((target) => (
                <button
                  key={target.id ?? 'personal'}
                  type="button"
                  disabled={(moving.workspaceId ?? null) === target.id}
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-transparent"
                  onClick={() => {
                    void update(moving.id, { workspaceId: target.id }).then(() => void load());
                    setMoving(null);
                  }}
                >
                  {target.name}
                  {(moving.workspaceId ?? null) === target.id && ' · here now'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a new person sees: the fastest ways to a useful map. */
function Welcome({
  busy,
  onMapRepo,
  onSample,
  onTemplate,
}: {
  busy: boolean;
  onMapRepo: () => void;
  onSample: () => void;
  onTemplate: () => void;
}) {
  const card =
    'flex flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md disabled:opacity-50';
  return (
    <section aria-label="Get started" className="py-6" data-testid="welcome">
      <h2 className="text-2xl font-bold text-gray-900">Map your system in minutes</h2>
      <p className="mt-1 mb-6 max-w-2xl text-gray-600">
        MavisDraw maps are nested: every system opens into its own diagram, linked to the code it
        stands for. Pick a way in.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button type="button" className={card} disabled={busy} onClick={onMapRepo}>
          <span className="text-base font-semibold text-gray-900">Map a repository</span>
          <span className="mt-1 text-sm text-gray-600">
            Point it at a GitHub repo or a folder: apps and packages become nested systems, with the
            databases and services they use.
          </span>
        </button>
        <button type="button" className={card} disabled={busy} onClick={onSample}>
          <span className="text-base font-semibold text-gray-900">Explore a sample</span>
          <span className="mt-1 text-sm text-gray-600">
            An online shop in the C4 style, three levels deep. Double-click a system to look inside.
          </span>
        </button>
        <button type="button" className={card} disabled={busy} onClick={onTemplate}>
          <span className="text-base font-semibold text-gray-900">Start from a template</span>
          <span className="mt-1 text-sm text-gray-600">
            Microservices, AWS, event-driven, data pipelines… or a blank canvas.
          </span>
        </button>
      </div>
    </section>
  );
}
