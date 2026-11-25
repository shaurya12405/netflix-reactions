import { describe, expect, it } from 'vitest';
import { parseNetflixVideoId } from '../../src/adapters/netflix';

describe('parseNetflixVideoId', () => {
  it.each([
    ['https://www.netflix.com/watch/80100172', '80100172'],
    ['https://www.netflix.com/watch/80100172?trackId=1234&tctx=0', '80100172'],
    ['https://www.netflix.com/watch/80100172/', '80100172'],
    ['https://www.netflix.com/watch/80100172#t', '80100172'],
    ['https://netflix.com/watch/42', '42'],
  ])('%s -> %s', (url, id) => {
    expect(parseNetflixVideoId(url)).toBe(id);
  });

  it.each([
    'https://www.netflix.com/browse',
    'https://www.netflix.com/title/80100172',
    'https://www.netflix.com/watch/',
    'https://www.netflix.com/watch/abc',
    'https://www.netflix.com/watch/123abc',
    'https://evil.example/watch/80100172',
    'https://netflix.com.evil.example/watch/1',
    'not a url',
  ])('rejects %s', (url) => {
    expect(parseNetflixVideoId(url)).toBeNull();
  });
});
