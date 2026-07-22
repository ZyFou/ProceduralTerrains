import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createPortal } from 'react-dom';

const PopupContext = createContext(null);
const ICONS = { error: AlertTriangle, success: CheckCircle2, info: Info };

function Notice({ notice, onDismiss }) {
  const Icon = ICONS[notice.type] || Info;

  useEffect(() => {
    if (!notice.duration) return undefined;
    const timer = window.setTimeout(() => onDismiss(notice.id), notice.duration);
    return () => window.clearTimeout(timer);
  }, [notice.duration, notice.id, onDismiss]);

  return (
    <div className={`app-popup-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
      <span className="app-popup-notice-icon"><Icon size={17} aria-hidden /></span>
      <span className="app-popup-notice-copy">
        {notice.title && <strong>{notice.title}</strong>}
        <span>{notice.message}</span>
      </span>
      <button type="button" onClick={() => onDismiss(notice.id)} aria-label="Dismiss notification">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

function PopupDialog({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.initialValue ?? '');
  const inputRef = useRef(null);
  const cancelValue = dialog.kind === 'prompt' ? null : false;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose(cancelValue);
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [cancelValue, onClose]);

  const submit = (event) => {
    event.preventDefault();
    onClose(dialog.kind === 'prompt' ? value : true);
  };

  return (
    <div className="app-popup-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose(cancelValue)}>
      <form className={`app-popup-dialog${dialog.danger ? ' danger' : ''}`} role={dialog.danger ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="app-popup-title" onSubmit={submit}>
        <header>
          <span className="app-popup-dialog-icon">
            {dialog.danger ? <AlertTriangle size={18} aria-hidden /> : <Info size={18} aria-hidden />}
          </span>
          <span>
            <h2 id="app-popup-title">{dialog.title}</h2>
            {dialog.message && <p>{dialog.message}</p>}
          </span>
          <button type="button" className="app-popup-dialog-close" onClick={() => onClose(cancelValue)} aria-label="Close popup"><X size={15} aria-hidden /></button>
        </header>
        {dialog.kind === 'prompt' && (
          <label className="app-popup-dialog-field">
            <span>{dialog.inputLabel || dialog.title}</span>
            <input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={dialog.maxLength}
              required={dialog.required !== false}
            />
          </label>
        )}
        <footer>
          <button type="button" className="app-popup-cancel" onClick={() => onClose(cancelValue)}>{dialog.cancelLabel || 'Cancel'}</button>
          <button ref={dialog.kind === 'prompt' ? undefined : inputRef} type="submit" className={`app-popup-confirm${dialog.danger ? ' danger' : ''}`}>
            {dialog.confirmLabel || (dialog.kind === 'prompt' ? 'Save' : 'Confirm')}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function PopupProvider({ children }) {
  const [notices, setNotices] = useState([]);
  const [dialog, setDialog] = useState(null);
  const nextId = useRef(0);
  const dialogRef = useRef(null);

  const dismissPopup = useCallback((id) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const showPopup = useCallback((message, options = {}) => {
    if (!message) return null;
    const type = options.type || 'info';
    const id = ++nextId.current;
    const notice = {
      id,
      message: String(message),
      title: options.title,
      type,
      duration: options.duration ?? (type === 'error' ? 7000 : 4500),
    };
    setNotices((current) => [...current.slice(-3), notice]);
    return id;
  }, []);

  const openDialog = useCallback((config) => new Promise((resolve) => {
    if (dialogRef.current) {
      const previous = dialogRef.current;
      previous.resolve(previous.kind === 'prompt' ? null : false);
    }
    const next = { ...config, resolve, id: ++nextId.current };
    dialogRef.current = next;
    setDialog(next);
  }), []);

  const showConfirm = useCallback((options) => {
    const config = typeof options === 'string' ? { message: options } : options;
    return openDialog({ kind: 'confirm', title: 'Please confirm', ...config });
  }, [openDialog]);

  const showPrompt = useCallback((options) => {
    const config = typeof options === 'string' ? { title: options } : options;
    return openDialog({ kind: 'prompt', title: 'Enter a value', ...config });
  }, [openDialog]);

  const closeDialog = useCallback((result) => {
    const current = dialogRef.current;
    if (!current) return;
    dialogRef.current = null;
    setDialog(null);
    current.resolve(result);
  }, []);

  return (
    <PopupContext.Provider value={{ showPopup, showConfirm, showPrompt }}>
      {children}
      {createPortal(
        <>
          <div className="app-popup-stack" aria-live="polite" aria-atomic="false">
            {notices.map((notice) => <Notice key={notice.id} notice={notice} onDismiss={dismissPopup} />)}
          </div>
          {dialog && <PopupDialog key={dialog.id} dialog={dialog} onClose={closeDialog} />}
        </>,
        document.body,
      )}
    </PopupContext.Provider>
  );
}

export function usePopup() {
  const context = useContext(PopupContext);
  if (!context) throw new Error('usePopup must be used inside PopupProvider.');
  return context;
}
