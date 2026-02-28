import React from 'react';

interface ToolButtonProps {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  shortcut?: string;
}

export default function ToolButton({
  icon,
  label,
  isActive,
  onClick,
  onDoubleClick,
  shortcut,
}: ToolButtonProps) {
  return (
    <button
      className={`
        w-10 h-10 flex items-center justify-center rounded-lg text-lg
        transition-colors duration-150 relative group
        ${isActive
          ? 'bg-blue-100 text-blue-700 border border-blue-300'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
        }
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    >
      <span>{icon}</span>
      <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-xs rounded
        opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
        {label}
        {shortcut && <span className="ml-1 text-gray-400">{shortcut}</span>}
      </span>
    </button>
  );
}
