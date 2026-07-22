import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Eye, Globe2, KeyRound, Lock, Save, Trash2, UserRound } from 'lucide-react';
import { avatarUrl } from './authApi.js';
import { useAuth } from './AuthContext.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const MAX_AVATAR_BYTES = 1_048_576;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default function ProfilePage({ onBack }) {
  const { user, updateProfile, updateAvatar, removeAvatar, changePassword } = useAuth();
  const { showPopup } = usePopup();
  const fileRef = useRef(null);
  const [details, setDetails] = useState({ username: '', displayName: '', websiteUrl: '', defaultProjectVisibility: 'private' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [detailsErrors, setDetailsErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) return;
    setDetails({
      username: user.username ?? '',
      displayName: user.displayName ?? '',
      websiteUrl: user.websiteUrl ?? '',
      defaultProjectVisibility: user.defaultProjectVisibility ?? 'private',
    });
  }, [user]);

  const changeDetails = (event) => {
    const { name, value } = event.target;
    setDetails((current) => ({ ...current, [name]: value }));
    setDetailsErrors((current) => ({ ...current, [name]: undefined }));
  };

  const changePasswords = (event) => {
    const { name, value } = event.target;
    setPasswords((current) => ({ ...current, [name]: value }));
    setPasswordErrors((current) => ({ ...current, [name]: undefined }));
  };

  const saveDetails = async (event) => {
    event.preventDefault();
    setBusy('details');
    setDetailsErrors({});
    try {
      await updateProfile(details);
      showPopup('Profile settings saved.', { type: 'success' });
    } catch (error) {
      setDetailsErrors(error.fields ?? {});
      showPopup(error.message || 'Could not save your profile.', { type: 'error', title: 'Profile not saved' });
    } finally {
      setBusy('');
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    const errors = {};
    if (passwords.newPassword !== passwords.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    if (errors.confirmPassword) {
      setPasswordErrors(errors);
      return;
    }
    setBusy('password');
    setPasswordErrors({});
    try {
      await changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showPopup('Password changed. Your other sessions were signed out.', { type: 'success' });
    } catch (error) {
      setPasswordErrors(error.fields ?? {});
      showPopup(error.message || 'Could not change your password.', { type: 'error', title: 'Password not changed' });
    } finally {
      setBusy('');
    }
  };

  const chooseAvatar = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      showPopup('Choose a PNG, JPEG, or WebP image.', { type: 'error', title: 'Unsupported image' });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showPopup('Profile pictures must be 1 MB or smaller.', { type: 'error', title: 'Image is too large' });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showPopup('Could not read this image.', { type: 'error' });
    reader.onload = async () => {
      setBusy('avatar');
      try {
        await updateAvatar(reader.result);
        showPopup('Profile picture updated.', { type: 'success' });
      } catch (error) {
        showPopup(error.fields?.avatar || error.message || 'Could not update your profile picture.', { type: 'error' });
      } finally {
        setBusy('');
      }
    };
    reader.readAsDataURL(file);
  };

  const deleteAvatar = async () => {
    setBusy('avatar');
    try {
      await removeAvatar();
      showPopup('Profile picture removed.', { type: 'success' });
    } catch (error) {
      showPopup(error.message || 'Could not remove your profile picture.', { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const field = (name, label, props = {}) => (
    <label className={`auth-field${detailsErrors[name] ? ' has-error' : ''}`}>
      <span>{label}</span>
      <input name={name} value={details[name]} onChange={changeDetails} disabled={busy === 'details'} aria-invalid={!!detailsErrors[name]} {...props} />
      {detailsErrors[name] && <small>{detailsErrors[name]}</small>}
    </label>
  );

  const passwordField = (name, label, autoComplete) => (
    <label className={`auth-field${passwordErrors[name] ? ' has-error' : ''}`}>
      <span>{label}</span>
      <input type="password" name={name} value={passwords[name]} onChange={changePasswords} autoComplete={autoComplete} minLength={name === 'currentPassword' ? undefined : 10} maxLength={128} required disabled={busy === 'password'} aria-invalid={!!passwordErrors[name]} />
      {passwordErrors[name] && <small>{passwordErrors[name]}</small>}
    </label>
  );

  const picture = avatarUrl(user);
  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> Back to projects</button>
      <header className="profile-heading">
        <div><span>Account settings</span><h1 id="profile-title">Your profile</h1><p>Manage how you appear and set defaults for projects you create.</p></div>
      </header>

      <div className="profile-grid">
        <section className="profile-card profile-avatar-card">
          <header><Camera size={16} /><div><h2>Profile picture</h2><p>PNG, JPEG or WebP, up to 1 MB.</p></div></header>
          <div className="profile-avatar-row">
            <span className="profile-avatar">{picture ? <img src={picture} alt="Your profile" /> : initials}</span>
            <div className="profile-avatar-actions">
              <button type="button" className="lp-primary sm" onClick={() => fileRef.current?.click()} disabled={busy === 'avatar'}><Camera size={13} /> {picture ? 'Replace' : 'Upload'}</button>
              {picture && <button type="button" className="profile-danger-button" onClick={deleteAvatar} disabled={busy === 'avatar'}><Trash2 size={13} /> Remove</button>}
            </div>
            <input ref={fileRef} className="profile-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} />
          </div>
        </section>

        <section className="profile-card profile-details-card">
          <header><UserRound size={16} /><div><h2>Profile information</h2><p>Your public identity and project defaults.</p></div></header>
          <form onSubmit={saveDetails} noValidate>
            <div className="profile-field-grid">
              {field('username', 'Username', { type: 'text', autoComplete: 'username', minLength: 3, maxLength: 32, required: true })}
              {field('displayName', 'Display name', { type: 'text', autoComplete: 'name', maxLength: 80, placeholder: 'Terrain artist' })}
            </div>
            <label className="auth-field"><span>Email</span><input value={user?.email ?? ''} type="email" readOnly aria-readonly="true" /><small className="profile-field-note">Email changes are not available yet.</small></label>
            {field('websiteUrl', 'Website', { type: 'url', autoComplete: 'url', maxLength: 2048, placeholder: 'https://example.com' })}
            <fieldset className={`profile-visibility${detailsErrors.defaultProjectVisibility ? ' has-error' : ''}`}>
              <legend>Default project visibility</legend>
              <div className="profile-visibility-options">
                <label><input type="radio" name="defaultProjectVisibility" value="private" checked={details.defaultProjectVisibility === 'private'} onChange={changeDetails} disabled={busy === 'details'} /><Lock size={14} /><span><strong>Private</strong><small>Only you can access it.</small></span></label>
                <label><input type="radio" name="defaultProjectVisibility" value="unlisted" checked={details.defaultProjectVisibility === 'unlisted'} onChange={changeDetails} disabled={busy === 'details'} /><Eye size={14} /><span><strong>Unlisted</strong><small>Anyone with its link can open it.</small></span></label>
                <label><input type="radio" name="defaultProjectVisibility" value="public" checked={details.defaultProjectVisibility === 'public'} onChange={changeDetails} disabled={busy === 'details'} /><Globe2 size={14} /><span><strong>Public</strong><small>Visible to everyone.</small></span></label>
              </div>
              {detailsErrors.defaultProjectVisibility && <small>{detailsErrors.defaultProjectVisibility}</small>}
            </fieldset>
            <button type="submit" className="lp-primary profile-save" disabled={busy === 'details'}><Save size={14} /> {busy === 'details' ? 'Saving...' : 'Save profile'}</button>
          </form>
        </section>

        <section className="profile-card profile-security-card">
          <header><KeyRound size={16} /><div><h2>Password</h2><p>Changing it signs out your other active sessions.</p></div></header>
          <form onSubmit={savePassword} noValidate>
            {passwordField('currentPassword', 'Current password', 'current-password')}
            <div className="profile-field-grid">
              {passwordField('newPassword', 'New password', 'new-password')}
              {passwordField('confirmPassword', 'Confirm new password', 'new-password')}
            </div>
            <button type="submit" className="lp-secondary profile-save" disabled={busy === 'password'}><KeyRound size={14} /> {busy === 'password' ? 'Changing...' : 'Change password'}</button>
          </form>
        </section>
      </div>
    </section>
  );
}
