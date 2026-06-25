import assert from 'node:assert/strict';
import {
  createQqMusicCookieHeaders,
  normalizeQqMusicCookie,
  QQ_MUSIC_COOKIE_HEADER,
} from './qqMusicCookie';

assert.equal(normalizeQqMusicCookie('  sample_cookie=placeholder;; \n sample_uin=0;  '), 'sample_cookie=placeholder; sample_uin=0');
assert.deepEqual(createQqMusicCookieHeaders(''), {});
assert.deepEqual(createQqMusicCookieHeaders('sample_cookie=placeholder;\n sample_uin=0;'), {
  [QQ_MUSIC_COOKIE_HEADER]: 'sample_cookie=placeholder; sample_uin=0',
});

console.log('qqMusicCookie tests passed');

