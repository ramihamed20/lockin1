import { useEffect, useId, useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { useI18n } from "../I18nProvider.jsx";
import { DEFAULT_AVATARS, UserAvatar, fallbackAvatarId } from "../shared/UserAvatar.jsx";
import { assetPath } from "../../lib/utils.js";
import "./profile-picture-editor.css";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageError(file, t) {
  if (!file) return "";
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return t("profile.avatarFileTypeError");
  if (file.size > MAX_AVATAR_BYTES) return t("profile.avatarFileSizeError");
  return "";
}

export function ProfilePictureEditor({ user, onSaved }) {
  const { t } = useI18n();
  const inputId = useId();
  const [mode, setMode] = useState("avatars");
  const [selectedDefault, setSelectedDefault] = useState(() => user?.avatar?.default_id || fallbackAvatarId(user?.id));
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSelectedDefault(user?.avatar?.default_id || fallbackAvatarId(user?.id));
  }, [user?.avatar?.default_id, user?.id]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return undefined;
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  function chooseFile(event) {
    const nextFile = event.target.files?.[0] || null;
    const validationError = imageError(nextFile, t);
    setError(validationError);
    setNotice("");
    setFile(validationError ? null : nextFile);
  }

  async function saveDefault() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const updated = await accountsApi.updateProfile({ avatarDefault: selectedDefault });
      onSaved?.(updated);
      setNotice(t("profile.avatarSaved"));
    } catch (requestError) {
      setError(requestError.message || t("profile.saveError"));
    } finally {
      setPending(false);
    }
  }

  async function saveUpload() {
    const validationError = imageError(file, t);
    if (validationError) {
      setError(validationError || t("profile.avatarSelectPhoto"));
      return;
    }
    setPending(true);
    setError("");
    setNotice("");
    try {
      const updated = await accountsApi.uploadProfileAvatar(file);
      onSaved?.(updated);
      setFile(null);
      setNotice(t("profile.avatarSaved"));
    } catch (requestError) {
      setError(requestError.message || t("profile.saveError"));
    } finally {
      setPending(false);
    }
  }

  const previewAvatar = previewUrl
    ? { source: "custom", url: previewUrl, default_id: selectedDefault }
    : mode === "avatars"
      ? { source: "default", default_id: selectedDefault }
      : user?.avatar;

  return (
    <section className="profile-picture-editor" aria-labelledby="profile-picture-title">
      <div className="profile-picture-editor-heading">
        <div className="profile-picture-editor-preview">
          <UserAvatar user={user} avatar={previewAvatar} alt={t("profile.avatarPreviewAlt")} loading="eager" />
        </div>
        <div>
          <h3 id="profile-picture-title">{t("profile.profilePicture")}</h3>
          <p>{t("profile.profilePictureHint")}</p>
        </div>
      </div>

      <div className="profile-picture-editor-modes" role="tablist" aria-label={t("profile.profilePicture")}> 
        <button type="button" role="tab" aria-selected={mode === "upload"} className={mode === "upload" ? "is-active" : ""} onClick={() => setMode("upload")}>{t("profile.uploadPhoto")}</button>
        <button type="button" role="tab" aria-selected={mode === "avatars"} className={mode === "avatars" ? "is-active" : ""} onClick={() => setMode("avatars")}>{t("profile.chooseAvatar")}</button>
      </div>

      {mode === "upload" ? (
        <div className="profile-avatar-upload" role="tabpanel">
          <label className="profile-avatar-file" htmlFor={inputId}>
            <span>{file?.name || t("profile.avatarSelectPhoto")}</span>
            <small>{t("profile.avatarUploadHint")}</small>
          </label>
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={chooseFile} />
          <button className="btn btn-primary compact" type="button" disabled={!file || pending} onClick={() => void saveUpload()}>{t(pending ? "profile.saving" : "profile.savePhoto")}</button>
        </div>
      ) : (
        <div className="profile-avatar-picker" role="tabpanel">
          <div className="profile-avatar-choice-grid" role="radiogroup" aria-label={t("profile.chooseAvatar")}>
            {DEFAULT_AVATARS.map((avatar, index) => {
              const selected = avatar.id === selectedDefault;
              return (
                <button
                  key={avatar.id}
                  className={`profile-avatar-choice ${selected ? "is-selected" : ""}`.trim()}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t("profile.avatarOption", { number: index + 1 })}
                  onClick={() => { setSelectedDefault(avatar.id); setNotice(""); setError(""); }}
                >
                  <img src={assetPath(avatar.src)} alt="" loading="lazy" decoding="async" />
                </button>
              );
            })}
          </div>
          <button className="btn btn-primary compact" type="button" disabled={pending} onClick={() => void saveDefault()}>{t(pending ? "profile.saving" : "profile.saveAvatar")}</button>
        </div>
      )}

      {error && <p className="form-alert error" role="alert">{error}</p>}
      {notice && <p className="profile-avatar-editor-notice" role="status">{notice}</p>}
    </section>
  );
}
