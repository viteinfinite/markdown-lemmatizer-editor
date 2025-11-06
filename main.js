/*
 * Script principal pour l'éditeur Markdown avec lemmatisation et
 * mise en évidence des répétitions.  Ce script installe un
 * éditeur CodeMirror 5 dans un conteneur, crée un Web Worker à
 * partir du code inclus dans un élément <script id="worker-code">
 * de la page et gère l'échange de messages pour mettre en surbrillance
 * les mots dont le lemme apparaît trop souvent.
 */

// Attendre que le DOM soit prêt pour que l'élément <script id="worker-code">
// soit présent dans la page.  L'ensemble du code d'initialisation est
// encapsulé dans cet écouteur.
window.addEventListener('DOMContentLoaded', () => {
  // Système de logging amélioré avec niveaux de log
  const LogLevel = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
    DEBUG: 'DEBUG'
  };

  function log(level, msg, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level}: ${msg}`;

    try {
      switch (level) {
        case LogLevel.ERROR:
          console.error(logMessage, data);
          break;
        case LogLevel.WARN:
          console.warn(logMessage, data);
          break;
        case LogLevel.DEBUG:
          console.debug(logMessage, data);
          break;
        default:
          console.log(logMessage, data);
      }
    } catch (e) {
      /* la console peut ne pas être disponible */
    }

    // Afficher les erreurs dans l'interface utilisateur
    if (level === LogLevel.ERROR) {
      const errorEl = document.getElementById('errorMessage');
      if (errorEl) {
        errorEl.textContent = msg;
      }
    }
  }

  function logInfo(msg, data) { log(LogLevel.INFO, msg, data); }
  function logWarn(msg, data) { log(LogLevel.WARN, msg, data); }
  function logError(msg, data) { log(LogLevel.ERROR, msg, data); }
  function logDebug(msg, data) { log(LogLevel.DEBUG, msg, data); }

  // Fonctions de gestion de l'interface utilisateur
  function updateProgress(percent, status) {
    const progressFill = document.getElementById('progressFill');
    const statusText = document.getElementById('statusText');
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (statusText) statusText.textContent = status;
    logDebug(`Progress: ${percent}% - ${status}`);
  }

  function updateStats(wordCount, highlightCount) {
    const statsEl = document.getElementById('stats');
    if (statsEl) {
      statsEl.textContent = `Mots: ${wordCount} | Répétitions: ${highlightCount}`;
    }
    logInfo(`Stats updated: ${wordCount} words, ${highlightCount} repetitions`);
  }

  function clearError() {
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.textContent = '';
  }

  function setButtonEnabled(enabled) {
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.disabled = !enabled;
  }

  // Validation de la taille du texte pour éviter les stack overflows
  function validateTextSize(text) {
    const MAX_CHARS = 100000; // 100k caractères
    const MAX_WORDS = 50000;  // 50k mots

    logDebug(`Validating text size: ${text.length} characters`);

    if (text.length > MAX_CHARS) {
      const error = `Texte trop long (${text.length} caractères). Maximum autorisé: ${MAX_CHARS}`;
      logError(error);
      throw new Error(error);
    }

    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount > MAX_WORDS) {
      const error = `Trop de mots (${wordCount}). Maximum autorisé: ${MAX_WORDS}`;
      logError(error);
      throw new Error(error);
    }

    logInfo(`Text validation passed: ${text.length} chars, ${wordCount} words`);
    return { charCount: text.length, wordCount };
  }

  logInfo('DOM loaded, initializing application');

  // Créer et insérer un textarea dans le conteneur #editor.  Ce
  // textarea est transformé en une instance CodeMirror.
  const editorContainer = document.getElementById('editor');
  if (!editorContainer) {
    logError('Editor container not found');
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.style.height = '100%';
  textarea.style.width = '100%';
  editorContainer.appendChild(textarea);

  logInfo('Text area inserted into DOM');

  const CodeMirrorInstance = window.CodeMirror;
  if (!CodeMirrorInstance) {
    logError('CodeMirror not available on window');
    return;
  }

  const editor = CodeMirrorInstance.fromTextArea(textarea, {
    mode: 'markdown',
    theme: 'eclipse',
    lineNumbers: true,
    lineWrapping: true,
  });

  // Occuper tout l'espace disponible du conteneur
  editor.setSize(null, '100%');

  logInfo('CodeMirror editor instantiated successfully');

  // Construction du Web Worker à partir du contenu textuel d'un
  // élément <script id="worker-code">.  Cela évite les
  // problèmes de chargement avec le schéma file:// ou les CORS.
  const workerScriptEl = document.getElementById('worker-code');
  let worker = null;

  if (workerScriptEl) {
    const workerCode = workerScriptEl.textContent;
    try {
      logDebug('Creating Web Worker from embedded code');
      // Replace relative URL with absolute URL for dict-bundle.json
      // This is necessary because Blob URLs don't resolve relative paths correctly
      const dictBundleUrl = new URL('./dict-bundle.json', window.location.href).href;
      const modifiedWorkerCode = workerCode.replace(
        /const DICT_BUNDLE_URL = ['"]\.\/dict-bundle\.json['"];/,
        `const DICT_BUNDLE_URL = '${dictBundleUrl}';`
      );
      const blob = new Blob([modifiedWorkerCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      logInfo('Web Worker initialized successfully');
    } catch (err) {
      logError('Failed to create Web Worker', err);
    }
  } else {
    logError('Element <script id="worker-code"> not found');
  }

  // Tableau de marques courantes pour pouvoir les effacer avant de
  // créer de nouvelles surbrillances.
  let currentMarks = [];
  let isAnalyzing = false;
  
  // Stocker les données d'analyse pour la gestion du focus
  let allHighlights = []; // [{start, end, heat, lemma}, ...]
  let lemmaToMarksMap = new Map(); // Map<lemma, Array<mark>>
  let focusedLemma = null; // Lemme actuellement mis en focus (null = tous visibles)
  
  // Références aux éléments de la sidebar
  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebarContent');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  
  // Fonction pour basculer la sidebar
  function toggleSidebar() {
    if (sidebar) {
      sidebar.classList.toggle('hidden');
      if (sidebarToggleBtn) {
        sidebarToggleBtn.textContent = sidebar.classList.contains('hidden') 
          ? 'Afficher les répétitions' 
          : 'Masquer les répétitions';
      }
    }
  }
  
  // Fonction pour mettre en focus un lemme spécifique (masquer les autres)
  function focusLemma(lemma) {
    focusedLemma = lemma;
    
    // Effacer tous les marks
    currentMarks.forEach(mark => mark.clear());
    currentMarks = [];
    lemmaToMarksMap.clear();
    
    // Recréer uniquement les marks du lemme ciblé
    allHighlights.forEach(({ start, end, heat, lemma: highlightLemma }) => {
      if (highlightLemma === lemma) {
        try {
          const from = editor.posFromIndex(start);
          const to = editor.posFromIndex(end);
          const heatLevel = Math.min(heat || 1, 5);
          const className = `heat-${heatLevel}`;
          const mark = editor.markText(from, to, { className });
          currentMarks.push(mark);
          
          if (!lemmaToMarksMap.has(lemma)) {
            lemmaToMarksMap.set(lemma, []);
          }
          lemmaToMarksMap.get(lemma).push(mark);
        } catch (err) {
          logError(`Failed to restore highlight at position ${start}-${end}`, err);
        }
      }
    });
    
    // Mettre à jour l'apparence des items de la sidebar
    updateSidebarItemStates();
    
    // Naviguer vers la première occurrence
    const firstHighlight = allHighlights.find(h => h.lemma === lemma);
    if (firstHighlight) {
      const pos = editor.posFromIndex(firstHighlight.start);
      editor.setCursor(pos);
      editor.scrollIntoView(pos);
    }
  }
  
  // Fonction pour restaurer tous les highlights
  function clearFocus() {
    focusedLemma = null;
    
    // Effacer tous les marks actuels
    currentMarks.forEach(mark => mark.clear());
    currentMarks = [];
    lemmaToMarksMap.clear();
    
    // Restaurer tous les highlights
    allHighlights.forEach(({ start, end, heat }) => {
      try {
        const from = editor.posFromIndex(start);
        const to = editor.posFromIndex(end);
        const heatLevel = Math.min(heat || 1, 5);
        const className = `heat-${heatLevel}`;
        const mark = editor.markText(from, to, { className });
        currentMarks.push(mark);
        
        // Ajouter à la map par lemme
        const highlight = allHighlights.find(h => 
          h.start === start && h.end === end
        );
        if (highlight && highlight.lemma) {
          if (!lemmaToMarksMap.has(highlight.lemma)) {
            lemmaToMarksMap.set(highlight.lemma, []);
          }
          lemmaToMarksMap.get(highlight.lemma).push(mark);
        }
      } catch (err) {
        logError(`Failed to restore highlight at position ${start}-${end}`, err);
      }
    });
    
    // Mettre à jour l'apparence des items de la sidebar
    updateSidebarItemStates();
  }
  
  // Fonction pour mettre à jour l'état visuel des items de la sidebar
  function updateSidebarItemStates() {
    if (!sidebarContent) return;
    
    sidebarContent.querySelectorAll('.lemma-item').forEach(item => {
      const lemma = item.dataset.lemma;
      if (focusedLemma === lemma) {
        item.classList.add('focused');
        item.classList.remove('dimmed');
      } else if (focusedLemma !== null) {
        item.classList.add('dimmed');
        item.classList.remove('focused');
      } else {
        item.classList.remove('focused', 'dimmed');
      }
    });
    
    // Mettre à jour le bouton de réinitialisation
    const clearBtn = document.getElementById('clearFocusBtn');
    if (focusedLemma !== null) {
      if (!clearBtn) {
        // Créer le bouton s'il n'existe pas
        const button = document.createElement('button');
        button.id = 'clearFocusBtn';
        button.className = 'clear-focus-button';
        button.textContent = 'Afficher tous les mots';
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          clearFocus();
        });
        sidebarContent.insertBefore(button, sidebarContent.firstChild);
      }
    } else {
      // Supprimer le bouton s'il existe
      if (clearBtn) {
        clearBtn.remove();
      }
    }
  }
  
  // Fonction pour afficher les fréquences de lemmes dans la sidebar
  function displayLemmaFrequencies(lemmaFrequencies) {
    if (!sidebarContent) return;
    
    if (!lemmaFrequencies || lemmaFrequencies.length === 0) {
      sidebarContent.innerHTML = '<p style="padding: 1rem; color: #6c757d; text-align: center;">Aucune répétition détectée</p>';
      return;
    }
    
    const html = lemmaFrequencies.map(({ lemma, frequency, heat }) => {
      const heatLevel = Math.min(heat || 1, 5);
      const focusedClass = focusedLemma === lemma ? ' focused' : '';
      const dimmedClass = focusedLemma !== null && focusedLemma !== lemma ? ' dimmed' : '';
      return `
        <div class="lemma-item heat-${heatLevel}${focusedClass}${dimmedClass}" data-lemma="${lemma}">
          <span class="lemma-text">${lemma}</span>
          <span class="lemma-frequency">${frequency}</span>
        </div>
      `;
    }).join('');
    
    sidebarContent.innerHTML = html;
    
    // Ajouter des écouteurs de clic pour naviguer vers les occurrences et mettre en focus
    sidebarContent.querySelectorAll('.lemma-item').forEach(item => {
      item.addEventListener('click', () => {
        const lemma = item.dataset.lemma;
        if (focusedLemma === lemma) {
          // Si déjà en focus, réinitialiser
          clearFocus();
        } else {
          // Sinon, mettre en focus ce lemme
          focusLemma(lemma);
        }
      });
    });
    
    // Mettre à jour l'état visuel après création
    updateSidebarItemStates();
  }

  // Fonction d'analyse explicite
  function performAnalysis() {
    if (isAnalyzing) {
      logWarn('Analysis already in progress, ignoring request');
      return;
    }

    if (!worker) {
      logError('Cannot analyze: Web Worker not available');
      return;
    }

    try {
      const text = editor.getValue();
      logInfo(`Starting analysis of text with ${text.length} characters`);

      // Validation de la taille
      const { charCount, wordCount } = validateTextSize(text);

      if (charCount === 0) {
        logWarn('Empty text, skipping analysis');
        updateStats(0, 0);
        return;
      }

      // Mise à jour de l'interface
      isAnalyzing = true;
      setButtonEnabled(false);
      clearError();
      updateProgress(5, 'Début de l\'analyse...');
      updateStats(wordCount, 0);

      // Envoyer le texte au worker (le worker gère maintenant la progression)
      logDebug('Sending text to Web Worker for analysis');
      worker.postMessage({ text });

    } catch (error) {
      logError('Analysis failed', error);
      isAnalyzing = false;
      setButtonEnabled(true);
      updateProgress(0, 'Erreur');
    }
  }

  // Gestionnaire du bouton d'analyse
  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', performAnalysis);
    logInfo('Analyze button event listener attached');
  } else {
    logError('Analyze button not found');
  }

  // Configuration du worker pour recevoir les résultats
  if (worker) {
    worker.onmessage = (e) => {
      logDebug('Received message from Web Worker', e.data);

      try {
        const data = e.data;

        // Gérer les messages de progression
        if (data.type === 'progress') {
          updateProgress(data.progress, data.message || 'Analyse en cours...');
          return;
        }

        // Gérer les erreurs du worker
        if (data.type === 'error') {
          logError('Worker reported error', data.error);
          updateProgress(0, 'Erreur d\'analyse');
          isAnalyzing = false;
          setButtonEnabled(true);
          return;
        }

        // Gérer la completion de l'analyse
        if (data.type === 'complete') {
          const highlights = data.highlights || [];
          const lemmaFrequencies = data.lemmaFrequencies || [];
          const statsFromWorker = data.stats || {};

          // Effacer les marques existantes et réinitialiser le focus
          logDebug(`Clearing ${currentMarks.length} existing marks`);
          currentMarks.forEach((mark) => mark.clear());
          currentMarks = [];
          lemmaToMarksMap.clear();
          allHighlights = [];
          focusedLemma = null;

          // Le worker envoie maintenant le lemme avec chaque highlight
          const editorText = editor.getValue();
          
          // Appliquer les nouvelles surbrillances avec niveaux de chaleur et lemmes
          logDebug(`Applying ${highlights.length} new highlights`);
          highlights.forEach(({ start, end, heat, lemma }) => {
            try {
              const from = editor.posFromIndex(start);
              const to = editor.posFromIndex(end);
              const heatLevel = Math.min(heat || 1, 5);
              const className = `heat-${heatLevel}`;
              const mark = editor.markText(from, to, { className });
              currentMarks.push(mark);
              
              // Stocker avec le lemme (qui vient maintenant directement du worker)
              allHighlights.push({ start, end, heat, lemma: lemma || null });
              
              // Ajouter à la map par lemme
              if (lemma) {
                if (!lemmaToMarksMap.has(lemma)) {
                  lemmaToMarksMap.set(lemma, []);
                }
                lemmaToMarksMap.get(lemma).push(mark);
              }
            } catch (err) {
              logError(`Failed to apply highlight at position ${start}-${end}`, err);
            }
          });

          // Afficher les fréquences de lemmes dans la sidebar
          displayLemmaFrequencies(lemmaFrequencies);

          // Mettre à jour l'interface
          const wordCount = editorText.split(/\s+/).filter(word => word.length > 0).length;
          const repetitionsDisplay = (typeof statsFromWorker.repeatedTokenCount === 'number')
            ? statsFromWorker.repeatedTokenCount
            : highlights.length;
          updateStats(wordCount, repetitionsDisplay);
          updateProgress(100, 'Analyse terminée');

          const duration = statsFromWorker.duration || 'N/A';
          logInfo(`Analysis completed: ${wordCount} words, ${repetitionsDisplay} repeated tokens (highlighted: ${highlights.length}) in ${duration}ms`, statsFromWorker);
        }

      } catch (error) {
        logError('Error processing worker results', error);
        updateProgress(0, 'Erreur de traitement');
      } finally {
        isAnalyzing = false;
        setButtonEnabled(true);

        // Réinitialiser la barre de progression après 2 secondes
        setTimeout(() => {
          if (!isAnalyzing) {
            updateProgress(0, 'Prêt');
          }
        }, 2000);
      }
    };

    worker.onerror = (error) => {
      logError('Web Worker error', error);
      isAnalyzing = false;
      setButtonEnabled(true);
      updateProgress(0, 'Erreur du Worker');
    };

    logInfo('Web Worker message handlers configured');
  }

  // Configuration des boutons de la sidebar
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
    logInfo('Sidebar toggle button configured');
  }
  
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', toggleSidebar);
    logInfo('Sidebar close button configured');
  }

  // Initialiser l'interface
  updateProgress(0, 'Prêt');
  updateStats(0, 0);
  setButtonEnabled(true);

  logInfo('Application initialization completed');
});
