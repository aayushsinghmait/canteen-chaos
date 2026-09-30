// routes/orders.routes.js
// Placing an order, tracking it, cancelling it, rating it.
//
// Two things here are worth reading closely:
//   - the same Idempotency-Key never creates two orders, so a double tap
//     on "Place Order" is harmless
//   - stock is reserved and the bill is priced from the menu, after
//     validation, never from anything the browser sent

const express = require('express');

const store = require('../store');
const pricing = require('../logic/pricing');
const validation = require('../logic/validation');
const availability = require('../logic/availability');
const scheduling = require('../logic/scheduling');
const statusLogic = require('../logic/status');
const loyalty = require('../logic/loyalty');
const ratingsLogic = require('../logic/ratings');

const { asyncHandler, badRequest, notFound, conflict } = require('../middleware/errors');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// A student might legitimately place a few orders in a minute; forty is
// generous enough for that and still stops a stuck retry loop.
const placeLimiter = rateLimit({
  windowMs: 60000,
  max: Number(process.env.ORDER_RATE_MAX || 40),
  name: 'orders',
});

function newToken(existing) {
  let token;
  do {
    token = 'CC-' + (Math.floor(Math.random() * 9000) + 1000);
  } while (existing.some((o) => o.token === token));
  return token;
}

function memberFor(id) {
  if (!id) return null;
  const members = store.read('members');
  return members.find((m) => m.id === id) || loyalty.blankMember(id);
}

function withExtras(order) {
  return {
    ...order,
    allowedNext: statusLogic.allowedNext(order.status),
    canCancel: statusLogic.allowedNext(order.status).includes('cancelled'),
  };
}

// POST /api/cart/quote is mounted here too - see server.js
const quote = asyncHandler((req, res) => {
  const now = new Date();
  const menu = store.readMenu();
  const member = memberFor(req.get('X-Member-Id'));

  const bill = pricing.calculateBill(req.body && req.body.items, menu, {
    couponCode: req.body && req.body.couponCode,
    coupons: store.read('coupons'),
    slot: availability.currentSlot(now),
    now,
    tipPercent: req.body && req.body.tipPercent,
    tipFlat: req.body && req.body.tipFlat,
    redeemPoints: req.body && req.body.redeemPoints,
    pointsBalance: member ? member.points : 0,
    lifetimePoints: member ? member.lifetimePoints : 0,
  });

  res.json({
    ...bill,
    rushHour: scheduling.isRushHour(now),
    pointsBalance: member ? member.points : 0,
  });
});

// POST /api/orders
router.post(
  '/',
  placeLimiter,
  asyncHandler((req, res) => {
    const now = new Date();
    const orders = store.read('orders');
    const key = req.get('Idempotency-Key');

    // the same key twice means the same order, not a second one
    if (key) {
      const existing = orders.find((o) => o.idempotencyKey === key);
      if (existing) return res.status(200).json(withExtras(existing));
    }

    const menu = store.readMenu();
    const check = validation.validateOrder(req.body, menu, { now, orders });
    if (!check.valid) throw badRequest('Invalid order', check.errors);

    const memberId = req.get('X-Member-Id') || req.body.memberId || null;
    const member = memberFor(memberId);

    const bill = pricing.calculateBill(req.body.items, menu, {
      couponCode: req.body.couponCode,
      coupons: store.read('coupons'),
      slot: availability.currentSlot(now),
      now,
      tipPercent: req.body.tipPercent,
      tipFlat: req.body.tipFlat,
      redeemPoints: req.body.redeemPoints,
      pointsBalance: member ? member.points : 0,
      lifetimePoints: member ? member.lifetimePoints : 0,
    });

    if (bill.pointsError) throw badRequest(bill.pointsError);
    if (req.body.couponCode && bill.couponError) throw badRequest(bill.couponError);

    // stock is taken only once everything else has passed
    const reserved = validation.reserveStock(req.body.items, menu);
    if (!reserved.ok) throw conflict('Someone just took the last one', reserved.errors);

    const order = {
      token: newToken(orders),
      idempotencyKey: key || null,
      memberId,
      items: bill.lines,
      subtotal: bill.subtotal,
      comboDiscount: bill.comboDiscount,
      couponCode: bill.couponCode,
      couponDiscount: bill.couponDiscount,
      pointsRedeemed: bill.pointsRedeemed,
      pointsValue: bill.pointsValue,
      foodTotal: bill.foodTotal,
      packing: bill.packing,
      rushSurcharge: bill.rushSurcharge,
      gst: bill.gst,
      tip: bill.tip,
      total: bill.total,
      pointsEarned: bill.pointsEarned,
      hostelRoom: req.body.hostelRoom ? String(req.body.hostelRoom).toUpperCase() : null,
      pickupSlot: req.body.pickupSlot || null,
      note: req.body.note || null,
      status: 'placed',
      manual: false,
      rated: false,
      history: [{ status: 'placed', at: now.toISOString() }],
      placedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      etaMinutes: statusLogic.estimateMinutes(bill.lines, menu, {
        queueAhead: statusLogic.queueLength(orders),
        rush: scheduling.isRushHour(now),
      }),
    };

    store.writeMenu(reserved.menu);

    if (bill.couponCode) {
      store.update('coupons', (list) =>
        list.map((c) => (c.code === bill.couponCode ? { ...c, usesLeft: c.usesLeft } : c))
      );
    }

    if (memberId) {
      store.update('members', (list) => {
        const current = list.find((m) => m.id === memberId) || loyalty.blankMember(memberId);
        const updated = loyalty.applyOrder(current, {
          earned: bill.pointsEarned,
          spent: bill.pointsRedeemed,
        });
        return list.filter((m) => m.id !== memberId).concat(updated);
      });
    }

    store.update('orders', (list) => list.concat(order));
    res.status(201).json(withExtras(order));
  })
);

// GET /api/orders?status=placed&limit=50   (staff queue)
router.get(
  '/',
  asyncHandler((req, res) => {
    const all = store.read('orders');
    let orders = all.slice();

    if (req.query.status) orders = orders.filter((o) => o.status === req.query.status);
    // fix: was req.query.userId (always undefined) — must match the actual query param name
    if (req.query.memberId) orders = orders.filter((o) => o.memberId === req.query.memberId);
    if (req.query.active === 'true') {
      orders = orders.filter((o) => !statusLogic.TERMINAL.includes(o.status));
    }

    orders.sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);

    res.json({
      count: orders.length,
      queue: statusLogic.queueLength(all),
      stalled: statusLogic.stalledOrders(all).map((o) => o.token),
      orders: orders.slice(0, limit).map(withExtras),
    });
  })
);

// GET /api/orders/:token
router.get(
  '/:token',
  asyncHandler((req, res) => {
    const order = store.read('orders').find((o) => o.token === req.params.token);
    if (!order) throw notFound('Order not found');

    res.json({
      ...withExtras(order),
      ageSeconds: Math.round(statusLogic.ageSeconds(order)),
    });
  })
);

// PATCH /api/orders/:token/status   { status, manual? }
router.patch(
  '/:token/status',
  asyncHandler((req, res) => {
    const { status, manual } = req.body || {};
    if (!status) throw badRequest('status is required');

    const orders = store.read('orders');
    const order = orders.find((o) => o.token === req.params.token);
    if (!order) throw notFound('Order not found');

    const move = statusLogic.canTransition(order.status, status);
    if (!move.ok) throw conflict(move.reason, statusLogic.allowedNext(order.status));

    // cancelling puts the food back on the shelf and the points back in the wallet
    if (status === 'cancelled') {
      store.writeMenu(validation.releaseStock(order.items, store.readMenu()));

      if (order.memberId) {
        store.update('members', (list) =>
          list.map((m) =>
            m.id === order.memberId
              ? {
                  ...m,
                  points: m.points + order.pointsRedeemed - order.pointsEarned,
                  lifetimePoints: m.lifetimePoints - order.pointsEarned,
                }
              : m
          )
        );
      }

      if (order.couponCode) {
        store.update('coupons', (list) =>
          list.map((c) => (c.code === order.couponCode ? { ...c, usesLeft: c.usesLeft + 1 } : c))
        );
      }
    }

    const updated = statusLogic.advance(
      { ...order, manual: manual === undefined ? order.manual : Boolean(manual) },
      status
    );

    store.update('orders', (list) => list.map((o) => (o.token === order.token ? updated : o)));
    res.json(withExtras(updated));
  })
);

// POST /api/orders/:token/rate   { ratings: [{ dishId, stars }] }
router.post(
  '/:token/rate',
  asyncHandler((req, res) => {
    const orders = store.read('orders');
    const order = orders.find((o) => o.token === req.params.token);
    if (!order) throw notFound('Order not found');

    if (order.status !== 'picked') throw conflict('You can rate an order once you have collected it');
    if (order.rated) throw conflict('This order has already been rated');

    const incoming = (req.body && req.body.ratings) || [];
    if (!Array.isArray(incoming) || incoming.length === 0) throw badRequest('ratings is required');

    const result = ratingsLogic.applyOrderRatings(store.read('ratings'), incoming, order.items);
    if (result.applied === 0) throw badRequest('Nothing could be rated', result.errors);

    store.write('ratings', result.records);
    store.update('orders', (list) =>
      list.map((o) => (o.token === order.token ? { ...o, rated: true } : o))
    );

    res.json({ applied: result.applied, errors: result.errors });
  })
);

module.exports = { router, quote };
