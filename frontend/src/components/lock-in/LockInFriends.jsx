import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, UserPlus, X } from 'lucide-react';
import { friendsApi, teamInvitesApi } from '../../api/social.js';
import { useI18n } from '../I18nProvider.jsx';
import { UserAvatar } from '../shared/UserAvatar.jsx';
import { LockInMenu } from './LockInMenu.jsx';

const rows = value => Array.isArray(value) ? value : [];
const empty = { friends: [], incoming: [], outgoing: [] };

function Person({ person, online = false, children }) {
  return <div className="lm-friend-row">
    <span className="lm-friend-avatar"><UserAvatar avatar={person.avatar} /><i className={online ? 'is-online' : ''} aria-hidden="true" /></span>
    <span className="lm-friend-name"><strong dir="auto">{person.name}</strong>{person.username && <small dir="ltr">@{person.username}</small>}</span>
    {children}
  </div>;
}

export default function LockInFriends({ teams, initialTeamId, onCreateTeam, onOpenTeam }) {
  const { t } = useI18n();
  const [data, setData] = useState(empty);
  const [invitations, setInvitations] = useState({ incoming: [], sent: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [teamId, setTeamId] = useState(initialTeamId || '');
  const alive = useRef(true);
  const sequence = useRef(0);
  const input = useRef(null);
  const searchSequence = useRef(0);
  const owned = useMemo(() => teams.filter(item => item.role === 'owner' && !item.closed_at), [teams]);

  useEffect(() => {
    if (!owned.some(item => item.id === teamId)) setTeamId(owned.some(item => item.id === initialTeamId) ? initialTeamId : owned[0]?.id || '');
  }, [initialTeamId, owned, teamId]);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const [friends, invites] = await Promise.all([friendsApi.list(), teamInvitesApi.list()]);
      if (!alive.current || current !== sequence.current) return;
      setData({ friends: rows(friends.friends), incoming: rows(friends.incoming), outgoing: rows(friends.outgoing) });
      setInvitations({ incoming: rows(invites.incoming), sent: rows(invites.sent) });
      setLoadError('');
    } catch (failure) {
      if (alive.current && current === sequence.current) setLoadError(failure.message || t('lockIn.friendsFailed'));
    } finally { if (alive.current && current === sequence.current) setLoading(false); }
  }, [t]);

  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const interval = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive.current = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  useEffect(() => { if (searchOpen) input.current?.focus(); }, [searchOpen]);

  async function act(key, operation) {
    if (busy) return;
    sequence.current++;
    setBusy(key); setError('');
    try { await operation(); }
    catch (failure) { if (alive.current) setError(failure.message || t('lockIn.friendsFailed')); }
    finally { if (alive.current) { await load(); if (alive.current) setBusy(''); } }
  }

  async function search(event) {
    event.preventDefault();
    const current = ++searchSequence.current;
    await act('search', async () => { const found = await friendsApi.search(query.trim().replace(/^@/, '')); if (alive.current && current === searchSequence.current) setResults(rows(found.users)); });
  }
  const friendship = id => data.friends.find(item => item.id === id);
  const incoming = id => data.incoming.find(item => item.id === id);
  const outgoing = id => data.outgoing.find(item => item.id === id);
  const respond = (person, action) => act(`${action}-${person.id}`, () => friendsApi.respond(person.request_id, action));
  const pending = data.incoming.length + data.outgoing.length + invitations.incoming.length;

  function friendAction(person) {
    if (friendship(person.id)) return <span className="lm-friend-status"><Check size={16} aria-hidden="true" />{t('lockIn.friendAdded')}</span>;
    const received = incoming(person.id);
    if (received) return <button className="btn btn-primary compact" type="button" disabled={!!busy} onClick={() => respond(received, 'accept')}>{t('lockIn.friendAccept')}</button>;
    if (outgoing(person.id)) return <span className="lm-friend-status">{t('lockIn.friendPending')}</span>;
    return <button className="btn btn-soft compact" type="button" disabled={!!busy} onClick={() => act(`add-${person.id}`, () => friendsApi.add(person.id))}><UserPlus size={15} aria-hidden="true" />{t('lockIn.friendAdd')}</button>;
  }

  return <section id="lm-friends" className="lm-friends" aria-labelledby="lm-friends-title">
    <header className="lm-friends-header"><h2 id="lm-friends-title">{t('lockIn.friends')}</h2><button className="btn btn-soft compact" type="button" aria-expanded={searchOpen} onClick={() => { searchSequence.current++; setSearchOpen(value => !value); setResults(null); }}><Plus size={16} aria-hidden="true" />{t('lockIn.friendAdd')}</button></header>
    {searchOpen && <div className="lm-friend-search">
      <form onSubmit={search}><input ref={input} aria-label={t('lockIn.friendUsername')} placeholder="@username" dir="ltr" minLength={3} maxLength={31} value={query} onChange={event => { searchSequence.current++; setQuery(event.target.value); setResults(null); }} required /><button className="btn btn-soft compact" type="submit" disabled={!!busy || query.trim().replace(/^@/, '').length < 3} aria-label={t('lockIn.friendSearch')}><Search size={18} /></button></form>
      {results?.map(person => <Person key={person.id} person={person}>{friendAction(person)}</Person>)}
      {results && !results.length && <p className="lm-social-empty">{t('lockIn.friendNotFound')}</p>}
    </div>}
    {!!pending && <details className="lm-social-inbox"><summary>{t('lockIn.friendRequests')} <span>{pending}</span></summary>
      {data.incoming.map(person => <Person key={person.request_id} person={person}><button className="btn btn-primary compact" type="button" disabled={!!busy} onClick={() => respond(person, 'accept')}>{t('lockIn.friendAccept')}</button><button className="lm-icon-button" type="button" disabled={!!busy} aria-label={t('lockIn.friendDecline')} onClick={() => respond(person, 'decline')}><X size={17} /></button></Person>)}
      {data.outgoing.map(person => <Person key={person.request_id} person={person}><span className="lm-friend-status">{t('lockIn.friendPending')}</span><button className="lm-icon-button" type="button" disabled={!!busy} aria-label={t('lockIn.friendCancel')} onClick={() => respond(person, 'cancel')}><X size={17} /></button></Person>)}
      {invitations.incoming.map(invite => <div key={invite.id} className="lm-friend-row"><span className="lm-friend-name"><strong dir="auto">{invite.team_name}</strong><small dir="auto">{invite.sender?.name}</small></span><button className="btn btn-primary compact" type="button" disabled={!!busy} onClick={() => act(`join-${invite.id}`, async () => { const result = await teamInvitesApi.respond(invite.id, 'accept'); if (alive.current && result.team) await onOpenTeam(result.team); })}>{t('lockIn.join')}</button><button className="lm-icon-button" type="button" disabled={!!busy} aria-label={t('lockIn.friendDecline')} onClick={() => act(`decline-${invite.id}`, () => teamInvitesApi.respond(invite.id, 'decline'))}><X size={17} /></button></div>)}
    </details>}
    {!loading && data.friends.length > 0 && <div className="lm-friend-team">{owned.length ? <select aria-label={t('lockIn.inviteToTeam')} value={teamId} onChange={event => setTeamId(event.target.value)}>{owned.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <button className="btn btn-soft compact" type="button" onClick={onCreateTeam}>{t('lockIn.createTeam')}</button>}</div>}
    <div className="lm-friend-list" aria-busy={loading}>
      {(showAll ? data.friends : data.friends.slice(0, 4)).map(person => {
        const sent = invitations.sent.some(item => item.team_id === teamId && item.user_id === person.id);
        return <Person key={person.id} person={person} online={person.online}>
          <span className="visually-hidden">{t(person.online ? 'lockIn.friendOnline' : 'lockIn.friendOffline')}</span>
          <button className="btn btn-soft compact" type="button" disabled={!!busy || !teamId || sent} onClick={() => act(`invite-${person.id}`, async () => { const result = await teamInvitesApi.send(teamId, person.id); if (alive.current) setInvitations({ incoming: rows(result.incoming), sent: rows(result.sent) }); })}>{t(sent ? 'lockIn.friendInvited' : 'lockIn.friendInvite')}</button>
          <LockInMenu label={t('lockIn.friendOptions', { name: person.name })} items={[{ label: t('lockIn.friendRemove'), danger: true, onSelect: () => respond(person, 'remove') }]} />
        </Person>;
      })}
    </div>
    {!loading && !loadError && !data.friends.length && <p className="lm-social-empty">{t('lockIn.friendsEmpty')}</p>}
    {data.friends.length > 4 && <button className="btn btn-soft compact" type="button" onClick={() => setShowAll(value => !value)}>{t(showAll ? 'lockIn.friendsLess' : 'lockIn.friendsAll')}</button>}
    {loadError && <p className="lm-error" role="alert">{loadError} <button type="button" className="btn btn-soft compact" onClick={() => void load()}>{t('lockIn.friendsRetry')}</button></p>}
    {error && <p className="lm-error" role="alert">{error}</p>}
  </section>;
}
