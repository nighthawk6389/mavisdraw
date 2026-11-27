import { TEMPLATES } from '../../templates/templates';

export const BLANK = 'blank';

/**
 * Pick a starting point: a blank canvas or one of the templates. A radio
 * group, so it works with the keyboard and screen readers.
 */
export default function TemplateCards({
  value,
  onChange,
  includeBlank = true,
  name = 'template',
}: {
  value: string;
  onChange: (id: string) => void;
  includeBlank?: boolean;
  name?: string;
}) {
  const options = [
    ...(includeBlank
      ? [{ id: BLANK, name: 'Blank', description: 'An empty canvas.', tags: [] as string[] }]
      : []),
    ...TEMPLATES,
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Start from"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
    >
      {options.map((t) => {
        const selected = value === t.id;
        return (
          <label
            key={t.id}
            className={`flex cursor-pointer flex-col rounded-lg border p-3 text-left transition-colors ${
              selected
                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={t.id}
              checked={selected}
              onChange={() => onChange(t.id)}
              className="sr-only"
            />
            <span className="text-sm font-medium text-gray-900">{t.name}</span>
            <span className="mt-1 line-clamp-3 text-xs text-gray-500">{t.description}</span>
            {t.tags.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-1">
                {t.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
