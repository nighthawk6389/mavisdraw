import { describe, it, expect } from 'vitest';
import { analyzeRepo, parseCompose, MAX_MANIFEST_CHARS } from '../repo/analyze';

/**
 * The analyzer runs on manifests from pull requests (anyone's, on a public
 * repository): hostile input must stay fast and bounded, or one PR could
 * stall the whole API.
 */

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

const snapshot = (files: Record<string, string>) => ({
  name: 'repo',
  files: Object.keys(files),
  read: (p: string) => files[p],
});

describe('hostile manifests', () => {
  it('a compose file with a huge run of whitespace parses in linear time', () => {
    const text = `services:\n  api:\n    image: node${' '.repeat(200_000)}x\n`;
    expect(time(() => parseCompose(text))).toBeLessThan(200);
  });

  it('a pyproject with thousands of blank lines parses in linear time', () => {
    const text = `${'\n'.repeat(200_000)}name = "x"`;
    const ms = time(() => analyzeRepo(snapshot({ 'pyproject.toml': text })));
    expect(ms).toBeLessThan(300);
  });

  it('a Cargo.toml built to make a regex backtrack parses in linear time', () => {
    const text = `[package]\n${'name '.repeat(40_000)}\nname = "crate"\n`;
    const ms = time(() => analyzeRepo(snapshot({ 'Cargo.toml': text })));
    expect(ms).toBeLessThan(300);
  });

  it('ignores manifests too big to be real ones', () => {
    const huge = JSON.stringify({
      name: 'huge',
      dependencies: { stripe: '1' },
      pad: 'x'.repeat(MAX_MANIFEST_CHARS),
    });
    const model = analyzeRepo(snapshot({ 'package.json': huge }));
    expect(model.resources).toEqual([]);
  });

  it('still reads ordinary manifests', () => {
    const model = analyzeRepo(
      snapshot({
        'Cargo.toml':
          '[workspace]\nmembers = []\n\n[package]\nname = "engine" # the core\nversion = "1.0.0"\n',
        'docker-compose.yml': 'services:\n  db: # the database\n    image: postgres:16\n',
      }),
    );
    expect(model.components.map((c) => c.name)).toContain('engine');
    expect(parseCompose('services:\n  db: # the database\n    image: postgres:16\n')).toEqual([
      { name: 'db', image: 'postgres:16', build: null, dependsOn: [] },
    ]);
  });
});
