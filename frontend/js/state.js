/* state.js - the one place the app keeps what it knows.
   Other modules read `state` and call these functions; nothing writes
   state.cart directly. Every change emits an event so the views can
   catch up without each one polling the others. */

const KEYS = {
  cart: 'cc_cart_v3',
  favourites: 'cc_favs_v3',
  tokens: 'cc_tokens_v3',
  theme: 'cc_theme',
  recent: 'cc_recent_v3',
  checkout: 'cc_checkout_v3',
};

const MAX_PER_DISH = 10;
const MAX_TOKENS = 25;
const MAX_RECENT = 8;

const state = {
  /* menu */
  dishes: [],
  picks: [],
  categories: [],
  total: 0,
  page: 1,
  pages: 1,
  hasMore: false,
  filters: { veg: 'all', q: '', category: 'All', sort: 'default', servedOnly: false, maxPrice: '' },

  /* server truth */
  slot: null,
  open: true,
  rushHour: false,
  serverTime: null,

  /* cart + checkout */
  cart: storage.get(KEYS.cart, {}),
  checkout: Object.assign(
    { couponCode: null, room: '', note: '', pickupSlot: null, tipPercent: 0, tipFlat: 0, redeemPoints: 0 },
    storage.get(KEYS.checkout, {})
  ),
  quote: null,
  pickupSlots: [],
  member: null,

  /* history on this device */
  tokens: storage.get(KEYS.tokens, []),
  favourites: storage.get(KEYS.favourites, []),
  recent: storage.get(KEYS.recent, []),

  /* staff */
  staffOrders: [],
  stats: null,

  route: 'menu',
  lastRemoved: null, // for undo
};

/* ------------------------------------------------------------ events */

const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

function emit(event, payload) {
  (listeners.get(event) || []).forEach((fn) => fn(payload));
  (listeners.get('*') || []).forEach((fn) => fn(event, payload));
}

/* -------------------------------------------------------------- cart */

const cartItems = () =>
  Object.entries(state.cart)
    .map(([dishId, qty]) => ({ dishId: Number(dishId), qty }))
    .filter((i) => i.qty > 0);

const cartCount = () => cartItems().reduce((sum, i) => sum + i.qty, 0);
const cartQty = (dishId) => state.cart[Number(dishId)] || 0;
const cartHas = (dishId) => cartQty(dishId) > 0;

function saveCart() {
  storage.set(KEYS.cart, state.cart);
}

/**
 * Change the quantity of one dish.
 * Returns { ok, qty, reason } - the caller decides what to say.
 */
function setQty(dish, qty) {
  const id = Number(dish.id);
  const next = Math.max(0, Math.floor(qty));

  if (next > MAX_PER_DISH) return { ok: false, qty: cartQty(id), reason: `Max ${MAX_PER_DISH} of one dish` };
  // CC-06 fix: also cap at the dish's actual available stock
  const stock = Number(dish.stock);
  if (!Number.isNaN(stock) && next > stock) {
    return { ok: false, qty: cartQty(id), reason: `Only ${stock} ${dish.name} available` };
  }
  if (next === 0) delete state.cart[id];
  else state.cart[id] = next;

  saveCart();
  emit('cart', { dishId: id, qty: next });
  return { ok: true, qty: next, reason: null };
}

const addToCart = (dish, step = 1) => setQty(dish, cartQty(dish.id) + step);

function removeFromCart(dishId) {
  const id = Number(dishId);
  const qty = cartQty(id);
  if (qty === 0) return;

  state.lastRemoved = { dishId: id, qty };
  delete state.cart[id];
  saveCart();
  emit('cart', { dishId: id, qty: 0 });
}

/** Put back whatever was removed last. */
function undoRemove() {
  if (!state.lastRemoved) return false;

  const { dishId, qty } = state.lastRemoved;
  state.cart[dishId] = qty;
  state.lastRemoved = null;
  saveCart();
  emit('cart', { dishId, qty });
  return true;
}

function clearCart() {
  state.cart = {};
  state.quote = null;
  state.lastRemoved = null;
  state.checkout = {
    couponCode: null, room: state.checkout.room, note: '',
    pickupSlot: null, tipPercent: 0, tipFlat: 0, redeemPoints: 0,
  };
  saveCart();
  saveCheckout();
  emit('cart', { cleared: true });
}

/* ---------------------------------------------------------- checkout */

function saveCheckout() {
  storage.set(KEYS.checkout, state.checkout);
}

function setCheckout(patch) {
  state.checkout = { ...state.checkout, ...patch };
  saveCheckout();
  emit('checkout', patch);
}

/** What the quote and order endpoints both need. */
function orderPayload() {
  const c = state.checkout;
  return {
    items: cartItems(),
    couponCode: c.couponCode || null,
    hostelRoom: c.room || null,
    note: c.note || null,
    pickupSlot: c.pickupSlot || null,
    tipPercent: c.tipFlat ? 0 : c.tipPercent || 0,
    tipFlat: c.tipFlat || 0,
    redeemPoints: c.redeemPoints || 0,
  };
}

/* -------------------------------------------------------- favourites */

const isFavourite = (dishId) => state.favourites.includes(Number(dishId));

function toggleFavourite(dishId) {
  const id = Number(dishId);
  state.favourites = isFavourite(id)
    ? state.favourites.filter((f) => f !== id)
    : state.favourites.concat(id);

  storage.set(KEYS.favourites, state.favourites);
  emit('favourites', id);
  return isFavourite(id);
}

/* ------------------------------------------------- recent + tokens */

function rememberViewed(dishId) {
  const id = Number(dishId);
  state.recent = [id].concat(state.recent.filter((r) => r !== id)).slice(0, MAX_RECENT);
  storage.set(KEYS.recent, state.recent);
}

function rememberToken(token) {
  if (state.tokens.includes(token)) return;
  state.tokens = [token].concat(state.tokens).slice(0, MAX_TOKENS);
  storage.set(KEYS.tokens, state.tokens);
  emit('tokens', token);
}

function forgetToken(token) {
  state.tokens = state.tokens.filter((t) => t !== token);
  storage.set(KEYS.tokens, state.tokens);
  emit('tokens', token);
}

/* ------------------------------------------------------------- theme */

const currentTheme = () => storage.get(KEYS.theme, null);

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set(KEYS.theme, theme);
  emit('theme', theme);
}

/** Follow the system setting until the person picks one themselves. */
function preferredTheme() {
  const saved = currentTheme();
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
