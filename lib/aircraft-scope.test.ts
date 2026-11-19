import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AIRCRAFT_SCOPE,
  describeAircraftScope,
  extractScopedAircraftIds,
  hasRestrictedAircraftScope,
  isAircraftInScope,
  normalizeAircraftScope,
  normalizeModelKey,
  requireAircraftInScope,
} from './aircraft-scope';

const fleet = [
  { id: 'ac-1', name: 'JY-BAA', model: 'A320' },
  { id: 'ac-2', name: 'JY-BAB', model: 'a320 ' },
  { id: 'ac-3', name: 'JY-B73', model: 'B737-800' },
];

test('normalizeModelKey normalizes whitespace and casing', () => {
  assert.equal(normalizeModelKey('  a320  neo '), 'A320 NEO');
  assert.equal(normalizeModelKey(null), '');
});

test('normalizeAircraftScope defaults to all and clears restricted fields', () => {
  assert.deepEqual(normalizeAircraftScope({}, fleet), DEFAULT_AIRCRAFT_SCOPE);
  assert.deepEqual(
    normalizeAircraftScope(
      { aircraftScopeMode: 'all', aircraftIds: ['ac-1'], aircraftModels: ['A320'] },
      fleet
    ),
    DEFAULT_AIRCRAFT_SCOPE
  );
});

test('normalizeAircraftScope validates restricted mode, registered aircraft IDs, and deduplicated models', () => {
  assert.throws(
    () => normalizeAircraftScope({ aircraftScopeMode: 'restricted' }, fleet),
    /اختر طائرة واحدة أو طرازًا واحدًا/
  );
  assert.throws(
    () =>
      normalizeAircraftScope(
        { aircraftScopeMode: 'restricted', aircraftIds: ['ac-unknown'] },
        fleet
      ),
    /غير مسجلة/
  );
  assert.throws(
    () => normalizeAircraftScope({ aircraftScopeMode: 'invalid' }, fleet),
    /وضع نطاق الطائرات غير صالح/
  );

  const normalized = normalizeAircraftScope(
    {
      aircraftScopeMode: 'restricted',
      aircraftIds: ['ac-3', 'ac-3'],
      aircraftModels: [' a320 ', 'A320', ''],
    },
    fleet
  );
  assert.deepEqual(normalized, {
    mode: 'restricted',
    aircraftIds: ['ac-3'],
    models: ['A320'],
  });
  assert.equal(hasRestrictedAircraftScope(normalized), true);
  assert.equal(hasRestrictedAircraftScope(DEFAULT_AIRCRAFT_SCOPE), false);
});

test('isAircraftInScope matches by aircraft ID or normalized model and blocks others', () => {
  const scope = { mode: 'restricted' as const, aircraftIds: ['ac-3'], models: ['A320'] };
  assert.equal(isAircraftInScope(scope, { id: 'ac-1', model: 'a320' }), true);
  assert.equal(isAircraftInScope(scope, { id: 'ac-2', type: 'A320' }), true);
  assert.equal(isAircraftInScope(scope, { id: 'ac-3', model: 'B737-800' }), true);
  assert.equal(isAircraftInScope(scope, { id: 'ac-4', model: 'B787-9' }), false);
  assert.equal(isAircraftInScope(scope, null), false);
  assert.equal(isAircraftInScope(DEFAULT_AIRCRAFT_SCOPE, null), true);
});

test('requireAircraftInScope enforces 403 AccessError for restricted members and bypasses for owner', () => {
  const scope = { mode: 'restricted' as const, aircraftIds: ['ac-1'], models: [] };

  assert.doesNotThrow(() =>
    requireAircraftInScope({ isOwner: true, aircraftScope: scope }, { id: 'ac-3', model: 'B737-800' })
  );
  assert.doesNotThrow(() =>
    requireAircraftInScope({ isOwner: false, aircraftScope: scope }, { id: 'ac-1', model: 'A320' })
  );
  assert.throws(
    () =>
      requireAircraftInScope(
        { isOwner: false, aircraftScope: scope },
        { id: 'ac-3', model: 'B737-800' }
      ),
    (err: any) => err?.status === 403 && /ليس لديك صلاحية/.test(err.message)
  );
});

test('extractScopedAircraftIds and describeAircraftScope format Arabic summaries accurately', () => {
  const scope = {
    mode: 'restricted' as const,
    aircraftIds: ['ac-1', 'ac-2', 'ac-3', 'ac-4'],
    models: ['A320', 'B737-800'],
  };
  const set = extractScopedAircraftIds(
    { mode: 'restricted', aircraftIds: ['ac-3'], models: ['A320'] },
    fleet
  );
  assert.deepEqual([...set].sort(), ['ac-1', 'ac-2', 'ac-3']);
  assert.equal(describeAircraftScope(DEFAULT_AIRCRAFT_SCOPE, fleet), 'جميع طائرات الأسطول');
  const desc = describeAircraftScope(scope, fleet);
  assert.match(desc, /^مقيّد \(/);
  assert.match(desc, /JY-BAA/);
  assert.match(desc, /\(\+1\)/);
  assert.match(desc, /طرز: A320، B737-800/);
});
