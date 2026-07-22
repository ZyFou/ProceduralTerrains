import React, { useState } from 'react';
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react';
import { APP_NAME } from '../constants/app.js';
import { Logo } from '../landing/shared.jsx';
import { useAuth } from './AuthContext.jsx';

const initialFields = { email: '', username: '', identifier: '', password: '', confirmPassword: '' };

export default function AuthPage({ mode, onBack, onSwitch, onSuccess }) {
  const isRegister = mode === 'register';
  const { login, register } = useAuth();
  const [fields, setFields] = useState(initialFields);
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const change = (name) => (event) => {
    const value = event.target.value;
    setFields((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
    setMessage('');
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
    setMessage('');
    setFieldErrors({});
    try {
      if (isRegister) {
        await register({ email: fields.email, username: fields.username, password: fields.password });
      } else {
        await login({ identifier: fields.identifier, password: fields.password });
      }
      onSuccess();
    } catch (error) {
      setMessage(error.message || 'The request could not be completed.');
      setFieldErrors(error.fields ?? {});
    } finally {
      setBusy(false);
    }
  };

  const input = (name, label, properties = {}) => (
    <label className={`auth-field${fieldErrors[name] ? ' has-error' : ''}`}>
      <span>{label}</span>
      <input
        name={name}
        value={fields[name]}
        onChange={change(name)}
        aria-invalid={!!fieldErrors[name]}
        aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
        disabled={busy}
        {...properties}
      />
      {fieldErrors[name] && <small id={`${name}-error`}>{fieldErrors[name]}</small>}
    </label>
  );

  return (
    <section className="auth-page" aria-labelledby="auth-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> Back to projects</button>
      <div className="auth-card">
        <header>
          <span className="auth-mark"><Logo size={25} /></span>
          <div>
            <small>{APP_NAME}</small>
            <h1 id="auth-title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
            <p>{isRegister ? 'Keep your identity ready for cloud projects and sharing.' : 'Sign in to access your account. Local projects remain on this device.'}</p>
          </div>
        </header>

        <form onSubmit={submit} noValidate>
          {isRegister && input('username', 'Username', {
            type: 'text', autoComplete: 'username', minLength: 3, maxLength: 32,
            pattern: '[a-zA-Z0-9_]+', placeholder: 'terrain_creator', required: true,
          })}
          {isRegister
            ? input('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 320, placeholder: 'you@example.com', required: true })
            : input('identifier', 'Email or username', { type: 'text', autoComplete: 'username', maxLength: 320, placeholder: 'you@example.com', required: true })}
          {input('password', 'Password', {
            type: 'password', autoComplete: isRegister ? 'new-password' : 'current-password',
            minLength: isRegister ? 10 : undefined, maxLength: 128, placeholder: '••••••••••', required: true,
          })}
          {isRegister && input('confirmPassword', 'Confirm password', {
            type: 'password', autoComplete: 'new-password', minLength: 10, maxLength: 128,
            placeholder: '••••••••••', required: true,
          })}

          {message && <div className="auth-error" role="alert">{message}</div>}

          <button type="submit" className="lp-primary auth-submit" disabled={busy}>
            {isRegister ? <UserPlus size={15} /> : <LogIn size={15} />}
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <footer>
          <span>{isRegister ? 'Already have an account?' : 'New to Procedural Terrains?'}</span>
          <button type="button" className="lp-link" onClick={() => onSwitch(isRegister ? 'login' : 'register')}>
            {isRegister ? 'Sign in' : 'Create an account'}
          </button>
        </footer>
      </div>
      <p className="auth-local-note">An account is optional. You can keep creating and saving projects locally.</p>
    </section>
  );
}
