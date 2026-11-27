import { useEffect, useMemo, useState } from 'react';
import type { MavisElement, ModelComponent, ModelComponentKind, ModelLink } from '@mavisdraw/types';
import {
  componentById,
  dependenciesOf,
  dependentsOf,
  MODEL_COMPONENT_KINDS,
  possibleDuplicates,
  undrawnOn,
} from '@mavisdraw/llm';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useModelStore } from '../../stores/modelStore';
import { toast } from '../../stores/toastStore';
import { apiUpdateComponent } from '../../services/api';
import {
  componentKeyFor,
  drawRelationshipHere,
  labelFor,
  linkToComponent,
  showAppearance,
  unlinkComponent,
} from '../../services/modelSync';

type TextField = 'name' | 'description' | 'technology' | 'owner';

const KIND_LABELS: Record<ModelComponentKind, string> = {
  service: 'Service',
  datastore: 'Data store',
  queue: 'Queue / topic',
  external: 'External system',
  system: 'System',
  person: 'Person',
  other: 'Other',
};

interface Props {
  elementId: string;
  canEdit: boolean;
  /** Inside another column (the style panel) rather than its own. */
  embedded?: boolean;
}

/**
 * What the selected shape stands for in the architecture: its details, where
 * else it's drawn, and what it depends on across levels.
 */
export default function ComponentPanel({ elementId, canEdit, embedded = false }: Props) {
  // Primitives and stable references only (no new objects in selectors)
  const element = useElementsStore((s) => s.elements.get(elementId));
  const label = useElementsStore((s) => labelFor(s.elements, elementId));
  const activeDiagramId = useDiagramStore((s) => s.activeDiagramId);
  const projectId = useModelStore((s) => s.projectId);
  const model = useModelStore((s) => s.model);

  const key = element ? componentKeyFor(element, label) : null;
  const component = model && key ? componentById(model, key) : undefined;

  // Opening the panel on a component: fetch what the server knows now (it
  // reads live rooms, so copies pasted a moment ago are counted)
  useEffect(() => {
    if (key) void useModelStore.getState().refresh();
  }, [key]);

  // A shape labelled moments ago reaches the model once it's saved: retry a
  // few times (the count belongs to this component; another starts at 0)
  const [attempts, setAttempts] = useState<{ key: string | null; n: number }>({ key: null, n: 0 });
  const retries = attempts.key === key ? attempts.n : 0;
  useEffect(() => {
    if (!key || component || retries >= 5) return;
    const t = setTimeout(() => {
      void useModelStore.getState().refresh();
      setAttempts({ key, n: retries + 1 });
    }, 1500);
    return () => clearTimeout(t);
  }, [key, component, retries]);

  if (!element || !key || !label) return null;

  return (
    <section
      className={
        embedded
          ? 'border-b border-gray-200 pb-3 text-sm'
          : 'w-56 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-3 text-sm'
      }
      data-testid="component-panel"
      aria-label="Component"
    >
      {component && projectId ? (
        <ComponentDetails
          key={component.id}
          projectId={projectId}
          component={component}
          element={element}
          activeDiagramId={activeDiagramId}
          canEdit={canEdit}
        />
      ) : (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Component
          </div>
          <div className="mt-1 font-medium text-gray-900">{label}</div>
          <p className="mt-2 text-xs text-gray-500">
            Details, other appearances and dependencies show up once the map is saved.
          </p>
        </>
      )}
    </section>
  );
}

function ComponentDetails({
  projectId,
  component,
  element,
  activeDiagramId,
  canEdit,
}: {
  projectId: string;
  component: ModelComponent;
  element: MavisElement;
  activeDiagramId: string;
  canEdit: boolean;
}) {
  const model = useModelStore((s) => s.model)!;
  // What's being typed into a field; null/absent = show the model's value,
  // so changes made elsewhere (a teammate, a rename) show unless mid-edit
  const [drafts, setDrafts] = useState<Partial<Record<TextField, string>>>({});
  const valueOf = (f: TextField) => drafts[f] ?? component[f] ?? '';
  const draft = (f: TextField, v: string) => setDrafts((d) => ({ ...d, [f]: v }));
  const discard = (f: TextField) =>
    setDrafts(({ [f]: _gone, ...rest }) => rest as Partial<Record<TextField, string>>);
  /** Save a details field when it loses focus (empty clears it). */
  const commit = (f: Exclude<TextField, 'name'>) => {
    const v = drafts[f];
    discard(f);
    if (v !== undefined && v !== (component[f] ?? '')) void save({ [f]: v.trim() || null });
  };
  const [linkDraft, setLinkDraft] = useState<ModelLink>({ label: '', url: '' });
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');

  const save = async (patch: Record<string, unknown>, done?: string) => {
    try {
      await apiUpdateComponent(projectId, component.id, patch);
      await useModelStore.getState().refresh();
      if (done) toast(done, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t save', 'error');
    }
  };

  const nameOf = (id: string) => componentById(model, id)?.name ?? 'Unknown';
  const deps = useMemo(
    () => dependenciesOf(model, component.id, { rollup: true }),
    [model, component.id],
  );
  const users = useMemo(
    () => dependentsOf(model, component.id, { rollup: true }),
    [model, component.id],
  );
  const notDrawn = useMemo(
    () =>
      undrawnOn(model, activeDiagramId).filter(
        (r) => r.sourceId === component.id || r.targetId === component.id,
      ),
    [model, activeDiagramId, component.id],
  );
  const twins = useMemo(
    () =>
      (possibleDuplicates(model).find((g) => g.some((c) => c.id === component.id)) ?? []).filter(
        (c) => c.id !== component.id,
      ),
    [model, component.id],
  );
  const linkable = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    return model.components
      .filter(
        (c) =>
          c.id !== component.id &&
          !c.appearances.some((a) => a.diagramId === activeDiagramId) &&
          (!q || c.name.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [model, component.id, activeDiagramId, linkQuery]);

  const elsewhere = component.appearances.filter((a) => a.elementId !== element.id);
  const commitName = () => {
    const next = (drafts.name ?? component.name).trim();
    discard('name');
    if (!next || next === component.name) return;
    const reach = elsewhere.length + (component.detailDiagramId ? 1 : 0);
    void save({ name: next }, reach > 0 ? `Renamed everywhere it appears` : undefined);
  };

  const field =
    'w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none disabled:bg-gray-50';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <select
          aria-label="Kind"
          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600"
          value={component.kind}
          disabled={!canEdit}
          onChange={(e) => void save({ kind: e.target.value })}
        >
          {MODEL_COMPONENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {canEdit && (
          <div className="flex gap-2 text-xs">
            {elsewhere.length > 0 && (
              <button
                type="button"
                className="text-gray-500 hover:text-gray-800"
                title="Make this shape its own component"
                onClick={() => unlinkComponent(element.id)}
              >
                Unlink
              </button>
            )}
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800"
              onClick={() => setLinking((v) => !v)}
              aria-expanded={linking}
            >
              Link to…
            </button>
          </div>
        )}
      </div>

      {linking && (
        <div
          className="rounded border border-blue-100 bg-blue-50/50 p-2"
          data-testid="link-component"
        >
          <input
            autoFocus
            className={field}
            placeholder="Find a component"
            aria-label="Find a component to link to"
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
          />
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {linkable.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full truncate rounded px-1.5 py-1 text-left hover:bg-white"
                  onClick={() => {
                    linkToComponent(element.id, c);
                    setLinking(false);
                  }}
                >
                  {c.name}
                  <span className="ml-1 text-xs text-gray-400">
                    {c.appearances[0]?.path.join(' › ')}
                  </span>
                </button>
              </li>
            ))}
            {linkable.length === 0 && (
              <li className="px-1.5 py-1 text-xs text-gray-400">Nothing to link</li>
            )}
          </ul>
        </div>
      )}

      <input
        aria-label="Component name"
        className={`${field} text-base font-medium`}
        value={valueOf('name')}
        disabled={!canEdit}
        onChange={(e) => draft('name', e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') discard('name');
        }}
      />

      <Section
        title={`Appears in ${component.appearances.length} ${component.appearances.length === 1 ? 'diagram' : 'diagrams'}`}
      >
        <ul data-testid="component-appearances">
          {component.appearances.map((a) => (
            <li key={a.elementId}>
              {a.diagramId === activeDiagramId ? (
                <span className="text-gray-500">{a.path.join(' › ')} (here)</span>
              ) : (
                <button
                  type="button"
                  className="text-left text-blue-600 hover:underline"
                  onClick={() => showAppearance(a.diagramId, a.elementId)}
                >
                  {a.path.join(' › ')}
                </button>
              )}
            </li>
          ))}
          {component.detailDiagramId && (
            <li className="text-xs text-gray-500">Opens into its own diagram</li>
          )}
        </ul>
      </Section>

      {twins.length > 0 && canEdit && (
        <div
          className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
          data-testid="possible-duplicate"
        >
          {twins.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <span>
                Also drawn separately on {t.appearances[0]?.path.join(' › ') ?? 'another diagram'}.
              </span>
              <button
                type="button"
                className="shrink-0 font-medium underline"
                onClick={() => linkToComponent(element.id, t)}
              >
                Same thing? Link
              </button>
            </div>
          ))}
        </div>
      )}

      <Section title="Description">
        <textarea
          aria-label="Description"
          className={`${field} min-h-[56px]`}
          value={valueOf('description')}
          disabled={!canEdit}
          placeholder={canEdit ? 'What it does, who runs it…' : 'No description'}
          onChange={(e) => draft('description', e.target.value)}
          onBlur={() => commit('description')}
        />
      </Section>
      <div className="space-y-3">
        <Section title="Technology">
          <input
            aria-label="Technology"
            className={field}
            value={valueOf('technology')}
            disabled={!canEdit}
            placeholder="e.g. Go, Postgres"
            onChange={(e) => draft('technology', e.target.value)}
            onBlur={() => commit('technology')}
          />
        </Section>
        <Section title="Owner">
          <input
            aria-label="Owner"
            className={field}
            value={valueOf('owner')}
            disabled={!canEdit}
            placeholder="Team"
            onChange={(e) => draft('owner', e.target.value)}
            onBlur={() => commit('owner')}
          />
        </Section>
      </div>

      <Section title="Links">
        <ul className="space-y-0.5">
          {component.links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="flex items-center justify-between gap-2">
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-blue-600 hover:underline"
              >
                {l.label}
              </a>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove link ${l.label}`}
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => void save({ links: component.links.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && component.links.length < 10 && (
          <form
            className="mt-1 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!linkDraft.label.trim() || !/^https?:\/\//i.test(linkDraft.url.trim())) {
                toast('Give the link a name and an http(s) address', 'error');
                return;
              }
              void save({
                links: [
                  ...component.links,
                  { label: linkDraft.label.trim(), url: linkDraft.url.trim() },
                ],
              });
              setLinkDraft({ label: '', url: '' });
            }}
          >
            <input
              aria-label="Link name"
              className={`${field} w-24`}
              placeholder="Runbook"
              value={linkDraft.label}
              onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))}
            />
            <input
              aria-label="Link address"
              className={field}
              placeholder="https://"
              value={linkDraft.url}
              onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value }))}
            />
            <button type="submit" className="rounded bg-gray-100 px-2 text-xs hover:bg-gray-200">
              Add
            </button>
          </form>
        )}
      </Section>

      {component.code && (
        <Section title="Code">
          <code className="text-xs text-gray-700">
            {component.code.repo ? `${component.code.repo}/` : ''}
            {component.code.path || '(repository root)'}
          </code>
        </Section>
      )}

      <Section title="Depends on">
        <DependencyList
          items={deps}
          nameOf={nameOf}
          empty="Nothing recorded"
          testId="component-dependencies"
        />
      </Section>
      <Section title="Used by">
        <DependencyList
          items={users}
          nameOf={nameOf}
          empty="Nothing recorded"
          testId="component-dependents"
        />
      </Section>

      {notDrawn.length > 0 && (
        <Section title="Known connections not drawn here">
          <ul data-testid="not-drawn-here">
            {notDrawn.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {nameOf(r.sourceId)} → {nameOf(r.targetId)}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-blue-600 hover:underline"
                    onClick={() => drawRelationshipHere(r, activeDiagramId, model)}
                  >
                    Draw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function DependencyList({
  items,
  nameOf,
  empty,
  testId,
}: {
  items: ReturnType<typeof dependenciesOf>;
  nameOf: (id: string) => string;
  empty: string;
  testId: string;
}) {
  if (items.length === 0) return <p className="text-xs text-gray-400">{empty}</p>;
  return (
    <ul className="space-y-0.5" data-testid={testId}>
      {items.map((d) => (
        <li key={`${d.relationship.id}`} className="truncate">
          {nameOf(d.componentId)}
          {d.via && <span className="text-xs text-gray-400"> via {nameOf(d.via)}</span>}
          {(d.relationship.technology || d.relationship.labels[0]) && (
            <span className="text-xs text-gray-400">
              {' '}
              · {d.relationship.technology ?? d.relationship.labels[0]}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
