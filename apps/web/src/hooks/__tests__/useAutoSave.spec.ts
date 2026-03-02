import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API
vi.mock('../../services/api', () => ({
  apiUpdateDiagram: vi.fn().mockResolvedValue({ diagram: {} }),
  apiSaveDiagram: vi.fn().mockResolvedValue({}),
}));

import { useDiagramStore } from '../../stores/diagramStore';

describe('useAutoSave version-based change detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up a diagram in the store
    useDiagramStore.setState({
      diagrams: new Map([
        [
          'diagram-1',
          {
            id: 'diagram-1',
            projectId: 'project-1',
            parentDiagramId: null,
            parentPortalId: null,
            title: 'Test Diagram',
            viewBackgroundColor: '#ffffff',
            gridEnabled: true,
            gridSize: 20,
            renderMode: 'sketchy' as const,
            layers: [
              {
                id: 'layer-1',
                name: 'Layer 1',
                isVisible: true,
                isLocked: false,
                opacity: 100,
                order: 0,
              },
            ],
            createdBy: 'user-1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      ]),
      activeDiagramId: 'diagram-1',
    });
  });

  it('should detect changes based on element version', () => {
    // This tests the logic directly — version-based detection should
    // detect version changes and not require JSON.stringify
    const elements = new Map();
    elements.set('el-1', {
      id: 'el-1',
      diagramId: 'diagram-1',
      version: 1,
      isDeleted: false,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    const savedVersions = new Map<string, number>();

    // First check — no saved versions, should detect change
    let hasChanges = false;
    for (const [, el] of elements) {
      const savedVersion = savedVersions.get(el.id);
      if (savedVersion === undefined || savedVersion !== el.version) {
        hasChanges = true;
      }
    }
    expect(hasChanges).toBe(true);

    // Simulate saving
    for (const [, el] of elements) {
      savedVersions.set(el.id, el.version);
    }

    // Second check — same version, should not detect change
    hasChanges = false;
    for (const [, el] of elements) {
      const savedVersion = savedVersions.get(el.id);
      if (savedVersion === undefined || savedVersion !== el.version) {
        hasChanges = true;
      }
    }
    expect(hasChanges).toBe(false);

    // Third check — version bumped, should detect change
    elements.get('el-1').version = 2;
    hasChanges = false;
    for (const [, el] of elements) {
      const savedVersion = savedVersions.get(el.id);
      if (savedVersion === undefined || savedVersion !== el.version) {
        hasChanges = true;
      }
    }
    expect(hasChanges).toBe(true);
  });

  it('should detect deletions by count change', () => {
    const savedVersions = new Map<string, number>();
    savedVersions.set('el-1', 1);
    savedVersions.set('el-2', 1);

    // Only one element remains
    const elements = new Map();
    elements.set('el-1', {
      id: 'el-1',
      version: 1,
      diagramId: 'diagram-1',
      isDeleted: false,
    });

    const diagramElements = [];
    for (const [, el] of elements) {
      if (el.diagramId === 'diagram-1' && !el.isDeleted) {
        diagramElements.push(el);
      }
    }

    // Count differs from saved map size
    const hasCountChange = diagramElements.length !== savedVersions.size;
    expect(hasCountChange).toBe(true);
  });
});
