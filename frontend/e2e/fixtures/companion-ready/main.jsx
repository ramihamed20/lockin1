import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../src/components/I18nProvider.jsx';
import StudyCompanion from '../../../src/workspace/assistance/StudyCompanion.jsx';
import '../../../src/styles.css';
createRoot(document.getElementById('root')).render(<I18nProvider><StudyCompanion userId="test-student" documentId="test-document" versionId="test-version" page={1} /></I18nProvider>);
