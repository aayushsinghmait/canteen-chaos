/* menu.js - the dish grid: search with suggestions, filters, sorting,
   paging (button + infinite scroll), favourites and quantity steppers. */

const menuGrid = $('#menuGrid');
const menuStatus = $('#menuStatus');
const resultCount = $('#resultCount');
const loadMoreBtn = $('#loadMoreBtn');
const catTabs = $('#catTabs');
const picksStrip = $('#picksStrip');
const searchInput = $('#searchInput');
const suggestBox = $('#suggestBox');
const sentinel = $('#scrollSentinel');

// every menu request carries a number; a reply from an older one is dropped
let menuRequestId = 0;
let suggestIndex = -1;

/* --------------------------------------------------------- loading */

async function loadMenu({ append = false } = {}) {
  const myRequest = ++menuRequestId;

  if (append) {
    loadMoreBtn.textContent = 'Loading...';
    loadMoreBtn.disabled = true;
  } else {
    state.page = 1;
    menuGrid.innerHTML = skeletonCards(8);
    hideStatus(menuStatus);
  }

  try {
    const data = await api.getMenu({
      veg: state.filters.veg,
      q: state.filters.q,
      category: state.filters.category,
      sort: state.filters.sort,
      servedOnly: state.filters.servedOnly ? 'true' : '',
      maxPrice: state.filters.maxPrice,
      page: state.page,
      limit: 5,
    });

    if (myRequest !== menuRequestId) return; // a newer search already won

    state.dishes = append ? state.dishes.concat(data.dishes) : data.dishes;
    state.total = data.total;
    state.pages = data.pages;
    state.hasMore = data.hasMore;
    state.slot = data.slot;
    state.open = data.open;
    state.serverTime = data.serverTime;

    renderSlotBar();
    renderMenu();
  } catch (err) {
    if (err.cancelled || myRequest !== menuRequestId) return;

    menuGrid.innerHTML = '';
    showStatus(menuStatus, errorBlock(err, 'menuRetry'));
    const retry = $('#menuRetry');
    if (retry) retry.addEventListener('click', () => loadMenu());
  } finally {
    if (myRequest === menuRequestId) {
      loadMoreBtn.textContent = 'Load more';
      loadMoreBtn.disabled = false;
    }
  }
}

async function loadCategories() {
  try {
    const { categories } = await api.getCategories();
    state.categories = categories;

    render(
      catTabs,
      [{ name: 'All', count: state.total }]
        .concat(categories)
        .map(
          (c) => html`<button class="cat-tab ${state.filters.category === c.name ? 'active' : ''}"
                    data-cat="${c.name}">${c.name}
              <span class="cat-count">${c.count || ''}</span></button>`
        )
        .join('')
    );
  } catch (e) {
    catTabs.innerHTML = '';
  }
}

async function loadPicks() {
  try {
    const { picks } = await api.getPicks();
    state.picks = picks;

    if (picks.length === 0) return show(picksStrip.parentElement, false);

    show(picksStrip.parentElement, true);
    render(
      picksStrip,
      picks
        .map(
          (d) => html`<button class="pick-chip" data-id="${d.id}">
              <span class="pick-name">${d.name}</span>
              <span class="pick-price">${rupees(d.price)}</span>
            </button>`
        )
        .join('')
    );
  } catch (e) {
    show(picksStrip.parentElement, false);
  }
}

/* -------------------------------------------------------- rendering */

function renderMenu() {
  if (state.dishes.length === 0) {
    menuGrid.innerHTML = '';
    showStatus(menuStatus, emptyBlock('Nothing matches that', 'Try another search, or turn off "Served now".'));
    resultCount.textContent = '';
    show(loadMoreBtn, false);
    return;
  }

  hideStatus(menuStatus);
  menuGrid.innerHTML = state.dishes.map(dishCard).join('');
  const prices = state.dishes.map((d) => Number(d.price)).filter((p) => !Number.isNaN(p));
  const priceNote = prices.length
    ? ` · first ${rupees(prices[0])} · last ${rupees(prices[prices.length - 1])}`
    : '';
  resultCount.textContent = `Showing ${state.dishes.length} dishes · requested page size 5 · total ${state.total}${priceNote}`;
  show(loadMoreBtn, state.hasMore);
}

function badgeFor(dish) {
  if (dish.disabled) return '<span class="badge sold">Off menu</span>';
  if (dish.stock === 0) return '<span class="badge sold">Sold out</span>';
  if (!dish.servedNow) return html`<span class="badge later">${dish.slotLabel}</span>`;
  if (dish.stock <= 3) return html`<span class="badge low">Only ${dish.stock} left</span>`;
  if ((dish.tags || []).includes('bestseller')) return '<span class="badge hot">Bestseller</span>';
  if ((dish.tags || []).includes('new')) return '<span class="badge new">New</span>';
  return '';
}

function qtyControl(dish) {
  const qty = cartQty(dish.id);

  if (qty > 0) {
    return html`<div class="qty-row">
      <button class="qty-btn" data-action="dec" aria-label="One less ${dish.name}">&minus;</button>
      <span class="qty-value" data-qty="${dish.id}">${qty}</span>
      <button class="qty-btn" data-action="inc" aria-label="One more ${dish.name}">+</button>
    </div>`;
  }

  const label = dish.orderable ? 'Add to Cart' : dish.blockedReason || 'Not now';
  return html`<button class="add-btn" data-action="add" ${raw(dish.orderable ? '' : 'disabled')}>${label}</button>`;
}

function dishCard(dish) {
  const fav = isFavourite(dish.id);

  return html`<article class="dish-card ${dish.orderable ? '' : 'blocked'}" data-id="${dish.id}">
    <div class="img-wrap">
      <img src="${dish.image}" alt="${dish.name}" loading="lazy" data-action="open" />
      ${raw(badgeFor(dish))}
      <button class="fav-btn ${fav ? 'on' : ''}" data-action="fav"
              aria-pressed="${fav}" aria-label="Save ${dish.name}">&#9733;</button>
    </div>

    <div class="dish-body">
      <h3 class="dish-name"><button class="name-btn" data-action="open">${dish.name}</button></h3>

      <div class="dish-meta">
        <span class="veg-dot ${dish.veg ? '' : 'nonveg'}" title="${dish.veg ? 'Veg' : 'Non-veg'}"></span>
        <span>${dish.category}</span>
        <span class="rating">&#9733; ${dish.rating}${dish.ratingCount ? ` (${dish.ratingCount})` : ''}</span>
        ${raw(dish.spicy ? '<span class="spicy" title="Spicy">&#127798;</span>' : '')}
      </div>

      <div class="price-row">
        <span class="dish-price">${rupees(dish.price)}</span>
        <span class="prep">~${dish.prepMinutes} min</span>
      </div>

      ${raw(qtyControl(dish))}
    </div>
  </article>`;
}

/** Repaint one card's control without touching the rest of the grid. */
function updateCardQty(dishId) {
  const card = menuGrid.querySelector(`.dish-card[data-id="${dishId}"]`);
  if (!card) return;

  const dish = state.dishes.find((d) => d.id === Number(dishId));
  if (!dish) return;

  const body = $('.dish-body', card);
  const control = body.querySelector('.qty-row, .add-btn');
  if (!control) return;

  const holder = document.createElement('div');
  holder.innerHTML = qtyControl(dish);
  control.replaceWith(holder.firstElementChild);
}

/* ----------------------------------------------------- interactions */

// one delegated listener, so it survives every re-render
delegate(menuGrid, '[data-action]', 'click', (e, node) => {
  const card = node.closest('.dish-card');
  if (!card) return;

  const dish = state.dishes.find((d) => d.id === Number(card.dataset.id));
  if (!dish) return;

  switch (node.dataset.action) {
    case 'open':
      openDishModal(dish.id);
      break;

    case 'fav': {
      const on = toggleFavourite(dish.id);
      node.classList.toggle('on', on);
      node.setAttribute('aria-pressed', String(on));
      toast(on ? `Saved ${dish.name}` : `Removed ${dish.name}`, 'info', { ms: 1500 });
      break;
    }

    case 'add':
    case 'inc': {
      const result = addToCart(dish, 1);
      if (!result.ok) return toast(result.reason, 'warn');
      if (node.dataset.action === 'add') toast(`${dish.name} added`, 'ok', { ms: 1500 });
      updateCardQty(dish.id);
      break;
    }

    case 'dec':
      addToCart(dish, -1);
      updateCardQty(dish.id);
      break;

    default:
      break;
  }
});

delegate(picksStrip, '.pick-chip', 'click', (e, node) => openDishModal(Number(node.dataset.id)));

delegate(catTabs, '.cat-tab', 'click', (e, node) => {
  $$('.cat-tab', catTabs).forEach((t) => t.classList.remove('active'));
  node.classList.add('active');
  state.filters.category = node.dataset.cat;
  loadMenu();
});

/* ------------------------------------------------ search + suggest */

const runSearch = debounce(() => {
  state.filters.q = searchInput.value.trim();
  loadMenu();
}, 300);

const runSuggest = debounce(async () => {
  const q = searchInput.value.trim();
  if (q.length < 2) return hideSuggestions();

  try {
    const { suggestions } = await api.suggest(q);
    if (suggestions.length === 0) return hideSuggestions();

    render(
      suggestBox,
      suggestions
        .map(
          (s, i) => html`<button class="suggest-item" role="option" data-id="${s.id}" data-index="${i}">
              <span>${s.name}</span><span class="suggest-cat">${s.category}</span>
            </button>`
        )
        .join('')
    );

    positionSuggestions();
    suggestIndex = -1;
    show(suggestBox, true);
  } catch (e) {
    hideSuggestions();
  }
}, 180);

function positionSuggestions() {
  const rect = searchInput.getBoundingClientRect();
  suggestBox.style.position = 'fixed';
  suggestBox.style.top = `${rect.bottom + 4}px`;
  suggestBox.style.left = `${rect.left}px`;
  suggestBox.style.width = `${rect.width}px`;
  suggestBox.style.zIndex = '200';
}

function hideSuggestions() {
  show(suggestBox, false);
  suggestBox.innerHTML = '';
  suggestIndex = -1;
  suggestBox.style.position = '';
  suggestBox.style.top = '';
  suggestBox.style.left = '';
  suggestBox.style.width = '';
  suggestBox.style.zIndex = '';
}

window.addEventListener('scroll', () => {
  if (!suggestBox.hidden) positionSuggestions();
}, { passive: true });
window.addEventListener('resize', () => {
  if (!suggestBox.hidden) positionSuggestions();
});

searchInput.addEventListener('input', () => {
  runSearch();
  runSuggest();
});

searchInput.addEventListener('keydown', (e) => {
  const items = $$('.suggest-item', suggestBox);

  if (e.key === 'Escape') return hideSuggestions();
  if (items.length === 0) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggestIndex = clamp(suggestIndex + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    items.forEach((item, i) => item.classList.toggle('active', i === suggestIndex));
    return;
  }

  if (e.key === 'Enter' && suggestIndex >= 0) {
    e.preventDefault();
    items[suggestIndex].click();
  }
});

delegate(suggestBox, '.suggest-item', 'click', (e, node) => {
  hideSuggestions();
  openDishModal(Number(node.dataset.id));
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) hideSuggestions();
});

/* ---------------------------------------------------------- filters */

$('#sortSelect').addEventListener('change', (e) => {
  state.filters.sort = e.target.value;
  loadMenu();
});

delegate('.chips', '.chip[data-veg]', 'click', (e, node) => {
  $$('.chip[data-veg]').forEach((c) => c.classList.remove('active'));
  node.classList.add('active');
  state.filters.veg = node.dataset.veg;
  loadMenu();
});

$('#servedOnlyChip').addEventListener('click', (e) => {
  state.filters.servedOnly = !state.filters.servedOnly;
  e.currentTarget.classList.toggle('active', state.filters.servedOnly);
  e.currentTarget.setAttribute('aria-pressed', String(state.filters.servedOnly));
  loadMenu();
});

$('#priceRange').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  setText('#priceValue', value >= 150 ? 'Any price' : `Under ${rupees(value)}`);
  state.filters.maxPrice = value >= 150 ? '' : value;
  runPriceFilter();
});

const runPriceFilter = debounce(() => loadMenu(), 350);

loadMoreBtn.addEventListener('click', () => {
  state.page += 1;
  loadMenu({ append: true });
});

/* --------------------------------------------------- infinite scroll */

// The button still works; this just saves the person a click.
if ('IntersectionObserver' in window && sentinel) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) return;
      if (state.route !== 'menu' || !state.hasMore || loadMoreBtn.disabled) return;

      state.page += 1;
      loadMenu({ append: true });
    },
    { rootMargin: '300px' }
  );

  observer.observe(sentinel);
}

// the cart can change from the cart panel, so keep the grid in step
on('cart', ({ dishId, cleared }) => {
  if (state.route !== 'menu') return;
  if (cleared) return renderMenu();
  if (dishId) updateCardQty(dishId);
});
