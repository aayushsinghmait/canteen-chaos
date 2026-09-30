// logic/search.js
// Ranking dishes for a search box. Kept out of the route so it can be
// tested on its own.

const STOP_WORDS = new Set(['the', 'a', 'an', 'with', 'and', 'of']);

/** "Chilli  Paneer!" -> ["chilli", "paneer"] */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * How well does one dish match the query? Higher is better, 0 means no match.
 *
 * name starts with the term   +10
 * a word in the name starts with it  +6
 * name contains it            +4
 * category matches            +3
 * a tag matches               +2
 * small nudges for available, in-slot and well rated dishes
 */
function scoreDish(dish, terms) {
  if (terms.length === 0) return 1;

  const name = dish.name.toLowerCase();
  const words = name.split(/\s+/);
  const category = dish.category.toLowerCase();
  const tags = (dish.tags || []).map((t) => t.toLowerCase());

  let score = 0;
  let matchedAll = true;

  terms.forEach((term) => {
    let best = 0;

    if (name.startsWith(term)) best = 10;
    else if (words.some((w) => w.startsWith(term))) best = 6;
    else if (name.includes(term)) best = 4;
    else if (category.startsWith(term)) best = 3;
    else if (tags.some((t) => t.includes(term))) best = 2;

    if (best === 0) matchedAll = false;
    score += best;
  });

  // every term has to hit something, otherwise "paneer pizza" matches paneer
  if (!matchedAll) return 0;

  if (dish.stock > 0) score += 1;
  score += Math.min(dish.rating, 5) / 10;

  return score;
}

/** Search + rank. Returns dishes, best first. */
function searchDishes(menu, query) {
  const terms = tokenize(query);
  if (terms.length === 0) return menu.slice();

  return menu
    .map((dish) => ({ dish, score: scoreDish(dish, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.dish.name.localeCompare(b.dish.name))
    .map((row) => row.dish);
}

/** Short list for the suggestions dropdown. */
function suggest(menu, query, limit = 6) {
  return searchDishes(menu, query)
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name, category: d.category, price: d.price }));
}

const SORTERS = {
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  'rating-desc': (a, b) => b.rating - a.rating,
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'prep-asc': (a, b) => a.prepMinutes - b.prepMinutes,
  popular: (a, b) => (b.orderCount || 0) - (a.orderCount || 0),
  default: (a, b) => Number(b.orderable) - Number(a.orderable) || a.id - b.id,
};

function sortDishes(dishes, sort) {
  const fn = SORTERS[sort] || SORTERS.default;
  return dishes.slice().sort(fn);
}

/** Cut a list into one page and say whether there is another. */
function paginate(list, page = 1, limit = 12) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(48, Math.max(1, parseInt(limit, 10) || 12));
  const start = (pageNum - 1) * perPage;
  const items = list.slice(start, start + perPage);

  return {
    items,
    page: pageNum,
    limit: perPage,
    total: list.length,
    pages: Math.ceil(list.length / perPage) || 1,
    hasMore: start + perPage < list.length,
  };
}

module.exports = { tokenize, scoreDish, searchDishes, suggest, sortDishes, paginate, SORTERS };
