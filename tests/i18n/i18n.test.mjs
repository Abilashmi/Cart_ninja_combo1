// Run with: node --test tests/i18n
// The shared message helper, locale resolution and fallback chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createI18n, formatMessage, placeholders, createTranslator, normalizeLocale, pickLocale, localeChain, isRtl, hashText,
} from '../../app/i18n/i18n.shared.js';

test('substitution: values go in, missing variables print nothing, never "undefined"', () => {
  assert.equal(formatMessage('Hello {name}!', { name: 'Asha' }), 'Hello Asha!');
  assert.equal(formatMessage('Hello {name}!', {}), 'Hello !');
  assert.equal(formatMessage('Hello {name}!'), 'Hello !');
  assert.equal(formatMessage('{n} left', { n: 0 }), '0 left');
  assert.ok(!String(formatMessage('{a}{b}', { a: null })).includes('undefined'));
});

test('values are inserted as text, not interpreted', () => {
  assert.equal(formatMessage('Hi {name}', { name: '{count, plural, other {x}}' }), 'Hi {count, plural, other {x}}');
  assert.equal(formatMessage('Hi {name}', { name: "<b>'}" }), "Hi <b>'}");
});

test('quote before a brace gives a literal brace', () => {
  assert.equal(formatMessage("Use '{name'} here", { name: 'x' }), 'Use {name} here');
  assert.equal(formatMessage("It's fine"), "It's fine");
});

test('malformed messages return null and never throw', () => {
  for (const bad of ['Hi {name', 'Hi }', '{n, plural, one {x}}', '{n, select, a {x} other {y}}', '{n, plural, many2 {x} other {y}}', '{1bad}', '{n, plural, other {x} other {y}}']) {
    assert.equal(formatMessage(bad, { n: 1 }), null, bad);
  }
  assert.equal(formatMessage(undefined), null);
  assert.equal(formatMessage(42), null);
});

test('plurals: English, Spanish, Tamil, Hindi', () => {
  const m = '{count, plural, one {# item} other {# items}}';
  assert.equal(formatMessage(m, { count: 1 }, 'en'), '1 item');
  assert.equal(formatMessage(m, { count: 2 }, 'en'), '2 items');
  assert.equal(formatMessage(m, { count: 0 }, 'en'), '0 items');
  assert.equal(formatMessage(m, { count: 1 }, 'es'), '1 item');
  assert.equal(formatMessage(m, { count: 5 }, 'ta'), '5 items');
  assert.equal(formatMessage(m, { count: 1 }, 'hi'), '1 item');
});

test('plurals: Arabic uses all six categories', () => {
  const m = '{count, plural, zero {Z#} one {O#} two {T#} few {F#} many {M#} other {X#}}';
  const f = (n) => formatMessage(m, { count: n }, 'ar');
  assert.equal(f(0), 'Z0');
  assert.equal(f(1), 'O1');
  assert.equal(f(2), 'T2');
  assert.equal(f(3), 'F3');
  assert.equal(f(11), 'M11');
  assert.equal(f(100), 'X100');
});

test('plural: exact =N, non-number falls to other, # prints the number', () => {
  const m = '{count, plural, =0 {none} one {# thing} other {# things}}';
  assert.equal(formatMessage(m, { count: 0 }, 'en'), 'none');
  assert.equal(formatMessage(m, { count: 1 }, 'en'), '1 thing');
  assert.equal(formatMessage(m, { count: 'abc' }, 'en'), ' things');
  assert.equal(formatMessage(m, {}, 'en'), ' things');
  assert.equal(formatMessage('Item # costs {p}', { p: 5 }), 'Item # costs 5', '# outside a plural stays a #');
});

test('plural works without Intl.PluralRules (falls back to other)', () => {
  const original = Intl.PluralRules;
  Intl.PluralRules = undefined;
  try {
    const t = createI18n();
    assert.equal(t.formatMessage('{count, plural, one {# item} other {# items}}', { count: 1 }, 'en'), '1 items');
  } finally {
    Intl.PluralRules = original;
  }
});

test('placeholders lists variable names, plural variable included, null when malformed', () => {
  assert.deepEqual(placeholders('{title} is sold out.'), ['title']);
  assert.deepEqual(placeholders('{count, plural, one {# of {total}} other {#}}'), ['count', 'total']);
  assert.deepEqual(placeholders('No variables'), []);
  assert.equal(placeholders('{oops'), null);
});

test('translator walks the chain and ends at the key, never blank', () => {
  const t = createTranslator([{ a: 'Hola {n}' , bad: '{oops' }, { a: 'Hello {n}', b: 'Only English', bad: 'Fallback ok' }], 'es');
  assert.equal(t('a', { n: 1 }), 'Hola 1');
  assert.equal(t('b'), 'Only English');
  assert.equal(t('bad'), 'Fallback ok', 'a broken message falls through to the next catalogue');
  assert.equal(t('nope.key'), 'nope.key');
  assert.equal(createTranslator(null)('x'), 'x');
});

test('normalizeLocale', () => {
  assert.equal(normalizeLocale('pt_br'), 'pt-BR');
  assert.equal(normalizeLocale('ES'), 'es');
  assert.equal(normalizeLocale('pt'), 'pt-BR');
  assert.equal(normalizeLocale('zh-cn'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en-US');
  assert.equal(normalizeLocale('zh-hans-cn'), 'zh-Hans-CN');
  for (const junk of ['', null, undefined, 42, '??', 'english', 'e']) assert.equal(normalizeLocale(junk), '', String(junk));
});

test('pickLocale: Liquid first, then Shopify.locale, then <html lang>', () => {
  assert.equal(pickLocale({ liquid: 'ta', shopify: 'en', htmlLang: 'hi' }), 'ta');
  assert.equal(pickLocale({ liquid: '', shopify: 'es-MX', htmlLang: 'hi' }), 'es-MX');
  assert.equal(pickLocale({ liquid: null, shopify: undefined, htmlLang: 'ar' }), 'ar');
  assert.equal(pickLocale({ liquid: '??', htmlLang: 'hi' }), 'hi');
  assert.equal(pickLocale({}), '');
  assert.equal(pickLocale(), '');
});

test('localeChain: exact, base language, shop primary, English; only supported locales', () => {
  const have = ['en', 'hi', 'ta', 'es', 'ar'];
  assert.deepEqual(localeChain('es-MX', have, 'ta'), ['es', 'ta', 'en']);
  assert.deepEqual(localeChain('ta', have, 'ta'), ['ta', 'en']);
  assert.deepEqual(localeChain('fr', have, 'hi'), ['hi', 'en']);
  assert.deepEqual(localeChain('fr', have, 'de'), ['en']);
  assert.deepEqual(localeChain('', have, ''), ['en']);
  assert.deepEqual(localeChain('en', have, 'en'), ['en']);
  assert.deepEqual(localeChain('ar', []), ['en'], 'English is always last even if not listed');
});

test('isRtl', () => {
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('ar-AE'), true);
  assert.equal(isRtl('he'), true);
  assert.equal(isRtl('ta'), false);
  assert.equal(isRtl(''), false);
  assert.equal(isRtl(undefined), false);
});

test('hashText is stable and sensitive to changes', () => {
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
  assert.match(hashText(''), /^[0-9a-f]{8}$/);
});

test('createI18n source is self-contained so it can be injected into storefront scripts', () => {
  const src = createI18n.toString();
  assert.ok(!/\bimport\b|\brequire\(/.test(src));
  assert.ok(!/=>|\bconst\b|\blet\b|`/.test(src), 'ES5 only: no arrow functions, const/let or template strings');
  const rebuilt = new Function(`return (${src})()`)();
  assert.equal(rebuilt.formatMessage('Hi {n}', { n: 'x' }), 'Hi x');
});
