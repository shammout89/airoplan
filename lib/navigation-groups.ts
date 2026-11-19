export interface NavigationGroup {
  id: string;
  title: string;
  keys: string[];
}

const GROUP_SPECS: Array<{ id: string; title: string; keys: string[] }> = [
  {
    id: 'daily',
    title: 'التشغيل اليومي',
    keys: ['dashboard', 'aircraft', 'usage'],
  },
  {
    id: 'planning',
    title: 'التخطيط والجدولة',
    keys: ['task', 'program', 'forecast', 'packages', 'resources'],
  },
  {
    id: 'engineering',
    title: 'الهندسة والمكونات',
    keys: ['components', 'powerunits', 'defects', 'technical'],
  },
  {
    id: 'execution',
    title: 'التنفيذ والجودة والمخزون',
    keys: ['execution', 'corrections', 'acceptance', 'inventory', 'documents'],
  },
  {
    id: 'governance',
    title: 'المتابعة والإعدادات',
    keys: ['insights', 'reliability', 'notifications', 'services', 'imports', 'settings'],
  },
];

export function groupForTab(tab: string): string {
  for (const group of GROUP_SPECS) {
    if (group.keys.includes(tab)) return group.id;
  }
  return 'daily';
}

export function groupNavigation(permittedKeys: string[]): NavigationGroup[] {
  const allowed = new Set(permittedKeys);
  const assigned = new Set<string>();
  const groups: NavigationGroup[] = [];

  for (const spec of GROUP_SPECS) {
    const keys = spec.keys.filter((k) => {
      if (!allowed.has(k)) return false;
      assigned.add(k);
      return true;
    });
    if (keys.length) {
      groups.push({ id: spec.id, title: spec.title, keys });
    }
  }

  const remaining = permittedKeys.filter((k) => !assigned.has(k));
  if (remaining.length) {
    groups.push({ id: 'other', title: 'أقسام أخرى', keys: remaining });
  }

  return groups;
}
