/**
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
  server: {
    label: 'Server',
    paths: [
      'M4 2H20A2 2 0 0 1 22 4V8A2 2 0 0 1 20 10H4A2 2 0 0 1 2 8V4A2 2 0 0 1 4 2Z',
      'M4 14H20A2 2 0 0 1 22 16V20A2 2 0 0 1 20 22H4A2 2 0 0 1 2 20V16A2 2 0 0 1 4 14Z',
      'M6 6L6.01 6',
      'M6 18L6.01 18',
    ],
  },
  database: {
    label: 'Database',
    paths: [
      'M3 5A9 3 0 1 0 21 5A9 3 0 1 0 3 5Z',
      'M3 5V19A9 3 0 0 0 21 19V5',
      'M3 12A9 3 0 0 0 21 12',
    ],
  },
  cloud: { label: 'Cloud', paths: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'] },
  'hard-drive': {
    label: 'Storage',
    paths: [
      'M22 12L2 12',
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      'M6 16L6.01 16',
      'M10 16L10.01 16',
    ],
  },
  container: {
    label: 'Container',
    paths: [
      'M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z',
      'M10 21.9V14L2.1 9.1',
      'm10 14 11.9-6.9',
      'M14 19.8v-8.1',
      'M18 17.5V9.4',
    ],
  },
  cpu: {
    label: 'Compute',
    paths: [
      'M6 4H18A2 2 0 0 1 20 6V18A2 2 0 0 1 18 20H6A2 2 0 0 1 4 18V6A2 2 0 0 1 6 4Z',
      'M10 9H14A1 1 0 0 1 15 10V14A1 1 0 0 1 14 15H10A1 1 0 0 1 9 14V10A1 1 0 0 1 10 9Z',
      'M15 2v2',
      'M15 20v2',
      'M2 15h2',
      'M2 9h2',
      'M20 15h2',
      'M20 9h2',
      'M9 2v2',
      'M9 20v2',
    ],
  },
  globe: {
    label: 'Web',
    paths: [
      'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z',
      'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
      'M2 12h20',
    ],
  },
  shield: {
    label: 'Security',
    paths: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ],
  },
  lock: {
    label: 'Lock',
    paths: [
      'M5 11H19A2 2 0 0 1 21 13V20A2 2 0 0 1 19 22H5A2 2 0 0 1 3 20V13A2 2 0 0 1 5 11Z',
      'M7 11V7a5 5 0 0 1 10 0v4',
    ],
  },
  user: {
    label: 'User',
    paths: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M8 7A4 4 0 1 0 16 7A4 4 0 1 0 8 7Z'],
  },
  users: {
    label: 'Users',
    paths: [
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
      'M5 7A4 4 0 1 0 13 7A4 4 0 1 0 5 7Z',
      'M22 21v-2a4 4 0 0 0-3-3.87',
      'M16 3.13a4 4 0 0 1 0 7.75',
    ],
  },
  smartphone: {
    label: 'Mobile',
    paths: [
      'M7 2H17A2 2 0 0 1 19 4V20A2 2 0 0 1 17 22H7A2 2 0 0 1 5 20V4A2 2 0 0 1 7 2Z',
      'M12 18h.01',
    ],
  },
  monitor: {
    label: 'Desktop',
    paths: [
      'M4 3H20A2 2 0 0 1 22 5V15A2 2 0 0 1 20 17H4A2 2 0 0 1 2 15V5A2 2 0 0 1 4 3Z',
      'M8 21L16 21',
      'M12 17L12 21',
    ],
  },
  laptop: {
    label: 'Laptop',
    paths: [
      'M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16',
    ],
  },
  'app-window': {
    label: 'Web app',
    paths: [
      'M4 4H20A2 2 0 0 1 22 6V18A2 2 0 0 1 20 20H4A2 2 0 0 1 2 18V6A2 2 0 0 1 4 4Z',
      'M10 4v4',
      'M2 8h20',
      'M6 4v4',
    ],
  },
  mail: {
    label: 'Email',
    paths: [
      'M4 4H20A2 2 0 0 1 22 6V18A2 2 0 0 1 20 20H4A2 2 0 0 1 2 18V6A2 2 0 0 1 4 4Z',
      'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7',
    ],
  },
  'message-square': {
    label: 'Chat',
    paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  },
  zap: {
    label: 'Function',
    paths: [
      'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
    ],
  },
  layers: {
    label: 'Layers',
    paths: [
      'm12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
      'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65',
      'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
    ],
  },
  'git-branch': {
    label: 'Branch',
    paths: [
      'M6 3L6 15',
      'M15 6A3 3 0 1 0 21 6A3 3 0 1 0 15 6Z',
      'M3 18A3 3 0 1 0 9 18A3 3 0 1 0 3 18Z',
      'M18 9a9 9 0 0 1-9 9',
    ],
  },
  box: {
    label: 'Component',
    paths: [
      'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
      'm3.3 7 8.7 5 8.7-5',
      'M12 22V12',
    ],
  },
  package: {
    label: 'Package',
    paths: [
      'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
      'M12 22V12',
      'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7',
      'm7.5 4.27 9 5.15',
    ],
  },
  boxes: {
    label: 'Packages',
    paths: [
      'M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z',
      'm7 16.5-4.74-2.85',
      'm7 16.5 5-3',
      'M7 16.5v5.17',
      'M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z',
      'm17 16.5-5-3',
      'm17 16.5 4.74-2.85',
      'M17 16.5v5.17',
      'M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z',
      'M12 8 7.26 5.15',
      'm12 8 4.74-2.85',
      'M12 13.5V8',
    ],
  },
  network: {
    label: 'Network',
    paths: [
      'M17 16H21A1 1 0 0 1 22 17V21A1 1 0 0 1 21 22H17A1 1 0 0 1 16 21V17A1 1 0 0 1 17 16Z',
      'M3 16H7A1 1 0 0 1 8 17V21A1 1 0 0 1 7 22H3A1 1 0 0 1 2 21V17A1 1 0 0 1 3 16Z',
      'M10 2H14A1 1 0 0 1 15 3V7A1 1 0 0 1 14 8H10A1 1 0 0 1 9 7V3A1 1 0 0 1 10 2Z',
      'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3',
      'M12 12V8',
    ],
  },
  router: {
    label: 'Router',
    paths: [
      'M4 14H20A2 2 0 0 1 22 16V20A2 2 0 0 1 20 22H4A2 2 0 0 1 2 20V16A2 2 0 0 1 4 14Z',
      'M6.01 18H6',
      'M10.01 18H10',
      'M15 10v4',
      'M17.84 7.17a4 4 0 0 0-5.66 0',
      'M20.66 4.34a8 8 0 0 0-11.31 0',
    ],
  },
  radio: {
    label: 'Pub/sub',
    paths: [
      'M4.9 19.1C1 15.2 1 8.8 4.9 4.9',
      'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5',
      'M10 12A2 2 0 1 0 14 12A2 2 0 1 0 10 12Z',
      'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5',
      'M19.1 4.9C23 8.8 23 15.1 19.1 19',
    ],
  },
  activity: {
    label: 'Monitoring',
    paths: [
      'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
    ],
  },
  search: { label: 'Search', paths: ['M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11Z', 'm21 21-4.3-4.3'] },
  key: {
    label: 'Secrets',
    paths: [
      'm15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4',
      'm21 2-9.6 9.6',
      'M2 15.5A5.5 5.5 0 1 0 13 15.5A5.5 5.5 0 1 0 2 15.5Z',
    ],
  },
  file: {
    label: 'File',
    paths: [
      'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      'M14 2v4a2 2 0 0 0 2 2h4',
    ],
  },
  folder: {
    label: 'Folder',
    paths: [
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    ],
  },
  archive: {
    label: 'Bucket',
    paths: [
      'M3 3H21A1 1 0 0 1 22 4V7A1 1 0 0 1 21 8H3A1 1 0 0 1 2 7V4A1 1 0 0 1 3 3Z',
      'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8',
      'M10 12h4',
    ],
  },
  'credit-card': {
    label: 'Payments',
    paths: [
      'M4 5H20A2 2 0 0 1 22 7V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V7A2 2 0 0 1 4 5Z',
      'M2 10L22 10',
    ],
  },
  'chart-column': {
    label: 'Analytics',
    paths: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  },
  workflow: {
    label: 'Workflow',
    paths: [
      'M5 3H9A2 2 0 0 1 11 5V9A2 2 0 0 1 9 11H5A2 2 0 0 1 3 9V5A2 2 0 0 1 5 3Z',
      'M7 11v4a2 2 0 0 0 2 2h4',
      'M15 13H19A2 2 0 0 1 21 15V19A2 2 0 0 1 19 21H15A2 2 0 0 1 13 19V15A2 2 0 0 1 15 13Z',
    ],
  },
  cog: {
    label: 'Worker',
    paths: [
      'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
      'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
      'M12 2v2',
      'M12 22v-2',
      'm17 20.66-1-1.73',
      'M11 10.27 7 3.34',
      'm20.66 17-1.73-1',
      'm3.34 7 1.73 1',
      'M14 12h8',
      'M2 12h2',
      'm20.66 7-1.73 1',
      'm3.34 17 1.73-1',
      'm17 3.34-1 1.73',
      'm11 13.73-4 6.93',
    ],
  },
  bell: {
    label: 'Notifications',
    paths: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  },
  scale: {
    label: 'Balancer',
    paths: [
      'm16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
      'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z',
      'M7 21h10',
      'M12 3v18',
      'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
    ],
  },
  'share-2': {
    label: 'Fan-out',
    paths: [
      'M15 5A3 3 0 1 0 21 5A3 3 0 1 0 15 5Z',
      'M3 12A3 3 0 1 0 9 12A3 3 0 1 0 3 12Z',
      'M15 19A3 3 0 1 0 21 19A3 3 0 1 0 15 19Z',
      'M8.59 13.51L15.42 17.49',
      'M15.41 6.51L8.59 10.49',
    ],
  },
  'list-ordered': {
    label: 'Queue',
    paths: [
      'M10 12h11',
      'M10 18h11',
      'M10 6h11',
      'M4 10h2',
      'M4 6h1v4',
      'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
    ],
  },
  'memory-stick': {
    label: 'Cache',
    paths: [
      'M6 19v-3',
      'M10 19v-3',
      'M14 19v-3',
      'M18 19v-3',
      'M8 11V9',
      'M16 11V9',
      'M12 11V9',
      'M2 15h20',
      'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z',
    ],
  },
  timer: {
    label: 'Scheduler',
    paths: ['M10 2L14 2', 'M12 14L15 11', 'M4 14A8 8 0 1 0 20 14A8 8 0 1 0 4 14Z'],
  },
  gauge: { label: 'Metrics', paths: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'] },
  fingerprint: {
    label: 'Identity',
    paths: [
      'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4',
      'M14 13.12c0 2.38 0 6.38-1 8.88',
      'M17.29 21.02c.12-.6.43-2.3.5-3.02',
      'M2 12a10 10 0 0 1 18-6',
      'M2 16h.01',
      'M21.8 16c.2-2 .131-5.354 0-6',
      'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2',
      'M8.65 22c.21-.66.45-1.32.57-2',
      'M9 6.8a6 6 0 0 1 9 5.2v2',
    ],
  },
  webhook: {
    label: 'Webhook',
    paths: [
      'M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2',
      'm6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06',
      'm12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8',
    ],
  },
  'brain-circuit': {
    label: 'Machine learning',
    paths: [
      'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z',
      'M9 13a4.5 4.5 0 0 0 3-4',
      'M6.003 5.125A3 3 0 0 0 6.401 6.5',
      'M3.477 10.896a4 4 0 0 1 .585-.396',
      'M6 18a4 4 0 0 1-1.967-.516',
      'M12 13h4',
      'M12 18h6a2 2 0 0 1 2 2v1',
      'M12 8h8',
      'M16 8V5a2 2 0 0 1 2-2',
      'M15.5 13A0.5 0.5 0 1 0 16.5 13A0.5 0.5 0 1 0 15.5 13Z',
      'M17.5 3A0.5 0.5 0 1 0 18.5 3A0.5 0.5 0 1 0 17.5 3Z',
      'M19.5 21A0.5 0.5 0 1 0 20.5 21A0.5 0.5 0 1 0 19.5 21Z',
      'M19.5 8A0.5 0.5 0 1 0 20.5 8A0.5 0.5 0 1 0 19.5 8Z',
    ],
  },
  bot: {
    label: 'AI agent',
    paths: [
      'M12 8V4H8',
      'M6 8H18A2 2 0 0 1 20 10V18A2 2 0 0 1 18 20H6A2 2 0 0 1 4 18V10A2 2 0 0 1 6 8Z',
      'M2 14h2',
      'M20 14h2',
      'M15 13v2',
      'M9 13v2',
    ],
  },
  'shopping-cart': {
    label: 'Shop',
    paths: [
      'M7 21A1 1 0 1 0 9 21A1 1 0 1 0 7 21Z',
      'M18 21A1 1 0 1 0 20 21A1 1 0 1 0 18 21Z',
      'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
    ],
  },
  warehouse: {
    label: 'Warehouse',
    paths: [
      'M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z',
      'M6 18h12',
      'M6 14h12',
      'M6 10H18V22H6Z',
    ],
  },
  'radio-tower': {
    label: 'Broadcast',
    paths: [
      'M4.9 16.1C1 12.2 1 5.8 4.9 1.9',
      'M7.8 4.7a6.14 6.14 0 0 0-.8 7.5',
      'M10 9A2 2 0 1 0 14 9A2 2 0 1 0 10 9Z',
      'M16.2 4.8c2 2 2.26 5.11.8 7.47',
      'M19.1 1.9a9.96 9.96 0 0 1 0 14.1',
      'M9.5 18h5',
      'm8 22 4-11 4 11',
    ],
  },
  image: {
    label: 'Images',
    paths: [
      'M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3Z',
      'M7 9A2 2 0 1 0 11 9A2 2 0 1 0 7 9Z',
      'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
    ],
  },
  video: {
    label: 'Video',
    paths: [
      'm16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5',
      'M4 6H14A2 2 0 0 1 16 8V16A2 2 0 0 1 14 18H4A2 2 0 0 1 2 16V8A2 2 0 0 1 4 6Z',
    ],
  },
  inbox: {
    label: 'Inbox',
    paths: [
      'M22 12L16 12L14 15L10 15L8 12L2 12',
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    ],
  },
  send: {
    label: 'Send',
    paths: [
      'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
      'm21.854 2.147-10.94 10.939',
    ],
  },
  split: {
    label: 'Router',
    paths: ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6'],
  },
  filter: { label: 'Filter', paths: ['M22 3L2 3L10 12.46L10 19L14 21L14 12.46L22 3Z'] },
  landmark: {
    label: 'Bank',
    paths: [
      'M3 22L21 22',
      'M6 18L6 11',
      'M10 18L10 11',
      'M14 18L14 11',
      'M18 18L18 11',
      'M12 2L20 7L4 7Z',
    ],
  },
  'building-2': {
    label: 'Organisation',
    paths: [
      'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z',
      'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
      'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
      'M10 6h4',
      'M10 10h4',
      'M10 14h4',
      'M10 18h4',
    ],
  },
  earth: {
    label: 'Global',
    paths: [
      'M21.54 15H17a2 2 0 0 0-2 2v4.54',
      'M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17',
      'M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05',
      'M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z',
    ],
  },
  'file-text': {
    label: 'Document',
    paths: [
      'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      'M14 2v4a2 2 0 0 0 2 2h4',
      'M10 9H8',
      'M16 13H8',
      'M16 17H8',
    ],
  },
  'calendar-clock': {
    label: 'Cron',
    paths: [
      'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5',
      'M16 2v4',
      'M8 2v4',
      'M3 10h5',
      'M17.5 17.5 16 16.3V14',
      'M10 16A6 6 0 1 0 22 16A6 6 0 1 0 10 16Z',
    ],
  },
  'arrow-right-left': {
    label: 'Gateway',
    paths: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  },
  'id-card': {
    label: 'Directory',
    paths: [
      'M16 10h2',
      'M16 14h2',
      'M6.17 15a3 3 0 0 1 5.66 0',
      'M7 11A2 2 0 1 0 11 11A2 2 0 1 0 7 11Z',
      'M4 5H20A2 2 0 0 1 22 7V17A2 2 0 0 1 20 19H4A2 2 0 0 1 2 17V7A2 2 0 0 1 4 5Z',
    ],
  },
};
