import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import React, { useState } from 'react';
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react';
import { APP_NAME } from '../constants/app.js';
import { Logo } from '../landing/shared.jsx';
import { useAuth } from './AuthContext.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const initialFields = { email: '', username: '', identifier: '', password: '', confirmPassword: '' };

export default function AuthPage({ mode, onBack, onSwitch, onSuccess }) {
  useLanguage();
  const isRegister = mode === 'register';
  const { login, register } = useAuth();
  const { showPopup } = usePopup();
  const [fields, setFields] = useState(initialFields);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const change = (name) => (event) => {
    const value = event.target.value;
    setFields((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const clientErrors = {};
    if (isRegister && fields.password !== fields.confirmPassword) {
      clientErrors.confirmPassword = 'Passwords do not match.';
    }
    if (Object.keys(clientErrors).length) {
      setFieldErrors(clientErrors);
      return;
    }

    setBusy(true);
    setFieldErrors({});
    try {
      if (isRegister) {
        await register({ email: fields.email, username: fields.username, password: fields.password });
      } else {
        await login({ identifier: fields.identifier, password: fields.password });
      }
      onSuccess();
    } catch (error) {
      showPopup(error.message || 'The request could not be completed.', { type: 'error', title: isRegister ? 'Account not created' : 'Sign-in failed' });
      setFieldErrors(error.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  const input = (name, label, properties = {}) => (
    <label className={`auth-field${fieldErrors[name] ? ' has-error' : ''}`}>
      <span>{translateText(label)}</span>
      <input
        name={name}
        value={fields[name]}
        onChange={change(name)}
        aria-invalid={!!fieldErrors[name]}
        aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
        disabled={busy}
        {...properties}
      />
      {fieldErrors[name] && <small id={`${name}-error`}>{translateText(fieldErrors[name])}</small>}
    </label>
  );

  return (
    <section className="auth-page" aria-labelledby="auth-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} />{translateText(" Back to projects")}</button>
      <div className="auth-card">
        <header>
          <span className="auth-mark"><Logo size={25} /></span>
          <div>
            <small>{translateText(APP_NAME)}</small>
            <h1 id="auth-title">{translateText(isRegister ? 'Create your account' : 'Welcome back')}</h1>
            <p>{translateText(isRegister ? 'Keep your identity ready for cloud projects and sharing.' : 'Sign in to access your account. Local projects remain on this device.')}</p>
          </div>
        </header>

        <form onSubmit={submit} noValidate>
          {translateText(isRegister && input('username', 'Username', {
            type: 'text', autoComplete: 'username', minLength: 3, maxLength: 32,
            pattern: '[a-zA-Z0-9_]+', placeholder: 'terrain_creator', required: true,
          }))}
          {translateText(isRegister
            ? input('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 320, placeholder: 'you@example.com', required: true })
            : input('identifier', 'Email or username', { type: 'text', autoComplete: 'username', maxLength: 320, placeholder: 'you@example.com', required: true }))}
          {translateText(input('password', 'Password', {
            type: 'password', autoComplete: isRegister ? 'new-password' : 'current-password',
            minLength: isRegister ? 10 : undefined, maxLength: 128, placeholder: '••••••••••', required: true,
          }))}
          {translateText(isRegister && input('confirmPassword', 'Confirm password', {
            type: 'password', autoComplete: 'new-password', minLength: 10, maxLength: 128,
            placeholder: '••••••••••', required: true,
          }))}

          <button type="submit" className="lp-primary auth-submit" disabled={busy}>
            {isRegister ? <UserPlus size={15} /> : <LogIn size={15} />}
            {translateText(busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in')}
          </button>
        </form>

        <footer>
          <span>{translateText(isRegister ? 'Already have an account?' : 'New to Procedural Terrains?')}</span>
          <button type="button" className="lp-link" onClick={() => onSwitch(isRegister ? 'login' : 'register')}>
            {translateText(isRegister ? 'Sign in' : 'Create an account')}
          </button>
        </footer>
      </div>
      <p className="auth-local-note">{translateText("An account is optional. You can keep creating and saving projects locally.")}</p>
    </section>
  );
}
