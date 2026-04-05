# ProfitHunter

Extension Chrome (Manifest V3) qui automatise le sourcing d'arbitrage en ligne pour Amazon FBA.
Elle scanne les produits d'une marque sur Amazon.fr et compare automatiquement les prix chez les distributeurs français pour identifier les opportunités rentables.

## Fonctionnement

1. L'utilisateur ouvre une page Amazon.fr (résultats de recherche ou boutique de marque)
2. Il saisit le nom de la marque dans le popup (ex: `Signal`, `Luxéol`, `TRESemmé`)
3. L'extension extrait tous les produits de la page via injection de script
4. Pour chaque produit, le service worker ouvre un onglet en arrière-plan chez chaque distributeur
5. Il scrape le prix, ferme l'onglet, et retourne le résultat
6. Le popup affiche le tableau : prix Amazon / prix fournisseur / marge brute
7. L'utilisateur télécharge le CSV pour analyse dans Excel ou Google Sheets

## Installation

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (interrupteur en haut à droite)
3. Cliquer **"Charger l'extension non empaquetée"**
4. Sélectionner le dossier `profit-hunter/`
5. Épingler l'icône depuis le menu puzzle de Chrome

## Utilisation

1. Aller sur une page Amazon.fr contenant des produits de la marque visée
2. Scroller la page pour tout charger (pagination dynamique)
3. Cliquer sur l'icône ProfitHunter dans la barre d'outils
4. Saisir le nom de la marque et cliquer **"Lancer l'analyse"**
5. Attendre la progression — des onglets s'ouvrent et se ferment automatiquement
6. Cliquer **"Télécharger le CSV"** pour exporter les résultats

La dernière marque saisie est mémorisée automatiquement entre les sessions.

## Architecture

```
profit-hunter/
├── manifest.json       # Config Chrome MV3, permissions, host_permissions
├── popup.html          # Interface utilisateur (480px)
├── popup.js            # Extraction Amazon + comparaison fournisseurs + export CSV
├── background.js       # Service worker : scraping distributeurs via onglets
└── content_amazon.js   # Content script (réservé, injecté sur amazon.fr)
```

### popup.js

- Restaure la dernière marque via `chrome.storage.local`
- Injecte `extractProductsFromPage()` directement dans l'onglet Amazon actif
- **Méthode 1** : sélecteur `[data-component-type="s-search-result"]` (pages de recherche standard)
- **Méthode 2** : scrape de tous les liens `/dp/` (boutiques de marque)
- Filtre les produits dont le titre ne contient pas le nom de la marque
- Envoie un message au service worker pour chaque produit : `searchGoogleShopping`
- Filtre anti-pub : ignore les prix fournisseur < 20 % du prix Amazon
- Affiche les résultats en temps réel et génère le CSV avec BOM UTF-8

### background.js

- Reçoit le message `searchGoogleShopping` et interroge les distributeurs dans l'ordre :

| Priorité | Distributeur | URL de recherche |
|----------|-------------|-----------------|
| 1 | Carrefour | `carrefour.fr/recherche?q=...` |
| 2 | Auchan | `auchan.fr/recherche?q=...` |
| 3 | Monoprix | `monoprix.fr/recherche?q=...` |
| 4 | Fallback | Google Shopping (`google.fr/search?tbm=shop`) |

- Pour chaque distributeur : ouvre un onglet masqué, attend le chargement complet + 3 s, injecte `extractPriceFromRetailer()`, ferme l'onglet
- Stratégies d'extraction par ordre de priorité :
  1. Cards produit (sélecteurs spécifiques à chaque enseigne)
  2. Éléments de prix directs
  3. Fallback regex sur le texte brut de la page
- Retourne le prix le moins cher trouvé sur la première enseigne qui répond

## Paramètres clés

| Variable | Valeur | Description |
|----------|--------|-------------|
| `MARGE_MIN` | `3.0` | Seuil de marge brute (€) pour coloriser en vert |
| `pauseMs` | 2 000 – 5 000 ms | Pause aléatoire entre chaque requête fournisseur (anti-bot) |
| `waitMs` | `3 000` ms | Délai d'attente après chargement de l'onglet distributeur |

## Calcul de rentabilité FBA

```
Marge brute    = Prix Amazon − Prix fournisseur
Commission AMZ ≈ 15 % du prix Amazon
Frais FBA      ≈ 2,50 € à 3,50 € selon poids/taille
──────────────────────────────────────────────────
Marge nette    = Marge brute − Commission − Frais FBA
```

Viser une **marge brute > 8–10 €** pour que l'opération soit rentable en FBA.

## Export CSV

- Encodage UTF-8 avec BOM (`\uFEFF`) pour compatibilité Excel français
- Prix entre guillemets pour éviter l'interprétation comme date (ex : `"9,07"`)
- Nom de fichier : `arbitrage_<MARQUE>_<DATE>.csv`
- Colonnes : Titre Amazon, Lien Amazon, Prix Amazon (€), Titre Fournisseur, Lien Fournisseur, Prix Fournisseur (€), Marge Brute (€)

## Limitations connues

- **Matching lot/quantité** : le prix fournisseur peut correspondre à une unité alors qu'Amazon vend un lot — toujours vérifier le lien fournisseur avant d'acheter
- **Google Shopping** : bloque les onglets automatisés après un certain volume (CAPTCHA)
- **Sites distributeurs** : parfois lents à charger ou absents du catalogue
- **Taux de matching** : ~50 % en moyenne selon la marque (Luxéol ~100 %, Schmidt ~49 %, Signal ~38 %)

## Permissions requises

```json
"permissions": ["activeTab", "tabs", "scripting", "storage"]

"host_permissions": [
  "amazon.fr", "google.fr", "google.com",
  "carrefour.fr", "auchan.fr", "monoprix.fr",
  "leclerc.fr", "e.leclerc", "chronodrive.com"
]
```

## Évolutions prévues

- [ ] Intégration **SerpAPI** (remplace le scraping Google Shopping, ~50 $/mois)
- [ ] Ajout **Leclerc Drive** dans la liste des distributeurs
- [ ] Matching par **EAN/code-barres** pour une correspondance produit exacte
- [ ] Interface pour gérer plusieurs marques en file d'attente
- [ ] Calcul automatique de la marge nette après frais FBA

## Versions

| Dossier | Version | Approche |
|---------|---------|----------|
| `profit-hunter/` | **v2.0** ✅ active | Distributeurs directs + fallback Google |
| `lubido-extension-v1-google-shopping/` | v1.0 archive | Google Shopping uniquement |

---

**Auteur** : Juan Roussille — ja.roussille@gmail.com
