#!/usr/bin/env node
/**
 * Script de build pour télécharger et bundler les dictionnaires LEFFF.
 * Ce script télécharge les dictionnaires depuis unpkg, les traite et
 * crée un fichier JSON optimisé contenant uniquement le mapping
 * word_nosc -> lemma.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DICT_NAMES = ['adj', 'adv', 'art', 'conj', 'nom', 'ono', 'pre', 'ver', 'pro'];
const DICT_BASE_URL = 'https://unpkg.com/nlp-js-tools-french@1.0.9/dict/';
const OUTPUT_FILE = path.join(__dirname, 'dict-bundle.json');

/**
 * Télécharge un fichier depuis une URL
 */
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Extrait le tableau lexi depuis un fichier JS
 */
function extractLexiArray(jsText) {
  // Chercher le début du tableau: lexi: [
  const lexiStart = jsText.indexOf('lexi:');
  if (lexiStart === -1) {
    throw new Error('lexi property not found');
  }
  
  // Trouver l'ouverture du tableau [
  let arrayStart = jsText.indexOf('[', lexiStart);
  if (arrayStart === -1) {
    throw new Error('Array start not found');
  }
  
  // Compter les crochets pour trouver la fin du tableau
  let depth = 0;
  let inString = false;
  let stringChar = null;
  let escapeNext = false;
  let arrayEnd = -1;
  
  for (let i = arrayStart; i < jsText.length; i++) {
    const char = jsText[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      continue;
    }
    
    if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      continue;
    }
    
    if (!inString) {
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          arrayEnd = i + 1;
          break;
        }
      }
    }
  }
  
  if (arrayEnd === -1) {
    throw new Error('Array end not found');
  }
  
  // Extraire et parser le tableau
  let arrayContent = jsText.slice(arrayStart, arrayEnd);
  // Nettoyer les trailing commas
  arrayContent = arrayContent.replace(/,(\s*[}\]])/g, '$1');
  
  try {
    return JSON.parse(arrayContent);
  } catch (err) {
    // Si JSON.parse échoue, essayer avec eval (en Node.js c'est sûr)
    // eslint-disable-next-line no-eval
    return eval('(' + arrayContent + ')');
  }
}

/**
 * Normalise une chaîne (minuscules, sans diacritiques)
 */
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Traite un dictionnaire et retourne le mapping word_nosc -> lemma
 */
async function processDictionary(name) {
  console.log(`Téléchargement de ${name}...`);
  const url = `${DICT_BASE_URL}${name}.js`;
  const jsText = await fetch(url);
  
  console.log(`  Extraction du tableau lexi...`);
  const entries = extractLexiArray(jsText);
  console.log(`  ${entries.length} entrées trouvées`);
  
  console.log(`  Construction du mapping...`);
  const map = new Map();
  for (const entry of entries) {
    const key = entry.word_nosc;
    if (key && !map.has(key)) {
      map.set(key, entry.lemma);
    }
  }
  
  console.log(`  ${map.size} entrées uniques dans le mapping`);
  return map;
}

/**
 * Fonction principale
 */
async function main() {
  console.log('Build des dictionnaires LEFFF...\n');
  
  const allMappings = new Map();
  
  for (const name of DICT_NAMES) {
    try {
      const mapping = await processDictionary(name);
      // Fusionner dans le mapping global (les clés déjà présentes sont conservées)
      for (const [key, value] of mapping) {
        if (!allMappings.has(key)) {
          allMappings.set(key, value);
        }
      }
      console.log('');
    } catch (err) {
      console.error(`Erreur lors du traitement de ${name}:`, err.message);
      process.exit(1);
    }
  }
  
  console.log(`Total: ${allMappings.size} entrées uniques\n`);
  
  // Convertir en format sérialisable
  const bundle = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    entries: Array.from(allMappings.entries())
  };
  
  console.log(`Écriture dans ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bundle, null, 2), 'utf8');
  
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeKB = (stats.size / 1024).toFixed(2);
  console.log(`✓ Bundle créé: ${sizeKB} KB`);
  console.log('\n✓ Build terminé avec succès!');
}

main().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});

