/**
 * Which repository files the repo → map analyzer needs. Mirrors
 * isManifest/isRelevantPath in packages/compat/src/repo/analyze.ts (the
 * server can't import that package at runtime: it ships TypeScript sources).
 */
export function isManifest(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  return (
    base === 'package.json' ||
    base === 'pnpm-workspace.yaml' ||
    base === 'go.mod' ||
    base === 'Cargo.toml' ||
    base === 'pyproject.toml' ||
    /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(base)
  );
}

const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|target|\.next|\.turbo|__pycache__|\.venv)(\/|$)/;

export function isRelevantPath(path: string): boolean {
  return !IGNORED_DIR.test(path);
}
