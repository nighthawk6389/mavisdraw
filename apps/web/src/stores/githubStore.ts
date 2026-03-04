import { create } from 'zustand';
import {
  apiGetGitHubAuthUrl,
  apiGitHubCallback,
  apiGetGitHubStatus,
  apiListGitHubRepos,
  apiGetRepoBranches,
  apiGetRepoTree,
  apiGetFileContent,
  apiDisconnectGitHub,
  type GitHubConnection,
  type GitHubRepo,
  type GitHubBranch,
  type TreeEntry,
} from '../services/github';

interface GitHubState {
  connections: GitHubConnection[];
  repos: GitHubRepo[];
  branches: GitHubBranch[];
  treeEntries: TreeEntry[];
  fileContent: string | null;
  isLoading: boolean;
  error: string | null;

  // Connection management
  initialize: () => Promise<void>;
  connect: (enterpriseUrl?: string) => Promise<void>;
  handleOAuthCallback: (code: string, enterpriseUrl?: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;

  // Repo browsing
  fetchRepos: (connectionId: string, page?: number) => Promise<void>;
  fetchBranches: (connectionId: string, owner: string, repo: string) => Promise<void>;
  fetchTree: (
    connectionId: string,
    owner: string,
    repo: string,
    path?: string,
    ref?: string,
  ) => Promise<void>;
  fetchFileContent: (
    connectionId: string,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ) => Promise<void>;

  clearError: () => void;
  clearFileContent: () => void;
}

export const useGitHubStore = create<GitHubState>((set) => ({
  connections: [],
  repos: [],
  branches: [],
  treeEntries: [],
  fileContent: null,
  isLoading: false,
  error: null,

  initialize: async () => {
    try {
      const { connections } = await apiGetGitHubStatus();
      set({ connections });
    } catch {
      // Silently fail — user may not be authenticated yet
    }
  },

  connect: async (enterpriseUrl?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { url } = await apiGetGitHubAuthUrl(enterpriseUrl);
      // Open OAuth in a popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(
        url,
        'github-oauth',
        `width=${width},height=${height},left=${left},top=${top}`,
      );
      set({ isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to start GitHub connection',
      });
    }
  },

  handleOAuthCallback: async (code: string, enterpriseUrl?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { connection } = await apiGitHubCallback(code, enterpriseUrl);
      set((state) => ({
        connections: [...state.connections, connection],
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'GitHub connection failed',
      });
    }
  },

  disconnect: async (connectionId: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiDisconnectGitHub(connectionId);
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== connectionId),
        isLoading: false,
      }));
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to disconnect',
      });
    }
  },

  fetchRepos: async (connectionId: string, page = 1) => {
    set({ isLoading: true, error: null });
    try {
      const { repos } = await apiListGitHubRepos(connectionId, page);
      set({ repos, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load repos',
      });
    }
  },

  fetchBranches: async (connectionId: string, owner: string, repo: string) => {
    try {
      const { branches } = await apiGetRepoBranches(connectionId, owner, repo);
      set({ branches });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load branches',
      });
    }
  },

  fetchTree: async (
    connectionId: string,
    owner: string,
    repo: string,
    path = '',
    ref = 'HEAD',
  ) => {
    set({ isLoading: true, error: null });
    try {
      const { entries } = await apiGetRepoTree(connectionId, owner, repo, path, ref);
      set({ treeEntries: entries, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load tree',
      });
    }
  },

  fetchFileContent: async (
    connectionId: string,
    owner: string,
    repo: string,
    path: string,
    ref = 'HEAD',
  ) => {
    set({ isLoading: true, error: null });
    try {
      const { content } = await apiGetFileContent(connectionId, owner, repo, path, ref);
      set({ fileContent: content, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load file',
      });
    }
  },

  clearError: () => set({ error: null }),
  clearFileContent: () => set({ fileContent: null }),
}));
