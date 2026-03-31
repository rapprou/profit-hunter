// ─────────────────────────────────────────────────────────────
//  background.js — Service Worker v2
//  Cherche le prix sur les distributeurs FR : Carrefour, Leclerc, Auchan
//  Évite Google Shopping qui bloque les onglets automatisés.
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'searchGoogleShopping') {
    searchOnRetailers(message.query)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ── Liste des distributeurs à interroger dans l'ordre ────────
const RETAILERS = [
  {
    name: 'Carrefour',
    buildUrl: (q) => `https://www.carrefour.fr/recherche?q=${encodeURIComponent(q)}`,
    waitMs: 3000,
  },
  {
    name: 'Auchan',
    buildUrl: (q) => `https://www.auchan.fr/recherche?q=${encodeURIComponent(q)}`,
    waitMs: 3000,
  },
  {
    name: 'Monoprix',
    buildUrl: (q) => `https://www.monoprix.fr/recherche?q=${encodeURIComponent(q)}`,
    waitMs: 3000,
  },
];

async function searchOnRetailers(query) {
  for (const retailer of RETAILERS) {
    const url = retailer.buildUrl(query);
    try {
      const result = await searchViaTab(url, retailer.waitMs, retailer.name);
      if (result && result.price != null) return result;
    } catch (e) {
      // Passe au distributeur suivant si erreur
    }
  }
  // Fallback final : Google Shopping (peut retourner CAPTCHA, mais vaut mieux qu'un null)
  const gUrl = `https://www.google.fr/search?q=${encodeURIComponent(query)}&tbm=shop&hl=fr&gl=fr`;
  try {
    const r = await searchViaTab(gUrl, 4000, 'Google Shopping');
    if (r && r.price != null) return r;
  } catch (e) {}
  return { price: null, title: 'Non trouvé', link: '' };
}

// ── Ouvre un onglet, attend le chargement, injecte le scraper ─
function searchViaTab(url, waitMs, retailerName) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);

        setTimeout(() => {
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, func: extractPriceFromRetailer, args: [retailerName] },
            (results) => {
              chrome.tabs.remove(tab.id);
              const result = results?.[0]?.result;
              resolve(result || null);
            }
          );
        }, waitMs);
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// ── Injectée dans chaque onglet distributeur ─────────────────
function extractPriceFromRetailer(retailerName) {

  function parsePrice(text) {
    if (!text) return null;
    const m = text.match(/(\d[\d\s]*[,\.]?\d{0,2})\s*€/);
    if (!m) return null;
    const clean = m[1].replace(/\s/g, '').replace(',', '.');
    const val = parseFloat(clean);
    return (val > 0.5 && val < 10000) ? val : null;
  }

  // Sélecteurs communs aux grands e-commerçants FR
  const cardSelectors = [
    // Carrefour
    '[data-testid="product-card"]',
    '.product-card',
    '.product-thumbnail',
    // Auchan
    '.product-item',
    '.auchan-product-card',
    '[class*="ProductCard"]',
    '[class*="product-card"]',
    // Monoprix
    '.product-hit',
    '.product-list-item',
    // Generic
    'li[class*="product"]',
    'article[class*="product"]',
    '[class*="product"][class*="item"]',
  ];

  const priceSelectors = [
    // Carrefour
    '.product-price__amount',
    '[data-testid="price"]',
    // Auchan
    '.product-price',
    '.price-number',
    '[class*="Price"]',
    '[class*="price"]',
    // Monoprix / Intermarché
    '.product__price',
    '.price',
    // Generic
    '[aria-label*="prix"]',
    '[aria-label*="price"]',
  ];

  const results = [];

  // ── Stratégie 1 : product cards ──────────────────────────
  let cards = [];
  for (const sel of cardSelectors) {
    cards = Array.from(document.querySelectorAll(sel));
    if (cards.length >= 1) break;
  }

  for (const card of cards.slice(0, 8)) {
    const text = card.innerText || '';
    if (!text.includes('€')) continue;
    const price = parsePrice(text);
    if (!price) continue;

    const titleEl = card.querySelector('h2, h3, h4, [class*="title"], [class*="name"], [class*="label"]');
    const title = titleEl?.innerText?.trim() || text.split('\n').find(l => l.length > 5 && !l.includes('€')) || retailerName;

    const linkEl = card.querySelector('a[href]');
    results.push({ price, title: title.substring(0, 100), link: linkEl?.href || window.location.href });
  }

  // ── Stratégie 2 : éléments de prix directs ───────────────
  if (results.length === 0) {
    for (const sel of priceSelectors) {
      const priceEls = Array.from(document.querySelectorAll(sel));
      for (const el of priceEls.slice(0, 5)) {
        const price = parsePrice(el.innerText);
        if (!price) continue;

        let title = retailerName;
        let parent = el.parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          const t = parent.querySelector('h2, h3, h4, [class*="title"]');
          if (t?.innerText?.trim().length > 5) { title = t.innerText.trim(); break; }
          parent = parent.parentElement;
        }
        const linkEl = el.closest('a') || el.parentElement?.querySelector('a[href]');
        results.push({ price, title: title.substring(0, 100), link: linkEl?.href || window.location.href });
      }
      if (results.length > 0) break;
    }
  }

  // ── Stratégie 3 : fallback texte brut ────────────────────
  if (results.length === 0) {
    const allText = document.body.innerText;
    const priceMatches = [...allText.matchAll(/(\d{1,4}[,\.]\d{2})\s*€/g)];
    for (const m of priceMatches) {
      const price = parseFloat(m[1].replace(',', '.'));
      if (price >= 0.5 && price < 10000) {
        return { price, title: retailerName, link: window.location.href };
      }
    }
    return null;
  }

  // Retourne le moins cher
  results.sort((a, b) => a.price - b.price);
  return results[0];
}
