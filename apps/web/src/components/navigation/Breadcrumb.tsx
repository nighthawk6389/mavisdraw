import React from 'react';
import { useDiagramStore } from '../../stores/diagramStore';

export default function Breadcrumb() {
  const diagramPath = useDiagramStore((s) => s.diagramPath);
  const diagrams = useDiagramStore((s) => s.diagrams);
  const navigateToPathIndex = useDiagramStore((s) => s.navigateToPathIndex);

  if (diagramPath.length <= 1) {
    // At root — show just the root name without breadcrumb navigation
    const rootDiagram = diagrams.get(diagramPath[0]);
    return (
      <nav
        className="flex items-center h-8 px-3 bg-white/80 backdrop-blur-sm border-b
          border-gray-200 text-sm select-none z-20"
        data-testid="breadcrumb"
      >
        <span className="font-semibold text-gray-800 truncate">
          {rootDiagram?.title ?? 'Root'}
        </span>
      </nav>
    );
  }

  return (
    <nav
      className="flex items-center h-8 px-3 bg-white/80 backdrop-blur-sm border-b
        border-gray-200 text-sm select-none z-20 overflow-x-auto"
      data-testid="breadcrumb"
    >
      {diagramPath.map((diagramId, index) => {
        const diagram = diagrams.get(diagramId);
        const isLast = index === diagramPath.length - 1;
        const title = diagram?.title ?? 'Untitled';

        return (
          <React.Fragment key={diagramId}>
            {index > 0 && (
              <span className="mx-1.5 text-gray-400 flex-shrink-0" aria-hidden="true">
                ›
              </span>
            )}
            {isLast ? (
              <span
                className="font-semibold text-gray-800 truncate max-w-[160px]"
                title={title}
              >
                {title}
              </span>
            ) : (
              <button
                className="text-blue-600 hover:text-blue-800 hover:underline truncate
                  max-w-[140px] transition-colors"
                onClick={() => navigateToPathIndex(index)}
                title={title}
              >
                {title}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
