import { useEffect, useState } from 'react';
import { friendsApi } from '../../api/social.js';
import { useI18n } from '../I18nProvider.jsx';
import { UserAvatar } from '../shared/UserAvatar.jsx';

/** Selection is a draft; no invitation is sent before the team is created. */
export default function LockInFriendPicker({ selected, onChange, maximum, disabled }) {
  const { t } = useI18n();
  const [friends, setFriends] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    friendsApi.list().then(result => {
      if (!cancelled) { setFriends(Array.isArray(result.friends) ? result.friends : []); setError(''); }
    }).catch(failure => { if (!cancelled) setError(failure.message || t('lockIn.friendsFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry, t]);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = friends.filter(person => `${person.name} ${person.username}`.toLocaleLowerCase().includes(normalized));
  const limit = Math.max(0, Number(maximum) - 1);
  return <fieldset className="lm-invite-picker" disabled={disabled} aria-busy={loading}>
    <legend>{t('lockIn.inviteFriends')} <span>{selected.length}/{limit}</span></legend>
    {loading && <p className="lm-social-empty" role="status">{t('common.loading')}</p>}
    {error && <p className="lm-error" role="alert">{error} <button type="button" className="btn btn-soft compact" onClick={() => setRetry(value => value + 1)}>{t('lockIn.friendsRetry')}</button></p>}
    {!loading && !error && !friends.length && <p className="lm-social-empty">{t('lockIn.friendsEmpty')}</p>}
    {!loading && !error && friends.length > 0 && <>
      <input className="lm-friend-filter" type="search" aria-label={t('lockIn.filterFriends')} placeholder={t('lockIn.filterFriends')} value={query} onChange={event => setQuery(event.target.value)} />
      <div className="lm-picker-list">
        {matches.map(person => {
          const checked = selected.some(item => item.id === person.id);
          return <label className="lm-friend-row lm-picker-option" key={person.id}>
            <span className="lm-friend-avatar"><UserAvatar avatar={person.avatar} /></span>
            <span className="lm-friend-name"><strong dir="auto">{person.name}</strong><small dir="ltr">@{person.username}</small></span>
            <input type="checkbox" aria-label={person.name} checked={checked} disabled={!checked && selected.length >= limit} onChange={() => onChange(checked ? selected.filter(item => item.id !== person.id) : [...selected, person])} />
          </label>;
        })}
        {!matches.length && <p className="lm-social-empty">{t('lockIn.friendNotFound')}</p>}
      </div>
    </>}
  </fieldset>;
}
