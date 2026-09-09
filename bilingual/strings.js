/*
 * All page strings, EN and FR side by side — the single file translators
 * work through. Keys are namespaced dot-paths; keep them stable, they are
 * the contract between markup/script and this file.
 *
 * English-first workflow: ship with fr set to null (or omitted) and the
 * page renders English for those keys; intl.report() lists everything
 * still waiting on translation.
 */
intl.addMessages({
  'app.title':          { en: 'Client Onboarding',
                          fr: 'Accueil des clients' },
  'app.intro':          { en: 'Track <strong>new client</strong> requests through review and approval.',
                          fr: 'Suivez les demandes de <strong>nouveaux clients</strong>, de l’examen à l’approbation.' },

  'ui.langToggle':      { en: 'Français',
                          fr: 'English' },

  'search.placeholder': { en: 'Search by client name…',
                          fr: 'Rechercher par nom de client…' },
  'search.tooltip':     { en: 'Matches partial names',
                          fr: 'Accepte les noms partiels' },
  'search.button':      { en: 'Search',
                          fr: 'Rechercher' },

  'results.count':      { en: '{count} request(s) found',
                          fr: '{count} demande(s) trouvée(s)' },
  'results.updated':    { en: 'Last refreshed: {date}',
                          fr: 'Dernière mise à jour : {date}' },
  'results.greeting':   { en: 'Welcome back, {name}',
                          fr: 'Bon retour, {name}' },

  // Deliberately untranslated — demonstrates the EN fallback + report().
  'results.exportHint': { en: 'Export to Excel is available from the toolbar.',
                          fr: null }
});
