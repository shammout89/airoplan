import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftDateInputError, aircraftDateInputValue } from './aircraft-date-input';

test('aircraftDateInputError blocks overlong years and invalid calendar dates regardless of allowFuture', () => {
  for (const allowFuture of [false, true]) {
    assert.notEqual(aircraftDateInputError('202700-02-19', false, allowFuture), '');
    assert.notEqual(aircraftDateInputError('2027-02-29', false, allowFuture), '');
    assert.notEqual(aircraftDateInputError('2027-04-31', false, allowFuture), '');
    assert.notEqual(aircraftDateInputError('1899-12-31', false, allowFuture), '');
    assert.equal(aircraftDateInputError('', false, allowFuture), '');
    assert.equal(aircraftDateInputError('2024-02-29', false, allowFuture), '');
  }
});

test('aircraftDateInputError enforces future restriction only when allowFuture is false', () => {
  assert.notEqual(aircraftDateInputError('2099-02-19', false, false), '');
  assert.equal(aircraftDateInputError('2099-02-19', false, true), '');
  assert.equal(aircraftDateInputError('2027-02-19', false, true), '');
  assert.equal(aircraftDateInputError('9999-12-31', false, true), '');
});

test('aircraftDateInputValue formats date and datetime values cleanly', () => {
  assert.equal(aircraftDateInputValue('2027-02-19', false), '2027-02-19');
  assert.equal(aircraftDateInputValue('2027-02-19T10:30:00.000Z', true), '2027-02-19T10:30');
});
