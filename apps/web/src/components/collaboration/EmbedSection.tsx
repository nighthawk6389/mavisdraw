import { useEffect, useState } from 'react';
import {
  apiGetEmbed,
  apiGetProject,
  apiPublishEmbed,
  apiUnpublishEmbed,
  type EmbedInfo,
} from '../../services/api';
import { API_BASE } from '../../services/apiBase';
import { toast } from '../../stores/toastStore';
import { embedSnippets } from './embedSnippets';

type Tab = 'iframe' | 'readme' | 'link';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  {
    id: 'iframe',
    label: 'Website / docs',
    hint: 'Interactive: readers click into nested systems.',
  },
  {
    id: 'readme',
    label: 'GitHub README',
    hint: 'An image that updates as the map changes (light and dark).',
  },
  { id: 'link', label: 'Link', hint: 'The read-only viewer on its own.' },
];

/**
 * Publish the map read-only, for anyone with the link: an iframe that can
 * be drilled into, and a README image that stays current.
 */
export default function EmbedSection({ projectId }: { projectId: string }) {
  const [embed, setEmbed] = useState<EmbedInfo | null | undefined>(undefined);
  const [projectName, setProjectName] = useState('Project');
  const [tab, setTab] = useState<Tab>('iframe');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGetEmbed(projectId), apiGetProject(projectId)])
      .then(([{ embed }, { project }]) => {
        if (cancelled) return;
        setEmbed(embed);
        setProjectName(project.name);
      })
      .catch(() => {
        if (!cancelled) setEmbed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const publish = (rotate: boolean) =>
    run(async () => {
      const { embed } = await apiPublishEmbed(projectId, rotate);
      setEmbed(embed);
      if (rotate) toast('New embed link: the old one no longer works', 'success');
    });

  const unpublish = () =>
    run(async () => {
      await apiUnpublishEmbed(projectId);
      setEmbed(null);
      toast('Unpublished: embeds and README images stop working', 'success');
    });

  if (embed === undefined) return null;

  if (!embed) {
    return (
      <div>
        <h4 className="mb-1 text-sm font-medium text-gray-700">Embed</h4>
        <p className="mb-2 text-xs text-gray-500">
          Show this map in docs, wikis or a GitHub README, read-only and always current.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void publish(false)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Publish an embed
        </button>
      </div>
    );
  }

  const snippets = embedSnippets(window.location.origin, API_BASE, embed.token, projectName);
  const text =
    tab === 'iframe'
      ? snippets.iframe
      : tab === 'readme'
        ? snippets.readmeHtml
        : snippets.viewerUrl;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', 'success');
    } catch {
      toast("Couldn't copy: select the text and copy it instead", 'error');
    }
  };

  return (
    <div data-testid="embed-section">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">Embed</h4>
        <a
          href={snippets.viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          Preview ↗
        </a>
      </div>
      <p className="mb-2 text-xs text-amber-700">
        Published: anyone with the link can view every level of this map.
      </p>
      <div
        className="mb-2 flex overflow-hidden rounded border border-gray-300 text-xs"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-1 ${tab === t.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-1 text-xs text-gray-500">{TABS.find((t) => t.id === tab)!.hint}</p>
      <pre
        data-testid="embed-snippet"
        className="mb-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-100"
      >
        {text}
      </pre>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700"
        >
          Copy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void publish(true)}
          className="text-gray-600 hover:text-gray-800 disabled:opacity-50"
          title="Make a new link; the current one stops working"
        >
          New link
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void unpublish()}
          className="text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          Unpublish
        </button>
      </div>
    </div>
  );
}
