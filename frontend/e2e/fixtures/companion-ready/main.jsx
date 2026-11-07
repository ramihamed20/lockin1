import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, useI18n } from '../../../src/components/I18nProvider.jsx';
import StudyCompanion from '../../../src/workspace/assistance/StudyCompanion.jsx';
import { AddMenu } from '../../../src/pages/focus-workspace/menus.jsx';
import '../../../src/styles.css';
import '../../../src/pages/catalog-focus-workspace.css';
import '../../../src/pages/focus-workspace-menu-refresh.css';

const toolbarCompanion = new URLSearchParams(window.location.search).has('toolbar');

function Fixture() {
  const { t } = useI18n();
  const [surface, setSurface] = useState(null);
  const addMenu = (
    <div className="workspace-v2" style={{ minHeight: '100dvh' }}>
      <button type="button" data-workspace-surface="add" aria-label={t('focus.add')}
        onClick={() => setSurface('add')}>+</button>
      <AddMenu companionUserId="test-student" companionAvailable
        closeSurfaceAndRestoreFocus={() => setSurface(null)}
        popover={(name) => ({ shown: surface === name, props: {} })}
        workspaceReady={true} page={1} sheet={{ pdfUrl: '/fixture.pdf' }}
        studyMode="normal" setOpenSurface={setSurface} t={t} />
    </div>
  );
  return <>
    {toolbarCompanion && addMenu}
    <StudyCompanion userId="test-student" documentId="test-document"
      versionId="test-version" page={1}
      active={!surface} phoneAddFromToolbar={toolbarCompanion} />
  </>;
}

createRoot(document.getElementById('root')).render(<I18nProvider><Fixture /></I18nProvider>);
