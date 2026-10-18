// Progress bar layout and message text, shared by the admin preview
// (CartPreview.jsx) and the storefront drawer (cart_drawer_inline.js holds a
// verbatim copy of the begin..end block, checked by
// tests/cart-drawer/progress-layout.test.mjs).
//
// Milestones used to sit at target / highest target along the bar, so close
// targets far below the last one (extrokids: ₹799, ₹1000, ₹1300 on a ₹12000
// bar) landed within a few pixels and their icons, REACHED badges and labels
// drew over each other. They keep their order but are held at least a gap
// apart, and the fill follows the same positions (piecewise), so it still
// meets each milestone exactly when its amount is reached.

/* progress-layout:begin */
// Where each milestone sits (percent of the track), targets ascending.
// lo..hi = the track's usable span; gap = the least space between two.
function ccMilestonePositions(targets, lo, hi, gap) {
  var n = targets.length;
  if (!n) return [];
  var max = targets[n - 1] > 0 ? targets[n - 1] : 1;
  var room = n > 1 ? (hi - lo) / (n - 1) : 0;
  var g = Math.min(gap, room);
  var out = [];
  var i;
  for (i = 0; i < n; i++) {
    var p = Math.min(hi, Math.max(lo, (targets[i] / max) * 100));
    if (i > 0 && p < out[i - 1] + g) p = out[i - 1] + g;
    out.push(p);
  }
  if (out[n - 1] > hi) {
    out[n - 1] = hi;
    for (i = n - 2; i >= 0; i--) if (out[i] > out[i + 1] - g) out[i] = out[i + 1] - g;
  }
  return out;
}

// How full the bar is for `value`: 0 at 0, each milestone's position at its
// target, 100 at (or past) the last target.
function ccProgressFill(value, targets, positions) {
  var n = targets.length;
  if (!n || !(value > 0)) return 0;
  if (value >= targets[n - 1]) return 100;
  var prevT = 0;
  var prevP = 0;
  for (var i = 0; i < n; i++) {
    if (value < targets[i]) {
      var span = targets[i] - prevT;
      return span > 0 ? prevP + ((value - prevT) / span) * (positions[i] - prevP) : positions[i];
    }
    prevT = targets[i];
    prevP = positions[i];
  }
  return 100;
}

// Puts a formatted amount ("₹2,524.00") in place of `tag` ("{amount}"). A
// currency sign the merchant typed right before the tag ("Add ₹{amount}")
// is dropped when the amount already starts with it (it showed "₹₹2,524.00").
function ccFillMoneyTag(text, tag, value) {
  var str = String(value);
  var sign = (str.match(/^[^\d\s.,-]+/) || [''])[0];
  var out = String(text);
  if (sign) out = out.split(sign + ' ' + tag).join(tag).split(sign + tag).join(tag);
  return out.split(tag).join(str);
}
/* progress-layout:end */

export const milestonePositions = ccMilestonePositions;
export const progressFill = ccProgressFill;
export const fillMoneyTag = ccFillMoneyTag;
