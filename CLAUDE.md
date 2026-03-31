# ProfitHunter — Extension Chrome Amazon FBA Arbitrage

## Description
Extension Chrome (Manifest V3) qui automatise le sourcing d'arbitrage en ligne pour Amazon FBA.
Elle scanne les produits d'une marque sur Amazon.fr et trouve automatiquement les prix
chez les distributeurs français (Carrefour, Auchan, Monoprix) pour identifier les opportunités rentables.

## Propriétaire
Juan Roussille — ja.roussille@gmail.com

## Architecture

```
profit-hunter/
├── manifest.json        # Config Chrome MV3, permissions, host_permissions
├── popup.html           # Interface utilisateur (480px, champ marque + tableau résultats)
├── popup.js             # Logique principale : extraction Amazon + appel fournisseurs + CSV
├── background.js        # Service worker : ouvre onglets fournisseurs, scrape les prix
└── content_amazon.js    # (réservé) Content script injecté sur amazon.fr
```

## Flux de travail

1. L'utilisateur ouvre une page Amazon.fr (résultats de recherche d'une marque)
2. Il saisit le nom de la marque dans le popup (ex: "Signal", "Luxéol")
3. L'extension injecte `extractProductsFromPage()` dans la page Amazon via `chrome.scripting.executeScript`
4. Pour chaque produit trouvé, `background.js` ouvre un onglet en arrière-plan sur les sites distributeurs
5. Il scrape le prix, ferme l'onglet, retourne le résultat
6. Le popup affiche le tableau avec Amazon price / Prix fournisseur / Marge brute
7. L'utilisateur télécharge le CSV pour analyse dans Excel/Google Sheets

## Paramètres clés (popup.js)

| Variable | Valeur | Description |
|----------|--------|-------------|
| `BRAND` | dynamique (champ UI) | Filtre les produits Amazon par nom de marque |
| `MARGE_MIN` | 3.0 | Seuil de marge brute pour coloriser en vert |

## Ordre des distributeurs interrogés (background.js)

1. **Carrefour** — `carrefour.fr/recherche?q=...`
2. **Auchan** — `auchan.fr/recherche?q=...`
3. **Monoprix** — `monoprix.fr/recherche?q=...`
4. **Fallback** — Google Shopping (`google.fr/search?q=...&tbm=shop`)

## Permissions requises (manifest.json)

- `activeTab`, `tabs`, `scripting`, `storage`
- `amazon.fr`, `google.fr`, `google.com`, `carrefour.fr`, `auchan.fr`, `leclerc.fr`, `monoprix.fr`, `chronodrive.com`

## Points techniques importants

### Extraction Amazon
- Méthode 1 : `[data-component-type="s-search-result"]` pour les pages de résultats standard
- Méthode 2 : scrape des liens `/dp/` pour les boutiques de marque
- Filtre marque : garde uniquement les produits dont le titre contient `BRAND`

### Anti-bot
- Pause aléatoire **2 à 5 secondes** entre chaque recherche fournisseur
- Filtre des liens `/aclk` et `googleadservices` (publicités Google, pas des vrais prix)
- Filtre de cohérence prix : le prix fournisseur doit être > 20% du prix Amazon

### Export CSV
- BOM (`\uFEFF`) pour compatibilité Excel français
- Prix entre guillemets pour éviter l'interprétation comme date (ex: "9,07" → pas le 7 septembre)

### Mémoire marque
- La dernière marque saisie est sauvegardée via `chrome.storage.local` (`lastBrand`)

## Calcul de rentabilité réelle (FBA)

```
Marge brute     = Prix Amazon - Prix fournisseur
Commission AMZ  ≈ 15% du prix Amazon
Frais FBA       ≈ 2,50€ à 3,50€ selon le poids/taille
─────────────────────────────────────────────────
Marge nette     = Marge brute - Commission - Frais FBA
```
Viser une **marge brute > 8-10€** pour que l'opération soit rentable en FBA.

## Limitations connues

- **Matching lot/quantité** : le prix fournisseur peut correspondre à une unité alors qu'Amazon vend un lot → toujours vérifier le lien fournisseur avant d'acheter
- **Google Shopping** : bloque les onglets automatisés après trop de requêtes (CAPTCHA)
- **Sites distributeurs** : parfois lents à charger, peuvent ne pas référencer tous les produits
- **50% de matching** en moyenne selon la marque (meilleures marques : Luxéol 100%, Schmidt 49%, Signal 38%)

## Versions archivées

| Dossier | Version | Approche |
|---------|---------|----------|
| `profit-hunter/` | v2.0 ✅ active | Distributeurs directs + fallback Google |
| `lubido-extension-v1-google-shopping/` | v1.0 📦 archive | Google Shopping uniquement |

## Évolutions prévues

- [ ] Intégration **SerpAPI** (remplace le scraping Google Shopping, ~50$/mois, 5000 req/mois)
- [ ] Ajout **Leclerc Drive** dans la liste des distributeurs
- [ ] Matching par **EAN/code-barres** pour une correspondance exacte produit
- [ ] Interface pour gérer plusieurs marques en file d'attente
- [ ] Calcul automatique de la marge nette après frais FBA

## Installation locale

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (bouton en haut à droite)
3. Cliquer **"Charger l'extension non empaquetée"**
4. Sélectionner le dossier `profit-hunter/`

## Commandes git utiles

```bash
# Voir l'historique
git log --oneline

# Ajouter des modifications et commiter
git add .
git commit -m "feat: description du changement"

# Pousser sur GitHub
git push origin main
```
