/**
 * Message helper for the multi-language work (storefront scripts and admin).
 * Everything lives inside createI18n(), which has no imports and uses ES5
 * only, so its source text can be injected into the storefront scripts the
 * same way createComboWeightCore() is (createI18n.toString()).
 *
 * Syntax (and nothing more):
 *   {name}                                        substitution
 *   {count, plural, one {# item} other {# items}} plural, '#' = the number
 *   '{  '}                                        a quote before a brace gives a literal brace
 * Plural selectors: zero one two few many other, or =N for an exact number.
 * `other` is required. Not supported: select, nested plurals, number/date
 * skeletons (formatting stays with Intl).
 *
 * A broken message never throws: translate() falls through its catalogue
 * chain, ends at the key, and never returns blank or "undefined". Values are
 * plain text, never HTML: call sites that build HTML escape variables first.
 */
export function createI18n() {
  var PLURAL_SELECTORS = { zero: 1, one: 1, two: 1, few: 1, many: 1, other: 1 };
  var RTL_LANGS = { ar: 1, he: 1, fa: 1, ur: 1 };
  var MAX_DEPTH = 8;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function fail(why) {
    var e = new Error('i18n: ' + why);
    e.i18n = true;
    return e;
  }

  // Index of the '}' that closes the '{' at position open, skipping '{ and '} escapes.
  function findClose(s, open) {
    var depth = 0;
    for (var i = open; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "'" && (s.charAt(i + 1) === '{' || s.charAt(i + 1) === '}')) { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    throw fail('unclosed brace');
  }

  function isSpace(c) { return c === ' ' || c === '\n' || c === '\t' || c === '\r'; }

  // Parse the part after "name, plural," into { selector: branchText }.
  function parseVariants(src) {
    var out = {};
    var count = 0;
    var i = 0;
    while (i < src.length) {
      while (i < src.length && isSpace(src.charAt(i))) i++;
      if (i >= src.length) break;
      var start = i;
      while (i < src.length && !isSpace(src.charAt(i)) && src.charAt(i) !== '{') i++;
      var sel = src.slice(start, i);
      while (i < src.length && isSpace(src.charAt(i))) i++;
      if (src.charAt(i) !== '{') throw fail('plural selector without a branch');
      var close = findClose(src, i);
      var ok = has(PLURAL_SELECTORS, sel) || /^=\d+$/.test(sel);
      if (!ok) throw fail('unknown plural selector ' + sel);
      if (has(out, sel)) throw fail('duplicate plural selector ' + sel);
      out[sel] = src.slice(i + 1, close);
      count++;
      i = close + 1;
    }
    if (!count || !has(out, 'other')) throw fail('plural needs an "other" branch');
    return out;
  }

  function pluralCategory(n, locale) {
    try {
      if (typeof Intl !== 'undefined' && Intl.PluralRules) {
        return new Intl.PluralRules(locale || 'en').select(n);
      }
    } catch (e) { /* fall through */ }
    return 'other';
  }

  // Walk the message. hash is the number a '#' prints (only inside a plural branch).
  // names (optional object) collects variable names instead of caring about values.
  function walk(s, vars, locale, hash, depth, names) {
    if (depth > MAX_DEPTH) throw fail('too deeply nested');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "'" && (s.charAt(i + 1) === '{' || s.charAt(i + 1) === '}')) {
        out += s.charAt(i + 1);
        i++;
      } else if (c === '{') {
        var close = findClose(s, i);
        var inner = s.slice(i + 1, close);
        i = close;
        var comma = inner.indexOf(',');
        if (comma < 0) {
          var name = inner.replace(/^\s+|\s+$/g, '');
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw fail('bad variable name "' + name + '"');
          if (names) names[name] = 1;
          var v = vars ? vars[name] : undefined;
          out += (v === undefined || v === null) ? '' : String(v);
        } else {
          var vname = inner.slice(0, comma).replace(/^\s+|\s+$/g, '');
          var rest = inner.slice(comma + 1);
          var comma2 = rest.indexOf(',');
          var type = (comma2 < 0 ? rest : rest.slice(0, comma2)).replace(/^\s+|\s+$/g, '');
          if (type !== 'plural' || comma2 < 0) throw fail('only plural is supported');
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(vname)) throw fail('bad variable name "' + vname + '"');
          if (names) names[vname] = 1;
          var variants = parseVariants(rest.slice(comma2 + 1));
          var raw = vars ? vars[vname] : undefined;
          var num = typeof raw === 'number' ? raw : parseFloat(raw);
          var branch;
          if (names) {
            // Validate every branch, collect names from all of them.
            for (var k in variants) {
              if (has(variants, k)) walk(variants[k], vars, locale, 0, depth + 1, names);
            }
            continue;
          }
          if (isFinite(num)) {
            branch = has(variants, '=' + num) ? variants['=' + num] : variants[pluralCategory(num, locale)];
          }
          if (branch === undefined) branch = variants.other;
          out += walk(branch, vars, locale, isFinite(num) ? num : '', depth + 1, null);
        }
      } else if (c === '}') {
        throw fail('stray closing brace');
      } else if (c === '#' && hash !== undefined && hash !== null && depth > 0) {
        out += String(hash);
      } else {
        out += c;
      }
    }
    return out;
  }

  /** Format one message. Returns the text, or null when the message is malformed. */
  function formatMessage(msg, vars, locale) {
    if (typeof msg !== 'string') return null;
    try { return walk(msg, vars || {}, locale, undefined, 0, null); } catch (e) { return null; }
  }

  /** Sorted variable names used by a message, or null when it is malformed. */
  function placeholders(msg) {
    if (typeof msg !== 'string') return null;
    var names = {};
    try { walk(msg, {}, 'en', undefined, 0, names); } catch (e) { return null; }
    var list = [];
    for (var n in names) if (has(names, n)) list.push(n);
    return list.sort();
  }

  /**
   * Build t(key, vars) over an ordered chain of catalogues (flat key → message
   * objects), most specific first and English last. A key missing from, or
   * malformed in, one catalogue is taken from the next; at the end of the chain
   * the key itself is returned.
   */
  function createTranslator(chain, locale) {
    var list = (chain || []).filter(function (c) { return c && typeof c === 'object'; });
    return function t(key, vars) {
      for (var i = 0; i < list.length; i++) {
        if (Object.prototype.hasOwnProperty.call(list[i], key)) {
          var text = formatMessage(list[i][key], vars, locale);
          if (text !== null) return text;
        }
      }
      return String(key);
    };
  }

  /** 'pt_br' → 'pt-BR', 'ES' → 'es', 'pt' → 'pt-BR'; junk → ''. */
  function normalizeLocale(tag) {
    if (typeof tag !== 'string') return '';
    var parts = tag.replace(/^\s+|\s+$/g, '').replace(/_/g, '-').split('-');
    var lang = parts[0].toLowerCase();
    if (!/^[a-z]{2,3}$/.test(lang)) return '';
    var rest = [];
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i];
      if (/^[A-Za-z]{4}$/.test(p)) rest.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
      else if (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p)) rest.push(p.toUpperCase());
      else return '';
    }
    var out = rest.length ? lang + '-' + rest.join('-') : lang;
    return out === 'pt' ? 'pt-BR' : out;
  }

  function baseLanguage(locale) {
    return String(locale || '').split('-')[0].toLowerCase();
  }

  /**
   * Language the page is showing, first usable value wins:
   * Liquid's locale, then Shopify.locale, then <html lang> (last, themes control it).
   */
  function pickLocale(sources) {
    var s = sources || {};
    var order = [s.liquid, s.shopify, s.htmlLang];
    for (var i = 0; i < order.length; i++) {
      var n = normalizeLocale(order[i]);
      if (n) return n;
    }
    return '';
  }

  /**
   * Catalogues to load, in order: the exact locale, its base language, the
   * shop's primary language, English. Only locales BRIX has a catalogue for.
   */
  function localeChain(locale, supported, primary, fallback) {
    var have = supported || [];
    var want = [normalizeLocale(locale), baseLanguage(locale), normalizeLocale(primary), baseLanguage(primary), fallback || 'en'];
    var out = [];
    for (var i = 0; i < want.length; i++) {
      var w = want[i];
      if (w && have.indexOf(w) >= 0 && out.indexOf(w) < 0) out.push(w);
    }
    var fb = fallback || 'en';
    if (out.indexOf(fb) < 0) out.push(fb);
    return out;
  }

  function isRtl(locale) {
    return has(RTL_LANGS, baseLanguage(locale));
  }

  /** Small stable hash (FNV-1a, 8 hex chars) for catalogue versions and source tracking. */
  function hashText(text) {
    var h = 0x811c9dc5;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  return {
    formatMessage: formatMessage,
    placeholders: placeholders,
    createTranslator: createTranslator,
    normalizeLocale: normalizeLocale,
    baseLanguage: baseLanguage,
    pickLocale: pickLocale,
    localeChain: localeChain,
    isRtl: isRtl,
    hashText: hashText
  };
}

const core = createI18n();

export const {
  formatMessage,
  placeholders,
  createTranslator,
  normalizeLocale,
  baseLanguage,
  pickLocale,
  localeChain,
  isRtl,
  hashText,
} = core;
