export type SearchResultKind =
  | 'navigation'
  | 'settings'
  | 'aircraft'
  | 'task'
  | 'program'
  | 'package'
  | 'component';

export interface GlobalSearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  tab: string;
  recordId?: string;
  settingsSection?: string;
  score: number;
}

export interface SearchRecordLike {
  id: string;
  kind?: string;
  code?: string;
  revision?: string;
  data?: {
    name?: string;
    model?: string;
    manufacturer?: string;
    msn?: string;
    reference?: string;
    aircraftId?: string;
    title?: string;
    sourceReference?: string;
    station?: string;
    partNumber?: string;
    serialNumber?: string;
  };
}

export interface SearchWorkspaceInput {
  query: string;
  aircraft?: SearchRecordLike[];
  tasks?: SearchRecordLike[];
  programs?: SearchRecordLike[];
  planningItems?: SearchRecordLike[];
  navigationItems?: Array<{ key: string; label: string }>;
  settingsItems?: Array<{ id: string; title: string; description?: string }>;
  limit?: number;
}

function matchScore(haystack: string, needle: string, primaryText = ''): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const p = primaryText.toLowerCase();
  if (p === needle) return 100;
  if (p.startsWith(needle)) return 85;
  if (p.includes(needle)) return 70;
  if (h.includes(needle)) return 50;
  return 0;
}

export function searchWorkspace(input: SearchWorkspaceInput): GlobalSearchResult[] {
  const needle = String(input.query || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(30, input.limit ?? 15));
  const results: GlobalSearchResult[] = [];
  const planeNames = new Map<string, string>(
    (input.aircraft || []).map((a) => [a.id, String(a.data?.name || '')])
  );

  for (const nav of input.navigationItems || []) {
    const score = needle ? matchScore(nav.label + ' ' + nav.key, needle, nav.label) : 10;
    if (score > 0) {
      results.push({
        id: 'nav:' + nav.key,
        kind: 'navigation',
        title: nav.label,
        subtitle: 'انتقال إلى الشاشة',
        tab: nav.key,
        score,
      });
    }
  }

  for (const sec of input.settingsItems || []) {
    const score = needle
      ? matchScore(`${sec.title} ${sec.description || ''}`, needle, sec.title)
      : 5;
    if (score > 0) {
      results.push({
        id: 'settings:' + sec.id,
        kind: 'settings',
        title: sec.title,
        subtitle: 'الإعدادات',
        tab: 'settings',
        settingsSection: sec.id,
        score,
      });
    }
  }

  if (needle) {
    for (const a of input.aircraft || []) {
      const name = String(a.data?.name || '');
      const text = [name, a.data?.model, a.data?.manufacturer, a.data?.msn].filter(Boolean).join(' ');
      const score = matchScore(text, needle, name);
      if (score > 0) {
        results.push({
          id: 'aircraft:' + a.id,
          kind: 'aircraft',
          title: name || 'طائرة',
          subtitle:
            [a.data?.manufacturer, a.data?.model, a.data?.msn ? `MSN ${a.data.msn}` : '']
              .filter(Boolean)
              .join(' · ') || 'الأسطول',
          tab: 'aircraft',
          recordId: a.id,
          score: score + 10,
        });
      }
    }

    for (const t of input.tasks || []) {
      const title = String(t.data?.name || '');
      const ref = String(t.data?.reference || '');
      const plane = (t.data?.aircraftId ? planeNames.get(t.data.aircraftId) : '') || '';
      const score = matchScore(`${title} ${ref} ${plane}`, needle, `${title} ${ref}`);
      if (score > 0) {
        results.push({
          id: 'task:' + t.id,
          kind: 'task',
          title: title || 'مهمة صيانة',
          subtitle: [plane, ref].filter(Boolean).join(' · ') || 'خطة الصيانة',
          tab: 'task',
          recordId: t.id,
          score: score + 8,
        });
      }
    }

    for (const p of input.programs || []) {
      const code = `${p.code || ''} / Rev ${p.revision || ''}`.trim();
      const title = String(p.data?.title || code);
      const score = matchScore(`${code} ${title} ${p.data?.sourceReference || ''}`, needle, code);
      if (score > 0) {
        results.push({
          id: 'program:' + p.id,
          kind: 'program',
          title: code || title,
          subtitle: title !== code ? title : 'برنامج الصيانة',
          tab: 'program',
          recordId: p.id,
          score,
        });
      }
    }

    for (const item of input.planningItems || []) {
      if (item.kind !== 'package' && item.kind !== 'component') continue;
      const title = String(item.data?.name || item.code || '');
      const sub =
        item.kind === 'package'
          ? [item.code, item.data?.aircraftId ? planeNames.get(item.data.aircraftId) : '', item.data?.station]
              .filter(Boolean)
              .join(' · ')
          : [
              item.data?.partNumber ? `PN ${item.data.partNumber}` : '',
              item.data?.serialNumber ? `SN ${item.data.serialNumber}` : '',
            ]
              .filter(Boolean)
              .join(' · ');
      const score = matchScore(`${title} ${item.code || ''} ${sub}`, needle, `${item.code || ''} ${title}`);
      if (score > 0) {
        results.push({
          id: `${item.kind}:${item.id}`,
          kind: item.kind,
          title: item.kind === 'package' ? `${item.code} — ${title}` : title,
          subtitle: sub || (item.kind === 'package' ? 'حزمة عمل' : 'مكوّن'),
          tab: item.kind === 'package' ? 'packages' : 'components',
          recordId: item.id,
          score,
        });
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ar'))
    .slice(0, limit);
}
