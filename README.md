# Éditeur Markdown avec lemmatisation

Éditeur Markdown avec lemmatisation française et mise en évidence des répétitions.

## Installation

1. Installer les dépendances (si nécessaire):
```bash
npm install
```

2. Builder les dictionnaires:
```bash
npm run build-dicts
```

Cette commande télécharge les dictionnaires LEFFF depuis unpkg, les traite et crée un fichier `dict-bundle.json` optimisé contenant uniquement le mapping `word_nosc → lemma`.

## Utilisation

Ouvrir `index.html` dans un navigateur ou servir les fichiers avec un serveur HTTP local:

```bash
# Avec Python
python -m http.server 8000

# Avec Node.js (http-server)
npx http-server

# Avec PHP
php -S localhost:8000
```

Puis ouvrir `http://localhost:8000` dans votre navigateur.

## Structure

- `index.html` - Page principale avec l'éditeur CodeMirror
- `main.js` - Script principal gérant l'interface et la communication avec le worker
- `build-dicts.js` - Script de build pour générer le bundle de dictionnaires
- `dict-bundle.json` - Dictionnaire bundlé (généré par `build-dicts.js`)

Le code du Web Worker est embarqué inline dans `index.html` (balise `<script id="worker-code" type="javascript/worker">`). Il n'y a plus de fichier `worker.js` séparé afin d'éviter toute divergence entre fichiers.

## Déploiement sur GitHub Pages

Ce projet est configuré pour être déployé automatiquement sur GitHub Pages via GitHub Actions.

### Configuration initiale

1. **Créer un dépôt GitHub** et pousser votre code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/VOTRE_USERNAME/lemmatizer-editor.git
   git branch -M main
   git push -u origin main
   ```

2. **Activer GitHub Pages** dans les paramètres du dépôt:
   - Allez dans `Settings` → `Pages`
   - Sous "Source", sélectionnez `Deploy from a branch`
   - Choisissez la branche `gh-pages` et le dossier `/ (root)`
   - Cliquez sur `Save`

3. **Activer GitHub Actions** (si nécessaire):
   - Allez dans `Settings` → `Actions` → `General`
   - Assurez-vous que "Allow all actions and reusable workflows" est activé

### Déploiement automatique

Le workflow GitHub Actions (`.github/workflows/deploy.yml`) se déclenche automatiquement à chaque push sur la branche `main` ou `master`. Il:
- Installe les dépendances Node.js
- Génère le fichier `dict-bundle.json`
- Déploie les fichiers statiques sur la branche `gh-pages`

Votre site sera accessible à l'adresse:
```
https://VOTRE_USERNAME.github.io/lemmatizer-editor/
```

### Déploiement manuel

Si vous préférez déployer manuellement:
```bash
npm run build-dicts
# Utilisez ensuite gh-pages ou un autre outil pour déployer
npx gh-pages -d .
```

## Notes

- Les dictionnaires sont chargés depuis `dict-bundle.json` (généré à build time)
- Les dictionnaires sont mis en cache dans IndexedDB après le premier chargement
- Le bundle doit être régénéré si vous souhaitez mettre à jour les dictionnaires
