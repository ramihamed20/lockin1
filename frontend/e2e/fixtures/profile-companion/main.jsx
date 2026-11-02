import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../src/components/I18nProvider.jsx';
import { CompanionCard } from '../../../src/components/profile/CompanionCard.jsx';
import StudyCompanion from '../../../src/workspace/assistance/StudyCompanion.jsx';
import '../../../src/styles/layers.css';
import '../../../src/styles.css';
import '../../../src/styles/tokens.css';
import '../../../src/styles/system.css';
function Fixture() {
 const [userId,setUserId]=useState('profile-student');
 return <><main style={{maxWidth:560,margin:'32px auto',padding:16}}><CompanionCard key={userId} userId={userId} xp={{level:4,level_progress:125,level_target:300}} xpAvailable={!window.location.search.includes("unavailable")} /><button onClick={()=>setUserId(userId==='profile-student'?'other-student':'profile-student')}>Switch account</button></main><StudyCompanion userId={userId} documentId="test-document" versionId="test-version" page={1}/></>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture /></I18nProvider>);
