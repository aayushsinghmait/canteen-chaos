/* orders.js - the tracking modal (with backoff polling), the My Orders
   list, cancelling, and rating a collected order. */

const STATUS_STEPS = ['placed', 'accepted', 'preparing', 'ready', 'picked'];

const POLL_MIN = 3000;
const POLL_MAX = 20000;
const POLL_GROWTH = 1.4;

const ordersList = $('#ordersList');
const ordersStatus = $('#ordersStatus');

let track = { token: null, timer: null, wait: POLL_MIN, failures: 0 };

/* -------------------------------------------------- tracking modal */

function showOrderModal(order) {
  renderOrderProgress(order);
  openModal('orderModal', { onClose: stopTracking });
  startTracking(order.token);
}

function renderOrderProgress(order) {
  setText('#orderToken', order.token);

  const eta = {
    cancelled: 'This order was cancelled.',
    refunded: 'This order was refunded.',
    ready: 'Ready. Collect it from the counter.',
    picked: 'Collected. Enjoy.',
  }[order.status] || `Ready in about ${order.etaMinutes} minutes`;

  setText('#orderEta', eta);
  setText('#orderPickup', order.pickupSlot ? `Pickup slot ${prettyClock(order.pickupSlot)}` : '');

  const reached = STATUS_STEPS.indexOf(order.status);

  render(
    '#orderTimeline',
    STATUS_STEPS.map((step, i) => {
      const hit = order.history.find((h) => h.status === step);
      const done = reached >= i && reached !== -1;

      return html`<li class="step ${done ? 'done' : ''} ${reached === i ? 'current' : ''}">
        <span class="dot"></span>
        <span class="step-name">${step}</span>
        <span class="step-time">${hit ? clockString(hit.at) : ''}</span>
      </li>`;
    }).join('')
  );

  const cancel = $('#cancelOrderBtn');
  cancel.hidden = !order.canCancel;
  cancel.dataset.token = order.token;

  const rate = $('#rateOrderBtn');
  rate.hidden = !(order.status === 'picked' && !order.rated);
  rate.dataset.token = order.token;
}

/**
 * Poll this one order. The wait grows while nothing changes, so a
 * forgotten tab is not hammering the server every three seconds.
 */
function startTracking(token) {
  stopTracking();
  track = { token, timer: null, wait: POLL_MIN, failures: 0 };
  scheduleTick();
}

function scheduleTick() {
  track.timer = setTimeout(tick, track.wait);
}

async function tick() {
  if (!track.token) return;

  if (document.hidden) {        // nobody is looking; check again later
    track.wait = POLL_MAX;
    return scheduleTick();
  }

  try {
    const order = await api.getOrder(track.token);
    const before = $('#orderTimeline').dataset.status;

    renderOrderProgress(order);
    $('#orderTimeline').dataset.status = order.status;

    if (order.status !== before) {
      track.wait = POLL_MIN;                       // something moved, look again soon
      if (order.status === 'ready') toast('Your order is ready', 'ok', { ms: 6000 });
    } else {
      track.wait = Math.min(track.wait * POLL_GROWTH, POLL_MAX);
    }

    track.failures = 0;

    if (['picked', 'cancelled', 'refunded'].includes(order.status)) return stopTracking();
  } catch (err) {
    if (err.cancelled) return scheduleTick();

    track.failures += 1;
    track.wait = Math.min(track.wait * 2, POLL_MAX);
    if (track.failures >= 4) return stopTracking();
  }

  scheduleTick();
}

function stopTracking() {
  if (track.timer) clearTimeout(track.timer);
  track = { token: null, timer: null, wait: POLL_MIN, failures: 0 };
}

$('#trackLaterBtn').addEventListener('click', () => {
  closeModal('orderModal');
  location.hash = '#/orders';
});

$('#cancelOrderBtn').addEventListener('click', (e) => cancelOrder(e.currentTarget.dataset.token));
$('#rateOrderBtn').addEventListener('click', (e) => openRating(e.currentTarget.dataset.token));

/* ---------------------------------------------------- My Orders */

async function loadMyOrders() {
  hideStatus(ordersStatus);
  render(ordersList, skeletonRows(3));

  let orders = [];
  try {
    const data = await api.listOrders({ memberId: deviceId(), limit: 25 });
    orders = data.orders;
  } catch (err) {
    ordersList.innerHTML = '';
    showStatus(ordersStatus, errorBlock(err, 'ordersRetry'));
    const retry = $('#ordersRetry');
    if (retry) retry.addEventListener('click', loadMyOrders);
    return;
  }

  if (orders.length === 0) {
    ordersList.innerHTML = '';
    return showStatus(
      ordersStatus,
      emptyBlock(
        'No orders found',
        `Requested member ${deviceId()}. This browser has ${state.tokens.length} saved order token(s).`
      )
    );
  }

  showStatus(
    ordersStatus,
    html`<p class="status-sub">Requested member ${deviceId()} · server returned ${orders.length} order(s) · this browser has ${state.tokens.length} saved token(s)</p>`
  );

  const active = orders.filter((o) => Array.isArray(o.allowedNext) && o.allowedNext.length > 0);
  const past = orders.filter((o) => !Array.isArray(o.allowedNext) || o.allowedNext.length === 0);

  render(
    ordersList,
    (active.length ? '<h2 class="sub-title">Happening now</h2>' + active.map(orderCard).join('') : '') +
      (past.length ? '<h2 class="sub-title">Earlier</h2>' + past.map(orderCard).join('') : '')
  );
}

function orderCard(order) {
  const items = order.items.map((l) => `${l.name} x${l.qty}`).join(', ');

  return html`<article class="order-card" data-token="${order.token}">
    <div class="order-top">
      <span class="order-token">${order.token}</span>
      <span class="pill pill-${order.status}">${order.status}</span>
    </div>

    <p class="order-items">${items}</p>

    <div class="order-bottom">
      <span class="order-when">${timeAgo(order.placedAt)}${order.pickupSlot ? ` · pickup ${prettyClock(order.pickupSlot)}` : ''}</span>
      <span class="order-total">${rupees(order.total)}</span>
    </div>

    <div class="order-actions">
      <button class="ghost-btn" data-order="track">Track</button>
      ${raw(order.canCancel ? '<button class="link-btn danger" data-order="cancel">Cancel</button>' : '')}
      ${raw(order.status === 'picked' && !order.rated ? '<button class="link-btn" data-order="rate">Rate</button>' : '')}
      ${raw(order.rated ? '<span class="muted small">rated</span>' : '')}
    </div>
  </article>`;
}

delegate(ordersList, '[data-order]', 'click', async (e, node) => {
  const token = node.closest('.order-card').dataset.token;

  if (node.dataset.order === 'track') {
    try {
      showOrderModal(await api.getOrder(token));
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  if (node.dataset.order === 'cancel') cancelOrder(token, node);
  if (node.dataset.order === 'rate') openRating(token);
});

async function cancelOrder(token, button) {
  if (button) button.disabled = true;

  try {
    await api.setStatus(token, 'cancelled');
    toast('Order cancelled', 'ok');
    stopTracking();
    closeModal('orderModal');
    loadMyOrders();
    // CC-07 fix: always reload the menu after cancellation regardless of current route.
    // releaseStock() restores stock on the server immediately, but the menu page
    // would still show "Sold out" because it was only refreshed when route === 'menu'.
    // Cancelling from My Orders (route === 'orders') meant the menu was never updated.
    // Clear API cache first so the fresh stock value is actually fetched.
    api.clearCache();
    loadMenu();
  } catch (err) {
    toast(err.message, 'bad');
    if (button) button.disabled = false;
  }
}

/* ----------------------------------------------------------- rating */

let ratingDraft = { token: null, stars: {} };

async function openRating(token) {
  try {
    const order = await api.getOrder(token);
    ratingDraft = { token, stars: {} };

    render(
      '#ratingBody',
      order.items
        .map(
          (line) => html`<div class="rate-row" data-dish="${line.dishId}">
            <span class="rate-name">${line.name}</span>
            <span class="rate-stars">${raw(starRow(0, { interactive: true, dishId: line.dishId }))}</span>
          </div>`
        )
        .join('')
    );

    openModal('ratingModal');
  } catch (err) {
    toast(err.message, 'bad');
  }
}

delegate('#ratingBody', '.star', 'click', (e, node) => {
  const dishId = Number(node.dataset.dish);
  const stars = Number(node.dataset.star);
  ratingDraft.stars[dishId] = stars;

  $$(`.star[data-dish="${dishId}"]`).forEach((s) =>
    s.classList.toggle('on', Number(s.dataset.star) <= stars)
  );
});

$('#submitRatingBtn').addEventListener('click', async () => {
  const ratings = Object.entries(ratingDraft.stars).map(([dishId, stars]) => ({
    dishId: Number(dishId),
    stars,
  }));

  if (ratings.length === 0) return toast('Pick at least one rating', 'warn');

  try {
    await api.rateOrder(ratingDraft.token, ratings);
    closeModal('ratingModal');
    toast('Thanks for rating', 'ok');
    api.clearCache();
    loadMyOrders();
  } catch (err) {
    toast(err.message, 'bad');
  }
});
