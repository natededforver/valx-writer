// ---------------------------------------------------------------------------
// Legal documents — single source of truth. Rendered inside the app (Legal
// notices in the Account modal) and used to generate the website's legal
// pages, so the two can never drift apart.
//
// Configured for: Paddle as merchant of record, Google Firebase as the cloud
// backend, operator based in India (IT Act 2000, SPDI Rules 2011, DPDP Act
// 2023, Consumer Protection Act 2019 + E-Commerce Rules 2020).
// ---------------------------------------------------------------------------

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  id: 'terms' | 'privacy' | 'refund';
  title: string;
  effectiveDate: string;
  sections: LegalSection[];
}

const CONTACT_EMAIL = 'regomusic293@gmail.com';
const GRIEVANCE_OFFICER = 'Tharun';
const GRIEVANCE_EMAIL = 'mfc3wnkdo@mozmail.com';
const OPERATOR = 'Valx Writer ("Valx", "we", "us"), operated by tchkrv, India';

export const TERMS_OF_SERVICE: LegalDoc = {
  id: 'terms',
  title: 'Terms of Service',
  effectiveDate: 'July 3, 2026',
  sections: [
    {
      heading: '1. Who we are and acceptance of these Terms',
      paragraphs: [
        `These Terms of Service ("Terms") are an electronic record under the Information Technology Act, 2000 and rules made thereunder, and form a legally binding agreement between you and ${OPERATOR}. By downloading, installing, or using the Valx Prose Writer application or creating an account, you accept these Terms. If you do not agree, do not use the Service.`,
        'You must be at least 18 years old, or use the Service under the supervision of a parent or legal guardian who agrees to these Terms on your behalf.',
      ],
    },
    {
      heading: '2. The Service',
      paragraphs: [
        'Valx Prose Writer is a minimalist writing application. Notes are stored locally on your device in a folder you choose. If you sign in and enable Cloud Sync, encrypted copies of your notes are stored with our cloud infrastructure provider (Google Firebase) so they can be synchronised across your devices.',
        'The free tier includes limited cloud storage. Paid plans ("Pro" and higher) provide additional cloud storage and features, offered as recurring subscriptions.',
      ],
    },
    {
      heading: '3. Purchases, billing and Paddle (merchant of record)',
      paragraphs: [
        'All paid subscriptions are sold by our authorised reseller and merchant of record, Paddle.com Market Limited and/or Paddle Payments Limited ("Paddle"). When you purchase a subscription, you contract with Paddle for the transaction: Paddle handles checkout, payment processing, invoicing, applicable taxes (including GST where relevant) and payment data. Paddle’s Buyer Terms (available at paddle.com/legal/checkout-buyer-terms) apply to every purchase in addition to these Terms.',
        'We never receive or store your full card or banking details. Subscription prices, billing periods and inclusions are shown at checkout. Subscriptions renew automatically at the end of each billing period until cancelled. You can cancel at any time, with effect from the end of the current billing period, via your Paddle receipt or by contacting us.',
        'We use regional pricing: subscription prices are localised to your country to reflect local affordability, so the same plan may cost a different amount in different countries. The current plans, storage inclusions and reference prices (in USD) are shown in the app under Cloud Sync & Storage and on our website; the exact price for your country, in your local currency where supported and inclusive of applicable taxes, is always displayed at Paddle checkout before you pay.',
      ],
    },
    {
      heading: '4. Your content and ownership',
      paragraphs: [
        'Everything you write in Valx belongs to you. We claim no ownership of your notes, media or other content. To operate Cloud Sync, you grant us a limited, revocable licence to store, transmit and display your content back to you and to devices you authorise — for no other purpose.',
        'You are responsible for the content you create and for maintaining backups. Local files remain on your device and are under your control at all times.',
      ],
    },
    {
      heading: '5. Acceptable use',
      paragraphs: [
        'You agree not to use the Service to store or transmit content that is unlawful under applicable law, including Indian law; to infringe intellectual-property rights of others; to attempt to gain unauthorised access to our systems or other users’ data; to reverse engineer the Service except where permitted by law; or to resell the Service without our written consent.',
        'We may suspend or terminate accounts engaged in abuse, fraud, or activity that threatens the integrity or security of the Service.',
      ],
    },
    {
      heading: '6. Third-party services',
      paragraphs: [
        'The Service is built on third-party infrastructure and integrates with third-party platforms (Google Firebase for authentication, database and storage; Google sign-in; optional sharing to services such as Gmail, WhatsApp, X, Reddit, WordPress, Medium, Bluesky, Notion, Google Docs and others). Your use of those platforms is governed by their own terms and privacy policies. We are not responsible for third-party services.',
      ],
    },
    {
      heading: '7. Intellectual property',
      paragraphs: [
        'The Valx application, its design, logos and code are our intellectual property or that of our licensors, protected by applicable copyright and trademark laws. We grant you a personal, non-exclusive, non-transferable, revocable licence to install and use the application on devices you own or control for personal or internal business use.',
      ],
    },
    {
      heading: '8. Disclaimers',
      paragraphs: [
        'The Service is provided "as is" and "as available". To the maximum extent permitted by applicable law, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not warrant that the Service will be uninterrupted, error-free or that data loss will never occur — keep local backups of important work.',
      ],
    },
    {
      heading: '9. Limitation of liability',
      paragraphs: [
        'To the maximum extent permitted by law, our aggregate liability for all claims arising out of or relating to the Service shall not exceed the amounts you paid for the Service in the twelve (12) months preceding the claim (or INR 1,000 if you have not made any payment). We are not liable for indirect, incidental, special, consequential or punitive damages, or for loss of profits, data or goodwill.',
        'Nothing in these Terms limits liability that cannot be limited under applicable law, including under the Consumer Protection Act, 2019.',
      ],
    },
    {
      heading: '10. Indemnity',
      paragraphs: [
        'You agree to indemnify and hold us harmless from claims, damages and expenses (including reasonable legal fees) arising from your content, your misuse of the Service, or your violation of these Terms or applicable law.',
      ],
    },
    {
      heading: '11. Termination',
      paragraphs: [
        'You may stop using the Service at any time, and you may delete your account directly in the app (Account → Delete my account). Account deletion requires you to re-confirm your identity with Google sign-in and is immediate and irreversible: your account, all cloud-stored notes and folders, and any remaining paid subscription period are permanently deleted with no recovery and no refund of the unused period. Your local files remain on your device and are never touched.',
        'We may suspend or terminate the Service or your access for material breach of these Terms, where required by law, or upon discontinuation of the Service with reasonable notice. Upon termination, your local files remain yours; cloud data will be deleted in accordance with our Privacy Policy.',
      ],
    },
    {
      heading: '12. Changes to the Service or Terms',
      paragraphs: [
        'We may update these Terms from time to time. Material changes will be notified in-app or by email at least 15 days before they take effect. Continued use after the effective date constitutes acceptance. The "Effective date" above always reflects the latest version.',
      ],
    },
    {
      heading: '13. Governing law and dispute resolution',
      paragraphs: [
        'These Terms are governed by the laws of India. Subject to any mandatory consumer-protection rights, courts at the operator’s place of business in India shall have exclusive jurisdiction. Consumers may also approach consumer fora under the Consumer Protection Act, 2019. For purchases, Paddle’s Buyer Terms may provide additional dispute channels.',
      ],
    },
    {
      heading: '14. Grievance redressal and contact',
      paragraphs: [
        `In accordance with the Information Technology Act, 2000, the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data Protection Act, 2023, complaints and grievances may be addressed to the Grievance Officer, ${GRIEVANCE_OFFICER}, at ${GRIEVANCE_EMAIL}. We aim to acknowledge grievances within 48 hours and resolve them within 30 days.`,
      ],
    },
  ],
};

export const PRIVACY_POLICY: LegalDoc = {
  id: 'privacy',
  title: 'Privacy Policy',
  effectiveDate: 'July 3, 2026',
  sections: [
    {
      heading: '1. Scope',
      paragraphs: [
        `This Privacy Policy explains how ${OPERATOR} collects, uses and protects your personal data when you use Valx Prose Writer. It is published in accordance with the Information Technology Act, 2000, the SPDI Rules, 2011 and the Digital Personal Data Protection Act, 2023 ("DPDP Act"), under which we act as the data fiduciary for the personal data described below.`,
      ],
    },
    {
      heading: '2. Data we collect',
      paragraphs: [
        'Account data: when you sign in with Google we receive your name, email address and Google account identifier. We do not receive your Google password.',
        'Content data: only if you enable Cloud Sync, the notes and folders you choose to sync (including any embedded media) are stored in our cloud database to provide synchronisation. If Cloud Sync is off, your notes never leave your device.',
        'Usage and diagnostic data: basic operational metadata such as storage usage per account and error logs necessary to run the Service.',
        'Payment data: purchases are processed entirely by Paddle, our merchant of record. Paddle collects and processes your payment details under its own privacy policy; we receive only transaction confirmations (plan, status, region) — never card numbers.',
        'Local data: preferences (theme, file format, workspace location) are stored locally on your device and are not transmitted to us.',
      ],
    },
    {
      heading: '3. Purposes and legal basis',
      paragraphs: [
        'We process personal data with your consent and for legitimate purposes connected to providing the Service: authenticating you, synchronising your content across devices, enforcing storage quotas, providing support, processing subscriptions through Paddle, and complying with legal obligations. We do not sell personal data and we do not use the content of your notes for advertising or for training machine-learning models.',
      ],
    },
    {
      heading: '4. Storage, processors and transfers',
      paragraphs: [
        'Cloud data is stored with Google Firebase (Google Cloud), which acts as our data processor and applies industry-standard security (encryption in transit and at rest). Google Cloud infrastructure may store data in data centres outside India; by enabling Cloud Sync you consent to such cross-border storage as permitted under the DPDP Act. Paddle processes payment data as an independent merchant of record.',
      ],
    },
    {
      heading: '5. Retention and deletion',
      paragraphs: [
        'Synced content is retained while your account is active. Notes you delete are removed from active sync and permanently deleted using tombstone records (retained up to 90 days to propagate deletions across devices). Local files on your device are never touched by account deletion.',
        'You can delete your account directly in the app (Account → Delete my account). After you re-confirm your identity with Google sign-in, your account, all cloud-stored notes and folders, your account record, and any remaining paid subscription period are deleted immediately and permanently — there is no recovery. If you instead request deletion by email or withdraw consent, associated cloud data is deleted within 30 days except where retention is required by law.',
      ],
    },
    {
      heading: '6. Your rights',
      paragraphs: [
        'Under the DPDP Act you have the right to access a summary of your personal data, correct or complete it, erase it, nominate a person to exercise your rights in case of death or incapacity, and to grievance redressal. You can exercise these rights from within the app (export, delete) or by writing to the contact below. You may withdraw consent for Cloud Sync at any time by turning it off — the Service continues to work fully offline.',
      ],
    },
    {
      heading: '7. Security',
      paragraphs: [
        'We follow reasonable security practices and procedures as required by the SPDI Rules: encrypted transport (TLS), encryption at rest on Google Cloud, scoped per-user database rules so one account can never read another’s notes, and least-privilege access. No method of storage is 100% secure; keep independent backups of critical work.',
        'In the event of a personal data breach affecting you, we will notify you and the Data Protection Board of India as required by the DPDP Act.',
      ],
    },
    {
      heading: '8. Children',
      paragraphs: [
        'The Service is not directed at children. Users under 18 may use the Service only with verifiable parental consent as required by the DPDP Act. We do not knowingly process children’s data or undertake tracking or targeted advertising directed at children.',
      ],
    },
    {
      heading: '9. Cookies and local storage',
      paragraphs: [
        'The desktop app uses browser local storage and IndexedDB on your own device to keep preferences, sync metadata and your session. Our website uses only essential storage; we do not run third-party advertising trackers.',
      ],
    },
    {
      heading: '10. Changes',
      paragraphs: [
        'We will notify you of material changes to this policy in-app or by email before they take effect. The effective date above reflects the latest version.',
      ],
    },
    {
      heading: '11. Grievance Officer and contact',
      paragraphs: [
        `Grievance Officer (IT Act, 2000 / DPDP Act, 2023): ${GRIEVANCE_OFFICER}, reachable at ${GRIEVANCE_EMAIL}. We acknowledge privacy grievances within 48 hours and resolve them within 30 days. If you are not satisfied, you may escalate to the Data Protection Board of India.`,
      ],
    },
  ],
};

export const REFUND_POLICY: LegalDoc = {
  id: 'refund',
  title: 'Refund Policy',
  effectiveDate: 'July 3, 2026',
  sections: [
    {
      heading: '1. Summary',
      paragraphs: [
        'Valx subscriptions are digital services that begin immediately on purchase. As a general rule, payments are non-refundable once a billing period has started. This policy explains the limited cases where refunds are available and how to request one.',
      ],
    },
    {
      heading: '2. Purchases are processed by Paddle',
      paragraphs: [
        'All payments are handled by Paddle, our merchant of record. Refunds, where applicable, are issued by Paddle to your original payment method, and Paddle’s Buyer Terms apply alongside this policy. Taxes collected on the transaction are refunded together with any approved refund.',
      ],
    },
    {
      heading: '3. When refunds are provided',
      paragraphs: [
        'Duplicate or erroneous charges: charges made in error (for example, double billing for the same period) are refunded in full.',
        'Statutory rights: where applicable law grants you a non-waivable right to a refund — including rights of consumers under the (Indian) Consumer Protection Act, 2019, or a mandatory cooling-off period in your jurisdiction that has not been waived by commencing use of the digital service — we honour that right.',
        'Upstream refunds: where our infrastructure provider (Google Firebase) refunds us the full corresponding amount for a verified service failure affecting your subscription, we will pass the refunded amount through to you. Such upstream refunds are exceptional and outside our control.',
        'Extended outages: if a paid feature is continuously unavailable for more than 7 days due to a fault on our side, you may request a pro-rata credit or refund for the affected period.',
      ],
    },
    {
      heading: '4. When refunds are not provided',
      paragraphs: [
        'Change of mind after the billing period has started; partial-period cancellations (service continues until the period ends); failure to cancel before renewal (set a reminder — renewal receipts include a cancellation link); account suspension or termination for breach of the Terms of Service; and issues caused by third-party services or your own device or network.',
        'Deleting your account from within the app is immediate and irreversible: any remaining paid subscription period is forfeited at the moment of deletion and is not refunded.',
      ],
    },
    {
      heading: '5. Cancellation',
      paragraphs: [
        'You can cancel your subscription at any time via the link in your Paddle receipt or by contacting us. Cancellation stops future renewals; you keep paid features until the end of the current billing period. Your notes always remain accessible: local files stay on your device, and free-tier cloud storage continues to apply.',
      ],
    },
    {
      heading: '6. How to request a refund',
      paragraphs: [
        `Email ${CONTACT_EMAIL} from your account email within 30 days of the charge, including the Paddle order number from your receipt. Eligible refunds are processed by Paddle within 5–10 business days of approval. Grievances about refund decisions may be escalated to the Grievance Officer, ${GRIEVANCE_OFFICER}, at ${GRIEVANCE_EMAIL}.`,
      ],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMS_OF_SERVICE, PRIVACY_POLICY, REFUND_POLICY];
