import { describe, expect, it } from 'vitest';
import {
  bestMatch,
  classifyScore,
  MATCH_CONFIDENT,
  normalizeGameName,
  similarity,
} from '@meeple/shared';

describe('normalizeGameName', () => {
  it('lowercases and strips a trailing year', () => {
    expect(normalizeGameName('Catan (1995)')).toBe('catan');
    expect(normalizeGameName('CATAN')).toBe('catan');
  });

  it('strips edition noise and punctuation', () => {
    expect(normalizeGameName('Ticket to Ride: Europe')).toBe('ticket to ride europe');
    expect(normalizeGameName('Pandemic — The Cure')).toBe('pandemic cure');
  });
});

describe('similarity', () => {
  it('scores normalised-equal names as identical', () => {
    expect(similarity('Catan (1995)', 'CATAN')).toBe(1);
  });

  it('scores unrelated names low', () => {
    expect(classifyScore(similarity('Wingspan', 'Azul'))).toBe('none');
  });

  it('treats close variants as at least worth a look', () => {
    expect(classifyScore(similarity('Ticket to Ride', 'Ticket to Ride: Europe'))).not.toBe('none');
  });

  it('puts genuinely similar-but-different names in the ambiguous band', () => {
    expect(classifyScore(similarity('Splendor', 'Splendid'))).toBe('ambiguous');
  });
});

describe('bestMatch', () => {
  const games = [{ name: 'Catan' }, { name: 'Wingspan' }, { name: 'Azul' }];

  it('picks the closest candidate', () => {
    const match = bestMatch('CATAN', games);
    expect(match?.candidate.name).toBe('Catan');
    expect(match?.score).toBeGreaterThanOrEqual(MATCH_CONFIDENT);
  });

  it('also compares against a stored BGG name', () => {
    const match = bestMatch('Wingspan', [{ name: 'Birds', bggName: 'Wingspan' }]);
    expect(match?.candidate.name).toBe('Birds');
    expect(match?.score).toBe(1);
  });
});
