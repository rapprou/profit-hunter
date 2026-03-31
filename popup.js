// ─────────────────────────────────────────────────────────────
//  popup.js — Logique principale du popup
//  v2 : injection directe dans la page (plus de message passing)
// ─────────────────────────────────────────────────────────────

let   BRAND     = 'Schmidt'; // sera remplacé par la saisie utilisateur
const MARGE_MIN = 3.0;

let allResults = [];

// ── Event listeners ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restaure la dernière marque saisie
  chrome.storage.local.get('lastBrand', (data) => {
    if (data.lastBrand) {
      document.getElementById('brandInput').value = data.lastBrand;
      BRAND = data.lastBrand;
    }
  });
  document.getElementById('startBtn').addEventListener('click', startAnalysis);
  document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
});

// ── Helpers UI ───────────────────────────────────────────────

function showAlert(msg, type = 'warning') {
  const el = document.getElementById('alert');
  el.textContent = msg;
  el.className = type;
  el.style.display = 'block';
}

function hideAlert() {
  document.getElementById('alert').style.display = 'none';
}

function setProgress(label, percent) {
  document.getElementById('progressSection').style.display = 'block';
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressFill').style.width = percent + '%';
}

function addRow(result) {
  const tbody = document.getElementById('resultsBody');
  const row   = tbody.insertRow();

  const amzStr = result.amazonPrice != null ? result.amazonPrice.toFixed(2) + ' €' : 'N/A';
  const supStr = result.supplierPrice != null ? result.supplierPrice.toFixed(2) + ' €' : 'N/A';

  let marginStr   = 'N/A';
  let marginClass = 'neutre';
  if (result.margin !== null && result.margin !== undefined) {
    marginStr   = (result.margin >= 0 ? '+' : '') + result.margin.toFixed(2) + ' €';
    marginClass = result.margin >= MARGE_MIN ? 'rentable' : 'faible';
  }

  row.innerHTML = `
    <td><a href="${result.link}" target="_blank" title="${result.title}">${result.title.substring(0, 32)}…</a></td>
    <td>${amzStr}</td>
    <td><a href="${result.supplierLink || '#'}" target="_blank">${supStr}</a></td>
    <td class="${marginClass}">${marginStr}</td>
  `;
}

// ── Extraction produits Amazon (injectée directement dans la page) ──
function extractProductsFromPage() {
  // Cette fonction tourne DANS la page Amazon — pas dans le popup
  const products = [];
  const seen     = new Set();

  function parsePrice(text) {
    if (!text) return null;
    const m = text.match(/(\d{1,4})[,\.](\d{2})/);
    if (m) return parseFloat(m[1] + '.' + m[2]);
    return null;
  }

  // ── Méthode 1 : résultats de recherche standard ───────────
  const searchItems = document.querySelectorAll('[data-component-type="s-search-result"]');
  for (const item of searchItems) {
    const asin = item.getAttribute('data-asin');
    if (!asin || asin.length !== 10 || seen.has(asin)) continue;
    seen.add(asin);

    const titleEl = item.querySelector('h2 a span, h2 span, .a-size-base-plus');
    const title   = titleEl?.innerText?.trim();
    if (!title || title.length < 5) continue;

    const priceEl = item.querySelector('.a-price .a-offscreen, .a-price-whole');
    const price   = parsePrice(priceEl?.innerText);

    const linkEl = item.querySelector('h2 a');
    const href   = linkEl?.getAttribute('href') || `/dp/${asin}`;
    const link   = href.startsWith('http') ? href : `https://www.amazon.fr${href}`;

    products.push({ asin, title, price, link: `https://www.amazon.fr/dp/${asin}` });
  }

  // ── Méthode 2 : boutique de marque (tous les liens /dp/) ───
  if (products.length === 0) {
    const allLinks   = document.querySelectorAll('a[href*="/dp/"]');
    const skipWords  = ['retour', 'accueil', 'suivant', 'panier', 'connexion', 'voir plus', 'voir tout', 'comparer'];

    for (const link of allLinks) {
      const href  = link.getAttribute('href') || '';
      const match = href.match(/\/dp\/([A-Z0-9]{10})/);
      if (!match) continue;
      const asin = match[1];
      if (seen.has(asin)) continue;

      // Titre : aria-label > alt de l'image > texte du lien > texte du parent
      let title = link.getAttribute('aria-label')?.trim()
        || link.querySelector('img')?.getAttribute('alt')?.trim()
        || link.innerText?.trim();

      if (!title || title.length < 6) {
        let el = link.parentElement;
        for (let i = 0; i < 6 && el; i++) {
          const candidate = el.querySelector('span[class*="title"], h2, h3, [class*="label"], [class*="name"]');
          const t = candidate?.innerText?.trim() || el.innerText?.split('\n').find(l => l.trim().length > 6)?.trim();
          if (t && t.length >= 6 && !skipWords.some(w => t.toLowerCase().includes(w))) {
            title = t;
            break;
          }
          el = el.parentElement;
        }
      }

      if (!title || title.length < 6) continue;
      if (skipWords.some(w => title.toLowerCase().includes(w))) continue;

      seen.add(asin);

      // Prix : cherche dans le conteneur parent proche
      let price = null;
      const container = link.closest('li, article, [class*="card"], [class*="product"], [class*="tile"], [class*="item"]');
      if (container) price = parsePrice(container.innerText.match(/(\d{1,4}[,\.]\d{2})\s*€/)?.[1]);

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

// ── Analyse principale ───────────────────────────────────────

async function startAnalysis() {
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Analyse en cours…';
  hideAlert();
  allResults = [];
  document.getElementById('resultsBody').innerHTML = '';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('downloadBtn').style.display = 'none';

  try {
    // 0. Lit la marque saisie dans le champ
    const brandInput = document.getElementById('brandInput').value.trim();
    if (!brandInput) {
      showAlert('⚠️ Saisis le nom de la marque avant de lancer.', 'error');
      btn.disabled = false;
      btn.textContent = '🔍 Lancer l\'analyse';
      return;
    }
    BRAND = brandInput;
    chrome.storage.local.set({ lastBrand: BRAND }); // mémorise pour la prochaine fois

    // 1. Onglet actif
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url?.includes('amazon.fr')) {
      showAlert(`⚠️ Ouvrez une page Amazon.fr avec des produits ${BRAND}, puis relancez.`, 'error');
      btn.disabled = false;
      btn.textContent = '🔍 Lancer l\'analyse';
      return;
    }

    // 2. Injection directe dans la page — plus fiable que les messages
    setProgress('Extraction des produits Amazon…', 8);

    const injectionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractProductsFromPage
    });

    const products = injectionResult?.[0]?.result || [];

    if (products.length === 0) {
      showAlert('⚠️ Aucun produit trouvé. Scrollez la page pour tout charger, puis relancez.', 'warning');
      btn.disabled = false;
      btn.textContent = '🔍 Lancer l\'analyse';
      return;
    }

    // Filtre : garde uniquement les produits de la bonne marque
    const brandLower    = BRAND.toLowerCase();
    const brandProducts = products.filter(p => p.title.toLowerCase().includes(brandLower));

    const finalProducts = brandProducts.length > 0 ? brandProducts : products;

    setProgress(`${finalProducts.length} produits ${BRAND} trouvés — recherche fournisseurs…`, 15);
    document.getElementById('resultsSection').style.display = 'block';

    // 3. Google Shopping pour chaque produit
    for (let i = 0; i < finalProducts.length; i++) {
      const product  = finalProducts[i];
      const progress = 15 + Math.round(((i + 1) / finalProducts.length) * 80);
      setProgress(`[${i + 1}/${finalProducts.length}] ${product.title.substring(0, 45)}…`, progress);

      // Construit une requête précise pour matcher le bon produit
      const titleSansMarque = product.title.replace(new RegExp(`^${BRAND}\\s+`, 'i'), '').trim();
      // Extrait la taille/lot du titre pour un meilleur matching (ex: "lot de 4", "250ml", "75ml x6")
      const lotMatch  = product.title.match(/lot\s+de\s+\d+|pack\s+of\s+\d+|\d+\s*x\s*\d+\s*ml|\d+\s*ml|\d+\s*g/i);
      const lotInfo   = lotMatch ? lotMatch[0] : '';
      const baseQuery = `${BRAND} ${titleSansMarque.substring(0, 60)} ${lotInfo}`.trim();
      const query     = baseQuery.substring(0, 100);
      // Pause aléatoire entre 2 et 5 secondes pour éviter la détection bot
      const pauseMs = 2000 + Math.floor(Math.random() * 3000);
      await new Promise(r => setTimeout(r, pauseMs));
      const shopping = await chrome.runtime.sendMessage({ action: 'searchGoogleShopping', query });

      const amazonPrice   = product.price;
      // Filtre anti-pub : ignore les prix fournisseur invraisemblables
      // (ex: 0,99€ pour un lot à 43€ = c'est une pub Google, pas un vrai fournisseur)
      let supplierPrice = shopping?.price ?? null;
      if (supplierPrice != null && amazonPrice != null) {
        const ratioMin = 0.20; // prix fournisseur doit être > 20% du prix Amazon
        if (supplierPrice < amazonPrice * ratioMin) supplierPrice = null;
      }
      const margin = (amazonPrice != null && supplierPrice != null)
        ? Math.round((amazonPrice - supplierPrice) * 100) / 100
        : null;

      // Extrait le nom du domaine comme nom fournisseur (ex: "www.carrefour.fr" → "Carrefour")
      let supplierName = shopping?.title || 'Non trouvé';
      if (shopping?.link) {
        try {
          const host = new URL(shopping.link).hostname.replace('www.', '');
          const domain = host.split('.')[0];
          supplierName = domain.charAt(0).toUpperCase() + domain.slice(1);
        } catch (e) {}
      }

      const result = {
        title:         product.title,
        link:          product.link,
        amazonPrice,
        supplierTitle: supplierPrice != null ? supplierName : 'Non trouvé',
        supplierLink:  shopping?.link  || '',
        supplierPrice,
        margin
      };

      allResults.push(result);
      addRow(result);
    }

    // 4. Fin
    setProgress('✅ Analyse terminée !', 100);
    const rentables = allResults.filter(r => r.margin != null && r.margin >= MARGE_MIN);
    document.getElementById('resultsHeader').textContent =
      `${allResults.length} produits • ${rentables.length} rentables (marge ≥ ${MARGE_MIN} €)`;
    document.getElementById('downloadBtn').style.display = 'block';
    btn.textContent = '🔄 Relancer';
    btn.disabled = false;

  } catch (err) {
    showAlert(`Erreur : ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = '🔍 Lancer l\'analyse';
  }
}

// ── Export CSV ───────────────────────────────────────────────

function downloadCSV() {
  const headers = ['Titre Amazon', 'Lien Amazon', 'Prix Amazon (€)', 'Titre Fournisseur', 'Lien Fournisseur', 'Prix Fournisseur (€)', 'Marge Brute (€)'];
  // Force le format texte pour les prix (évite qu'Excel les lise comme des dates)
  const fmtPrice = v => v != null ? `"${String(v).replace('.', ',')}"` : '""';
  const rows = allResults.map(r => [
    `"${(r.title         || '').replace(/"/g, '""')}"`,
    `"${r.link           || ''}"`,
    fmtPrice(r.amazonPrice),
    `"${(r.supplierTitle || '').replace(/"/g, '""')}"`,
    `"${r.supplierLink   || ''}"`,
    fmtPrice(r.supplierPrice),
    fmtPrice(r.margin)
  ]);

  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `arbitrage_${BRAND}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
