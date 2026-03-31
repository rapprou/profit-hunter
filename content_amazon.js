// ─────────────────────────────────────────────────────────────
//  content_amazon.js — Injecté sur les pages Amazon.fr
//  Extrait tous les produits visibles sur la page
// ─────────────────────────────────────────────────────────────

function extractAmazonProducts() {
  const products = [];
  const seen = new Set();

  // ── Méthode 1 : résultats de recherche standard ─────────────
  const resultItems = document.querySelectorAll(
    '[data-component-type="s-search-result"], div[data-asin][data-asin!=""]'
  );

  for (const item of resultItems) {
    const asin = item.getAttribute('data-asin');
    if (!asin || asin.length !== 10 || seen.has(asin)) continue;
    seen.add(asin);

    // Titre
    const titleEl = item.querySelector('h2 a span, h2 span, .a-size-base-plus, .a-size-medium');
    const title = titleEl?.innerText?.trim();
    if (!title || title.length < 8) continue;

    // Prix
    let price = null;
    const priceEl = item.querySelector('.a-price .a-offscreen, .a-price-whole');
    if (priceEl) {
      const match = priceEl.innerText.match(/(\d+[,\.]\d{2})/);
      if (match) price = parseFloat(match[1].replace(',', '.'));
    }

    products.push({
      asin,
      title,
      price,
      link: `https://www.amazon.fr/dp/${asin}`
    });
  }

  // ── Méthode 2 : page boutique de marque (widgets Amazon Store) ──
  if (products.length === 0) {
    // Sélecteurs spécifiques aux boutiques de marque Amazon
    const storeSelectors = [
      '[class*="ProductGrid"] a[href*="/dp/"]',
      '[class*="product-grid"] a[href*="/dp/"]',
      '[class*="ProductTile"] a[href*="/dp/"]',
      '[class*="ProductCard"] a[href*="/dp/"]',
      '[class*="StoreProduct"] a[href*="/dp/"]',
      'div[class*="style__"] a[href*="/dp/"]',
      '.s-product-image-container a[href*="/dp/"]',
    ];

    // Cherche d'abord via les sélecteurs boutique
    let storeLinks = [];
    for (const sel of storeSelectors) {
      storeLinks = Array.from(document.querySelectorAll(sel));
      if (storeLinks.length > 0) break;
    }

    // Fallback : tous les liens /dp/ de la page
    if (storeLinks.length === 0) {
      storeLinks = Array.from(document.querySelectorAll('a[href*="/dp/"]'));
    }

    const ignored = ['retour', 'accueil', 'suivant', 'précédent', 'panier', 'connexion', 'voir plus', 'voir tout'];

    for (const link of storeLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/dp\/([A-Z0-9]{10})/);
      if (!match) continue;
      const asin = match[1];
      if (seen.has(asin)) continue;

      // Cherche le titre — image alt, aria-label, ou texte du parent
      let title = link.getAttribute('aria-label')?.trim()
        || link.querySelector('img')?.getAttribute('alt')?.trim()
        || link.innerText?.trim();

      if (!title || title.length < 8) {
        // Remonte dans le DOM (max 5 niveaux)
        let parent = link.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!parent) break;
          // Cherche un élément texte significatif dans ce conteneur
          const textEl = parent.querySelector('span, h2, h3, p, div[class*="title"], div[class*="name"]');
          const text = textEl?.innerText?.trim();
          if (text && text.length >= 10 && !ignored.some(w => text.toLowerCase().includes(w))) {
            title = text;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (!title || title.length < 8) continue;
      if (ignored.some(w => title.toLowerCase().includes(w))) continue;

      seen.add(asin);

      // Prix dans le conteneur proche
      let price = null;
      const container = link.closest('li, article, section, div[class*="card"], div[class*="product"], div[class*="tile"]');
      if (container) {
        const priceMatch = container.innerText.match(/(\d+[,\.]\d{2})\s*€/);
        if (priceMatch) price = parseFloat(priceMatch[1].replace(',', '.'));
      }

      products.push({
        asin,
        title: title.split('\n')[0].trim().substring(0, 120),
        price,
        link: `https://www.amazon.fr/dp/${asin}`
      });
    }
  }

  return products;
}

// Écoute les messages du popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractProducts') {
    const products = extractAmazonProducts();
    sendResponse({ products });
  }
  return true;
});
