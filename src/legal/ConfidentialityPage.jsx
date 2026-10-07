import { translateText, useLanguage } from '../i18n/LanguageContext.jsx';
import React from 'react';
import { ArrowLeft, Database, Eye, Fingerprint, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

const POLICY_UPDATED = 'July 23, 2026';

export default function ConfidentialityPage({ onBack }) {
  useLanguage();
  return (
    <article className="confidentiality-page" aria-labelledby="confidentiality-title">
      <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={14} />{translateText(" Back to Three Terrain")}</button>
      <header className="confidentiality-hero">
        <span className="confidentiality-icon"><ShieldCheck size={22} aria-hidden /></span>
        <div>
          <span>{translateText("Legal & privacy")}</span>
          <h1 id="confidentiality-title">{translateText("Confidentiality & privacy")}</h1>
          <p>{translateText("How Three Terrain protects account, project, and usage information.")}</p>
          <small>{translateText("Last updated ")}{translateText(POLICY_UPDATED)}</small>
        </div>
      </header>

      <section className="confidentiality-summary" aria-label={translateText("Privacy summary")}>
        <div><LockKeyhole size={17} /><strong>{translateText("Private by default")}</strong><span>{translateText("Your terrains stay private unless you choose otherwise.")}</span></div>
        <div><Fingerprint size={17} /><strong>{translateText("No raw IP storage")}</strong><span>{translateText("Network addresses are converted to rotating one-way identifiers.")}</span></div>
        <div><Eye size={17} /><strong>{translateText("Limited access")}</strong><span>{translateText("Administrative data is available only to authorized administrators.")}</span></div>
      </section>

      <div className="confidentiality-body">
        <section>
          <h2>{translateText("Information we process")}</h2>
          <p>{translateText("We process the information needed to provide the service: your email address, username, profile settings, password hash, active sessions, and terrains you choose to sync. Passwords are never stored in readable form.")}</p>
          <p>{translateText("For reliability, security, and product analytics, we record page paths, visit time, referral host, plugin download/support events, limited browser/device information, authentication outcomes, and a rotating one-way network identifier. The service does not store raw IP addresses in analytics or security logs.")}</p>
        </section>
        <section>
          <h2>{translateText("How information is used")}</h2>
          <p>{translateText("Information is used to authenticate accounts, save and share terrains, operate the community gallery, measure service usage, investigate abuse, and maintain an accountable record of administrator actions. It is not sold or used for third-party advertising.")}</p>
        </section>
        <section>
          <h2>{translateText("Visibility and confidentiality")}</h2>
          <p>{translateText("New terrains are private by default. Unlisted terrains are accessible to people with their link. Public terrains may appear in the community gallery. Administrators can view terrain metadata for service operations, but the dashboard intentionally does not expose private terrain content.")}</p>
        </section>
        <section>
          <h2>{translateText("Retention")}</h2>
          <div className="confidentiality-retention">
            <span><Database size={14} /><strong>{translateText("Visit analytics")}</strong>{translateText(" deleted after 90 days")}</span>
            <span><Database size={14} /><strong>{translateText("Plugin events")}</strong>{translateText(" deleted after 90 days")}</span>
            <span><Database size={14} /><strong>{translateText("Security events")}</strong>{translateText(" deleted after 180 days")}</span>
            <span><Database size={14} /><strong>{translateText("Admin audit events")}</strong>{translateText(" deleted after 1 year")}</span>
          </div>
          <p>{translateText("Retention cleanup runs when the service starts and hourly thereafter. Account and terrain data are kept while the account is active or as required to provide the service. Expired sessions are removed automatically.")}</p>
        </section>
        <section>
          <h2>{translateText("Security")}</h2>
          <p>{translateText("Three Terrain uses HTTP-only secure session cookies in production, strict origin checks, rate limits, server-side role authorization, one-way password hashing, session revocation, and audit logging. No internet service can guarantee absolute security, so suspected incidents should be reported promptly.")}</p>
        </section>
        <section>
          <h2>{translateText("Your choices")}</h2>
          <p>{translateText("You can choose each terrain's visibility, edit your profile, change your password, and sign out to invalidate your current session. To request access, correction, or deletion of account information, contact the project maintainer.")}</p>
          <a className="confidentiality-contact" href="mailto:zyfodexe@gmail.com"><Mail size={15} />{translateText(" zyfodexe@gmail.com")}</a>
        </section>
      </div>
    </article>
  );
}
