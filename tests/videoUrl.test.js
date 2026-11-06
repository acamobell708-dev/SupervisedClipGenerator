import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeVideoId, watchUrl} from '../src/domain/videoUrl.js';

const id='dQw4w9WgXcQ';
test('accepts supported YouTube URLs, query strings and a bare ID', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${id}&feature=share`,
    `https://m.youtube.com/watch?list=abc&v=${id}`,
    `https://youtu.be/${id}?si=extra`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    id,
  ]) assert.equal(parseYouTubeVideoId(url), id, url);
});
test('rejects non-YouTube hosts, malformed ids and bad protocols', () => {
  for (const url of [
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/shorts/dQw4w9WgXcQ',
    'file:///dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=123',
    'https://www.youtube.com/playlist?list=123',
    '',
  ]) assert.throws(() => parseYouTubeVideoId(url), {code:'INVALID_URL'});
});
test('creates canonical timestamp link', () => assert.equal(watchUrl(id, 75.6),`https://www.youtube.com/watch?v=${id}&t=75s`));
