// logic/pricing.js
// Every rupee the app charges is worked out here, in one place.
//
// The order of operations matters and is deliberate:
//
//   subtotal
//   - combo discount
//   - coupon discount
//   - points redeemed
//   = food total
//   + packing        (Rs. 5 per item, capped)
//   + rush surcharge (5% of food total, lunch crush only)
//   = taxable
//   + GST 5%
//   + tip
//   = total
//
// GST is charged on the discounted amount, never on the list price.

const { isRushHour } = require('./scheduling');
const loyalty = require('./loyalty');

const PACKING_PER_ITEM = 5;
const PACKING_CAP = 20;
const GST_RATE = 0.05;
const COMBO_DISCOUNT = 15;
const RUSH_RATE = 0.05;
const TIP_CHOICES = [0, 5, 10, 15];
const MAX_TIP = 100;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function findDish(id, menu) {
  const dishId = Number(id);
  if (!Number.isInteger(dishId)) return null;
  return menu.find((d) => d.id === dishId) || null;
}

/** Cart items -> priced lines. Prices come from the menu, never the request. */
function buildLines(items, menu) {
  if (!Array.isArray(items)) return [];

  return items.reduce((lines, item) => {
    const dish = findDish(item && item.dishId, menu);
    if (!dish) return lines;

    const qty = Number(item.qty) || 0;
    if (qty <= 0) return lines;

    lines.push({
      dishId: dish.id,
      name: dish.name,
      price: dish.price,
      veg: dish.veg,
      category: dish.category,
      tags: dish.tags || [],
      qty,
      lineTotal: round2(dish.price * qty),
    });

    return lines;
  }, []);
}

const sumLines = (lines) => round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
const countUnits = (lines) => lines.reduce((sum, l) => sum + l.qty, 0);

function packingCharge(lines) {
  if (lines.length === 0) return 0;
  return Math.min(countUnits(lines) * PACKING_PER_ITEM, PACKING_CAP);
}

/** Rs. 15 off when a combo-eligible dish is bought together with a beverage. */
function comboDiscount(lines) {
  const hasBeverage = lines.some((l) => l.category === 'Beverages');
  const hasCombo = lines.some((l) => (l.tags || []).includes('combo-eligible'));
  return hasBeverage && hasCombo ? COMBO_DISCOUNT : 0;
}

/** Validate a coupon against this order. Returns { valid, discount, reason }. */
function applyCoupon(code, lines, coupons, { slot = null, now = new Date() } = {}) {
  if (!code) return { valid: false, discount: 0, reason: null };

  const wanted = String(code).trim().toUpperCase();
  const coupon = coupons.find((c) => c.code.toUpperCase() === wanted);
  if (!coupon) return { valid: false, discount: 0, reason: 'Coupon not found' };

  if (coupon.usesLeft <= 0) {
    return { valid: false, discount: 0, reason: 'This coupon is fully used' };
  }

  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) {
    return { valid: false, discount: 0, reason: 'This coupon has expired' };
  }

  const subtotal = sumLines(lines);
  if (subtotal < coupon.minOrder) {
    return {
      valid: false,
      discount: 0,
      reason: `Add Rs. ${round2(coupon.minOrder - subtotal)} more to use ${coupon.code}`,
    };
  }
  if (coupon.vegOnly && lines.some((l) => l.veg === false)) {
    return { valid: false, discount: 0, reason: `${coupon.code} works on veg-only orders` };
  }
  if (slot && Array.isArray(coupon.slots) && !coupon.slots.includes(slot)) {
    return { valid: false, discount: 0, reason: `${coupon.code} is not valid right now` };
  }

  let discount = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  discount = Math.min(discount, coupon.maxDiscount, subtotal);

  return { valid: true, discount: round2(discount), reason: null, coupon };
}

/** A tip is either a percentage of the food total or a flat amount. */
function tipAmount({ tipPercent = 0, tipFlat = 0 }, foodTotal) {
  if (tipPercent) {
    if (!TIP_CHOICES.includes(Number(tipPercent))) return 0;
    return round2((foodTotal * Number(tipPercent)) / 100);
  }
  const flat = Number(tipFlat) || 0;
  if (flat < 0) return 0;
  return round2(Math.min(flat, MAX_TIP));
}

/**
 * The whole bill.
 *
 * options: { couponCode, coupons, slot, now, tipPercent, tipFlat,
 *            redeemPoints, pointsBalance, lifetimePoints }
 */
function calculateBill(items, menu, options = {}) {
  const {
    couponCode = null,
    coupons = [],
    slot = null,
    now = new Date(),
    redeemPoints = 0,
    pointsBalance = 0,
    lifetimePoints = 0,
  } = options;

  const lines = buildLines(items, menu);
  const subtotal = sumLines(lines);

  const combo = comboDiscount(lines);
  const couponResult = applyCoupon(couponCode, lines, coupons, { slot, now });
  const redemption = loyalty.checkRedemption(redeemPoints, pointsBalance, subtotal);

  const foodTotal = Math.max(
    0,
    round2(subtotal - combo - couponResult.discount - redemption.value)
  );

  const packing = packingCharge(lines);
  const rush = isRushHour(now) ? round2(foodTotal * RUSH_RATE) : 0;
  const taxable = round2(foodTotal + packing + rush);
  const gst = round2(taxable * GST_RATE);
  const tip = tipAmount(options, foodTotal);
  const total = round2(taxable + gst + tip);

  return {
    lines,
    subtotal,
    comboDiscount: round2(combo),
    couponCode: couponResult.valid ? String(couponCode).toUpperCase() : null,
    couponDiscount: couponResult.discount,
    couponError: couponResult.valid ? null : couponResult.reason,
    pointsRedeemed: redemption.points,
    pointsValue: redemption.value,
    pointsError: redemption.ok ? null : redemption.reason,
    foodTotal,
    packing,
    rushSurcharge: rush,
    gst,
    tip,
    total,
    pointsEarned: loyalty.pointsEarned(foodTotal, lifetimePoints),
  };
}

module.exports = {
  PACKING_PER_ITEM,
  PACKING_CAP,
  GST_RATE,
  COMBO_DISCOUNT,
  RUSH_RATE,
  TIP_CHOICES,
  MAX_TIP,
  round2,
  findDish,
  buildLines,
  sumLines,
  countUnits,
  packingCharge,
  comboDiscount,
  applyCoupon,
  tipAmount,
  calculateBill,
};
