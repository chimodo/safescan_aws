import { describe, it, expect } from 'vitest';
import { aggregateResults } from '../../utils/scorer';

describe('utils/scorer (stub)', () => {
  it('aggregates empty checks', () => {
    const res = aggregateResults([] as any);
    expect(res).toHaveProperty('verdict');
    expect(res).toHaveProperty('score');
  });
});
