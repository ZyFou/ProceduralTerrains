import React from 'react';
import { ArrowLeft, Database, Eye, Fingerprint, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

const POLICY_UPDATED = 'July 23, 2026';

export default function ConfidentialityPage({ onBack }) {
  return (
    <article className="confidentiality-page" aria-labelledby="confidentiality-title">
      <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={14} /> Back to Three Terrain</button>
      <header className="confidentiality-hero">
        <span className="confidentiality-icon"><ShieldCheck size={22} aria-hidden /></span>
        <div>
          <span>Legal & privacy</span>
          <h1 id="confidentiality-title">Confidentiality &amp; privacy</h1>
          <p>How Three Terrain protects account, project, and usage information.</p>
          <small>Last updated {POLICY_UPDATED}</small>
        </div>
      </header>

      <section className="confidentiality-summary" aria-label="Privacy summary">
        <div><LockKeyhole size={17} /><strong>Private by default</strong><span>Your terrains stay private unless you choose otherwise.</span></div>
        <div><Fingerprint size={17} /><strong>No raw IP storage</strong><span>Network addresses are converted to rotating one-way identifiers.</span></div>
        <div><Eye size={17} /><strong>Limited access</strong><span>Administrative data is available only to authorized administrators.</span></div>
      </section>

      <div className="confidentiality-body">
        <section>
          <h2>Information we process</h2>
          <p>We process the information needed to provide the service: your email address, username, profile settings, password hash, active sessions, and terrains you choose to sync. Passwords are never stored in readable form.</p>
          <p>For reliability, security, and product analytics, we record page paths, visit time, referral host, limited browser/device information, authentication outcomes, and a rotating one-way network identifier. The service does not store raw IP addresses in analytics or security logs.</p>
        </section>
        <section>
          <h2>How information is used</h2>
          <p>Information is used to authenticate accounts, save and share terrains, operate the community gallery, measure service usage, investigate abuse, and maintain an accountable record of administrator actions. It is not sold or used for third-party advertising.</p>
        </section>
        <section>
          <h2>Visibility and confidentiality</h2>
          <p>New terrains are private by default. Unlisted terrains are accessible to people with their link. Public terrains may appear in the community gallery. Administrators can view terrain metadata for service operations, but the dashboard intentionally does not expose private terrain content.</p>
        </section>
        <section>
          <h2>Retention</h2>
          <div className="confidentiality-retention">
            <span><Database size={14} /><strong>Visit analytics</strong> deleted after 90 days</span>
            <span><Database size={14} /><strong>Security events</strong> deleted after 180 days</span>
            <span><Database size={14} /><strong>Admin audit events</strong> deleted after 1 year</span>
          </div>
          <p>Retention cleanup runs when the service starts and hourly thereafter. Account and terrain data are kept while the account is active or as required to provide the service. Expired sessions are removed automatically.</p>
        </section>
        <section>
          <h2>Security</h2>
          <p>Three Terrain uses HTTP-only secure session cookies in production, strict origin checks, rate limits, server-side role authorization, one-way password hashing, session revocation, and audit logging. No internet service can guarantee absolute security, so suspected incidents should be reported promptly.</p>
        </section>
        <section>
          <h2>Your choices</h2>
          <p>You can choose each terrain&apos;s visibility, edit your profile, change your password, and sign out to invalidate your current session. To request access, correction, or deletion of account information, contact the project maintainer.</p>
          <a className="confidentiality-contact" href="mailto:zyfodexe@gmail.com"><Mail size={15} /> zyfodexe@gmail.com</a>
        </section>
      </div>
    </article>
  );
}
