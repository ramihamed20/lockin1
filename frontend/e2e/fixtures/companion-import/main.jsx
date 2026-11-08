import React from 'react';
import { createRoot } from 'react-dom/client';
import { loadLocaleMessages } from '../../../src/lib/i18n.js';
import { I18nProvider, initialAppLocale } from '../../../src/components/I18nProvider.jsx';
import { StudyAssistancePanel } from '../../../src/pages/admin/StudyAssistancePanel.jsx';
import '../../../src/styles/layers.css';
import '../../../src/styles.css';
import '../../../src/styles/tokens.css';
import '../../../src/styles/system.css';
// Match the production bootstrap: load the selected locale before rendering.
loadLocaleMessages(initialAppLocale()).catch(() => undefined).then(() => {
  createRoot(document.getElementById('root')).render(<I18nProvider><StudyAssistancePanel sheet={{id:'11111111-1111-4111-8111-111111111111'}} /></I18nProvider>);
});
