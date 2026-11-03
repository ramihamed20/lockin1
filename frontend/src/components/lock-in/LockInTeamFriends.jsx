import { useCallback, useEffect, useRef, useState } from 'react';
import { friendsApi, teamInvitesApi } from '../../api/social.js';
import { useI18n } from '../I18nProvider.jsx';
import { UserAvatar } from '../shared/UserAvatar.jsx';

/** Mounted only while the host's invite panel is open. No membership is inferred
 * from anonymous participants; only public member identities can be matched. */
export default function LockInTeamFriends({ team, disabled = false }) {
  const { t } = useI18n();
  const [friends, setFriends] = useState([]);
  const [sent, setSent] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const alive = useRef(false);
  const version = useRef(0);
  const sending = useRef(false);
  const load = useCallback(async () => {
    if (sending.current) return;
    const current = ++version.current;
    try {
      const [people, invitations] = await Promise.all([friendsApi.list(), teamInvitesApi.list()]);
      if (!alive.current || current !== version.current) return;
      setFriends(Array.isArray(people.friends) ? people.friends : []);
      setSent(Array.isArray(invitations.sent) ? invitations.sent : []);
      setLoadError('');
    } catch (failure) {
      if (alive.current && current === version.current) setLoadError(failure.message || t('lockIn.friendsFailed'));
    } finally { if (alive.current && current === version.current) setLoading(false); }
  }, [t]);
  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { alive.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  async function invite(person) {
    if (sending.current || disabled || team.joining_locked || team.member_count >= team.max_members) return;
    sending.current = true; version.current++;
    setBusy(person.id); setError('');
    try {
      const result = await teamInvitesApi.send(team.id, person.id);
      if (alive.current) setSent(Array.isArray(result.sent) ? result.sent : []);
    } catch (failure) { if (alive.current) setError(failure.message || t('lockIn.friendsFailed')); }
    finally {
      sending.current = false;
      if (alive.current) { setBusy(''); await load(); }
    }
  }
  const normalized = query.trim().replace(/^@/, '').toLocaleLowerCase();
  const visible = friends.filter(person => `${person.name} ${person.username}`.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => Number(!!b.online) - Number(!!a.online));
  const unavailable = team.joining_locked || team.member_count >= team.max_members;
  return <section className="lm-team-friends" aria-label={t('lockIn.teamInvitations')} aria-busy={loading}>
    {unavailable && <p className="lm-social-empty" role="status">{t(team.joining_locked ? 'lockIn.invitesLocked' : 'lockIn.invitesFull')}</p>}
    {loading && <p className="lm-social-empty" role="status">{t('common.loading')}</p>}
    {!loading && friends.length > 0 && <input className="lm-friend-filter" type="search" placeholder={t('lockIn.filterFriends')} aria-label={t('lockIn.filterFriends')} value={query} onChange={event => setQuery(event.target.value)} />}
    <div className="lm-picker-list">
      {visible.map(person => {
        const joined = team.members.some(member => !member.anonymous && member.user_id === person.id);
        const invited = sent.some(item => item.team_id === team.id && item.user_id === person.id);
        return <div className="lm-friend-row" key={person.id}>
          <span className="lm-friend-avatar"><UserAvatar avatar={person.avatar} /><i className={person.online ? 'is-online' : ''} aria-hidden="true" /></span>
          <span className="lm-friend-name"><strong dir="auto">{person.name}</strong><small dir="ltr">@{person.username}</small></span>
          <button className="btn btn-soft compact" type="button" disabled={disabled || !!busy || loading || !!loadError || unavailable || joined || invited} onClick={() => void invite(person)}>{t(joined ? 'lockIn.friendJoined' : invited ? 'lockIn.friendInvited' : busy === person.id ? 'lockIn.friendSending' : 'lockIn.friendInvite')}</button>
        </div>;
      })}
    </div>
    {!loading && !loadError && !visible.length && <p className="lm-social-empty">{t(friends.length ? 'lockIn.friendNotFound' : 'lockIn.friendsEmpty')}</p>}
    {loadError && <p className="lm-error" role="alert">{loadError} <button className="btn btn-soft compact" type="button" onClick={() => void load()}>{t('lockIn.friendsRetry')}</button></p>}
    {error && <p className="lm-error" role="alert">{error}</p>}
  </section>;
}
