// Turns selected Lucide icons (ISC) into path data: node make-icons.mjs <lucide dir> <out.ts>
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [dir, out] = process.argv.slice(2);
const ICONS = {
  server: 'Server', database: 'Database', cloud: 'Cloud', 'hard-drive': 'Storage', container: 'Container',
  cpu: 'Compute', globe: 'Web', shield: 'Security', lock: 'Lock', user: 'User', users: 'Users',
  smartphone: 'Mobile', monitor: 'Desktop', laptop: 'Laptop', 'app-window': 'Web app', mail: 'Email',
  'message-square': 'Chat', zap: 'Function', layers: 'Layers', 'git-branch': 'Branch', box: 'Component',
  package: 'Package', boxes: 'Packages', network: 'Network', router: 'Router', radio: 'Pub/sub',
  activity: 'Monitoring', search: 'Search', key: 'Secrets', file: 'File', folder: 'Folder',
  archive: 'Bucket', 'credit-card': 'Payments', 'chart-column': 'Analytics', workflow: 'Workflow',
  cog: 'Worker', bell: 'Notifications', scale: 'Balancer', 'share-2': 'Fan-out', 'list-ordered': 'Queue',
  'memory-stick': 'Cache', timer: 'Scheduler', gauge: 'Metrics', fingerprint: 'Identity', webhook: 'Webhook',
  'brain-circuit': 'Machine learning', bot: 'AI agent', 'shopping-cart': 'Shop', warehouse: 'Warehouse',
  'radio-tower': 'Broadcast', image: 'Images', video: 'Video', inbox: 'Inbox', send: 'Send',
  split: 'Router', filter: 'Filter', landmark: 'Bank', 'building-2': 'Organisation', earth: 'Global',
  'file-text': 'Document', 'calendar-clock': 'Cron', 'arrow-right-left': 'Gateway', 'id-card': 'Directory',
};
const n = (v) => Number(v ?? 0);
const fmt = (v) => String(Math.round(v * 1000) / 1000);
function toPath([tag, a]) {
  switch (tag) {
    case 'path': return a.d;
    case 'line': return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case 'polyline': case 'polygon': {
      const pts = a.points.trim().split(/[\s,]+/).map(Number);
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    case 'circle': case 'ellipse': {
      const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx ?? a.r), ry = n(a.ry ?? a.r);
      return `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
    }
    case 'rect': {
      const x = n(a.x), y = n(a.y), w = n(a.width), h = n(a.height);
      const r = Math.min(n(a.rx ?? a.ry), w / 2, h / 2);
      if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${fmt(x + r)} ${y}H${fmt(x + w - r)}A${r} ${r} 0 0 1 ${x + w} ${fmt(y + r)}V${fmt(y + h - r)}A${r} ${r} 0 0 1 ${fmt(x + w - r)} ${y + h}H${fmt(x + r)}A${r} ${r} 0 0 1 ${x} ${fmt(y + h - r)}V${fmt(y + r)}A${r} ${r} 0 0 1 ${fmt(x + r)} ${y}Z`;
    }
    default: throw new Error(`unknown node ${tag}`);
  }
}
const entries = [];
for (const [id, label] of Object.entries(ICONS)) {
  const mod = await import(pathToFileURL(`${dir}/dist/esm/icons/${id}.js`).href);
  const [, , nodes] = mod.default;
  entries.push(`  '${id}': { label: ${JSON.stringify(label)}, paths: ${JSON.stringify(nodes.map(toPath))} },`);
}
writeFileSync(out, `/**
 * Icons drawn inside shapes (24×24, stroked, round caps and joins), as SVG
 * path data so the canvas, SVG exports, embeds and the server draw them
 * the same way.
 *
 * From Lucide v0.460.0 (https://lucide.dev), ISC License:
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Generated from the Lucide package: to add one, add its Lucide name here
 * with a label, and its path data (each element converted to a path).
 */

export interface IconDefinition {
  /** What it stands for, in the icon picker. */
  label: string;
  /** SVG path data in a 24×24 box. */
  paths: string[];
}

export const ICONS: Record<string, IconDefinition> = {
${entries.join('\n')}
};
`);
console.log(`${entries.length} icons`);
