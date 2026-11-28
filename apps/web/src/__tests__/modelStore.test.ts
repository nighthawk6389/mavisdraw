import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectModel } from '@mavisdraw/types';

const apiGetModel = vi.fn();
vi.mock('../services/api', () => ({ apiGetModel: (id: string) => apiGetModel(id) }));

const { useModelStore } = await import('../stores/modelStore');

const modelOf = (id: string) =>
  ({ components: [{ id }], relationships: [] }) as unknown as ProjectModel;

/** A fetch the test finishes when it wants to. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  apiGetModel.mockReset();
  useModelStore.getState().reset();
});

describe('the model store', () => {
  it('fetches the new project when it changes while another project is being fetched', async () => {
    const first = deferred();
    apiGetModel.mockImplementation(async (id: string) => {
      if (id === 'p1') await first.promise;
      return { model: modelOf(id) };
    });
    const loadingFirst = useModelStore.getState().load('p1');
    // The person opens another project before the first answer comes
    const loadingSecond = useModelStore.getState().load('p2');
    first.resolve();
    await Promise.all([loadingFirst, loadingSecond]);
    expect(apiGetModel.mock.calls.map((c) => c[0])).toEqual(['p1', 'p2']);
    expect(useModelStore.getState().projectId).toBe('p2');
    expect(useModelStore.getState().model).toEqual(modelOf('p2'));
  });

  it('doesn’t refetch a model fetched a moment ago for the same drawing', async () => {
    apiGetModel.mockImplementation(async (id: string) => ({ model: modelOf(id) }));
    await useModelStore.getState().load('p1');
    const drawing = new Map();
    await useModelStore.getState().refreshIfOlder(2000, drawing);
    expect(apiGetModel).toHaveBeenCalledTimes(2);
    // Clicking from shape to shape: nothing was drawn, so nothing is fetched
    await useModelStore.getState().refreshIfOlder(2000, drawing);
    await useModelStore.getState().refreshIfOlder(2000, drawing);
    expect(apiGetModel).toHaveBeenCalledTimes(2);
    // Something was pasted meanwhile: fetched again, however recent the last
    await useModelStore.getState().refreshIfOlder(2000, new Map());
    expect(apiGetModel).toHaveBeenCalledTimes(3);
    // …and after a while anyway
    const later = new Map();
    await useModelStore.getState().refreshIfOlder(2000, later);
    useModelStore.setState({ fetchedAt: Date.now() - 5000 });
    await useModelStore.getState().refreshIfOlder(2000, later);
    expect(apiGetModel).toHaveBeenCalledTimes(5);
  });
});
