import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../components/I18nProvider.jsx';
import { studyAssistanceAdminApi } from '../../api/studyAssistance.js';
import { buildCompanionPrompt, companionImportCopy, parseCompanionJson } from '../../lib/companionImport.js';
import { copyTextToClipboard } from '../../lib/clipboard.js';

export function CompanionImportPanel({ sheet, edition, view, onImported }) {
 const { locale } = useI18n();
 const c = companionImportCopy[locale] || companionImportCopy.en;
 const [open,setOpen]=useState(false),[context,setContext]=useState(null),[mode,setMode]=useState('one');
 const [selected,setSelected]=useState([]),[text,setText]=useState(''),[publish,setPublish]=useState(false);
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [prompt,setPrompt]=useState('');
 const [reload,setReload]=useState(0);
 const fileSequence=useRef(0);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();
  setError('');
  studyAssistanceAdminApi.importContext(sheet.id,edition,view,controller.signal).then(setContext,error=>{if(!controller.signal.aborted)setError(error.message);});
  return ()=>{controller.abort();fileSequence.current+=1;};
 },[open,sheet.id,edition,view,reload]);
 const targets=context?.sheets.filter(s=>mode==='all'||(mode==='one'?s.sheet_id===sheet.id:selected.includes(s.sheet_id)))||[];
 const antigravityCommand=targets.length===1
  ? [
     'python manage.py generate_companion_cards',
     '--sheet-id "'+targets[0].sheet_id+'"',
     '--actor-email "YOUR_CONTENT_ADMIN_EMAIL"',
     '--edition '+edition,
     '--view '+view,
     '--max-cards 40',
     '--output /tmp/companion-'+targets[0].sheet_id.slice(0,8)+'-draft.json',
     '--report-output /tmp/companion-'+targets[0].sheet_id.slice(0,8)+'-review.json'
    ].join(' ')
  : '';
 function invalidate(){setPreview(null);setMessage('');}
 async function readFile(event){
  const file=event.target.files?.[0]; if(!file)return;
  const sequence=++fileSequence.current; invalidate();setText('');setError('');
  try { if(file.size>2_000_000)throw new Error('JSON must be smaller than 2 MB.'); const value=await file.text();if(sequence===fileSequence.current)setText(value); }
  catch(error){if(sequence===fileSequence.current)setError(error.message);}
 }
 async function validate(){
  setBusy(true);setError('');invalidate();
  try{
   const payload=parseCompanionJson(text);
   if(payload.subject_id!==context.subject_id||payload.edition!==edition||payload.view!==view)throw new Error('JSON must match this subject, edition and reader view.');
   const ids=new Set(targets.map(s=>s.sheet_id));
   if(payload.sheets.length!==ids.size||payload.sheets.some(s=>!ids.has(s.sheet_id)))throw new Error('JSON must include exactly the selected sheets.');
   const result=await studyAssistanceAdminApi.importCards(sheet.id,payload,publish);
   setPreview({...result,payload});
  }catch(error){setError(error.message);}finally{setBusy(false);}
 }
 async function confirm(){
  if(!preview||busy)return;
  setBusy(true);setError('');
  try{const result=await studyAssistanceAdminApi.importCards(sheet.id,preview.payload,publish,preview.preview_token);setMessage(`${c.saved}: ${result.imported} (${result.changed_count})`);setPreview(null);onImported?.();}
  catch(error){setError(error.message);}finally{setBusy(false);}
 }
 return <details className="admin-assistance-import" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>{c.title}</summary><p>{c.intro}</p>
  {error&&<p role="alert" className="form-alert error">{error}<button type="button" className="btn btn-soft" disabled={busy} onClick={()=>setReload(n=>n+1)}>{c.retry}</button></p>}
  {!context&&open&&<p role="status">…</p>}
  {context&&<fieldset disabled={busy}>
   <label className="field"><span>{c.selected}</span><select aria-label={c.selected} value={mode} onChange={event=>{setMode(event.target.value);setPrompt('');invalidate();}}><option value="one">{c.one}</option><option value="several">{c.several}</option><option value="all">{c.all}</option></select></label>
   {mode==='several'&&<div className="admin-assistance-import-sheets">{context.sheets.map(s=><label key={s.sheet_id}><input type="checkbox" checked={selected.includes(s.sheet_id)} onChange={event=>{setSelected(values=>event.target.checked?[...values,s.sheet_id]:values.filter(id=>id!==s.sheet_id));setPrompt('');invalidate();}}/>{s.title}</label>)}</div>}
   {antigravityCommand&&<div className="admin-assistance-antigravity">
    <strong>{c.antigravity}</strong>
    <p>{c.antigravityHelp}</p>
    <pre dir="ltr"><code>{antigravityCommand}</code></pre>
    <button type="button" className="btn btn-soft" onClick={async()=>{setMessage(await copyTextToClipboard(antigravityCommand)?c.copied:c.copyFailed);}}>{c.antigravityCopy}</button>
    <small>{c.antigravityDraftHint}</small>
    <button type="button" className="btn btn-soft" onClick={async()=>{setMessage(await copyTextToClipboard(antigravityCommand+' --import-drafts')?c.copied:c.copyFailed);}}>{c.antigravityDraftCopy}</button>
   </div>}
   <button type="button" className="btn btn-soft" disabled={!targets.length} onClick={async()=>{try{const value=buildCompanionPrompt(context,targets);setPrompt(value);setMessage(await copyTextToClipboard(value)?c.copied:c.copyFailed);}catch(error){setError(error.message);}}}>{c.prompt}</button>
   {prompt&&<textarea readOnly aria-label={c.prompt} value={prompt} rows={5} dir="ltr" />}
   <label className="field"><span>{c.file}</span><input type="file" accept=".json,application/json" onChange={event=>void readFile(event)} /></label>
   <label className="field"><span>{c.text}</span><textarea aria-label={c.text} value={text} rows={6} dir="ltr" onChange={event=>{fileSequence.current+=1;setText(event.target.value);invalidate();}} /></label>
   <label><input type="checkbox" checked={publish} onChange={event=>{setPublish(event.target.checked);invalidate();}}/>{c.publish}</label>
   <button type="button" className="btn btn-soft" disabled={!text.trim()||!targets.length} onClick={()=>void validate()}>{c.preview}</button>
   {preview&&<section className="admin-assistance-import-preview" aria-label={c.preview}>{preview.sheets.map(s=><details key={s.sheet_id} open><summary>{s.title} · {s.count}</summary>{s.cards.map(card=><article key={card.key}><strong dir="auto">{card.question}</strong><small>{c.kinds[card.kind]} · {card.page??'—'}</small><p dir="auto">{card.explanation}</p>{card.followup_question&&<p dir="auto">{card.followup_question} — {card.followup_answer}</p>}</article>)}</details>)}<button type="button" className="btn btn-primary" onClick={()=>void confirm()}>{c.confirm}</button></section>}
  </fieldset>}
  {message&&<p role="status">{message}</p>}
 </details>;
}
