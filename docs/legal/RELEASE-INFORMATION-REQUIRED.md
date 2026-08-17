# ChatHouse — Legal release information required

Complete this sheet with verified facts. Do not use trading names, personal
guesses or mailboxes that are not actively monitored. A legal reviewer should
approve the final answers for every launch country.

## Publisher

- Full registered legal name:
- Legal form:
- Company/association registration number:
- Complete registered address:
- Country of establishment:
- Public business telephone:
- Governing law:
- Competent courts/dispute process:
- Counsel-reviewed liability cap and mandatory-law carve-outs:
- Competent privacy supervisory authority:

## Operated contacts

- Privacy email:
- Support email:
- Safety/moderation email:
- Child-safety email:
- Named child-safety responsible individual or function:
- Legal notices email:
- DPO name/contact, or “not appointed”:
- EU/EEA representative name/address/contact, or “not applicable”:

For each mailbox, identify the responsible person/team, monitored hours,
escalation backup and tested evidence that inbound/outbound delivery works.

## Production data map

For each provider list: legal provider name, feature, data categories, role
(processor/independent controller), DPA status, processing/storage countries,
transfer mechanism and verified retention/deletion terms.

- Hosting/runtime:
- PostgreSQL/database:
- Redis:
- Private object storage and backups:
- LiveKit:
- SMS/OTP provider:
- Push: Firebase/FCM and APNs:
- Payments/entitlements:
- Diagnostics: Sentry:
- Email: Resend or replacement:
- Android maps/tiles:
- iOS maps/tiles:
- Support/ticketing:
- Moderation tooling:
- Analytics, if any:
- Other SDKs:

## Operational policies

- Launch countries:
- Minimum age by launch country:
- Are lawful adult sexual topics/content allowed or entirely prohibited?
- Moderation hours and languages:
- Report triage targets that operations can actually meet:
- User appeal path:
- Public wording for lawful adult sexual content and the Store age-rating position:
- Emergency escalation path:
- CSAM/CSAE evidence-preservation procedure:
- Competent CSAM reporting authority/mechanism by country:
- Named child-safety responsible individual:
- Privacy-request identity-verification procedure:
- Privacy-request response workflow:
- Account/content/moderation/support retention:
- Infrastructure log retention:
- Backup retention and deletion propagation time:
- Legally retained payment/fraud records:

## Publication and evidence

- Canonical public host for legal pages:
- Privacy Policy URL:
- Terms/EULA URL:
- Community Guidelines URL:
- Child Safety Standards URL:
- Account deletion URL:
- Support URL:
- Published legal version and effective date:
- Counsel/reviewer name and approval date:
- App acceptance event/version tested:
- App Store Connect declarations completed:
- Play Console declarations and Child Safety self-certification completed:

## Production environment mapping

Every value below is required by the production backend. Supplying a syntactically
valid value is not a substitute for factual verification or legal review.

| Verified fact                                       | Environment variable                   |
| --------------------------------------------------- | -------------------------------------- |
| Registered operator                                 | `LEGAL_ENTITY_NAME`                    |
| Registered address                                  | `LEGAL_REGISTERED_ADDRESS`             |
| Registration number, or reviewed “Not applicable”   | `LEGAL_REGISTRATION_NUMBER`            |
| Governing law                                       | `LEGAL_JURISDICTION`                   |
| Courts or dispute process                           | `LEGAL_DISPUTE_PROCESS`                |
| Liability terms                                     | `LEGAL_LIABILITY_TERMS`                |
| Privacy authority                                   | `LEGAL_SUPERVISORY_AUTHORITY`          |
| International-transfer safeguards                   | `LEGAL_TRANSFER_SAFEGUARDS`            |
| DPO, or reviewed “Not appointed”                    | `LEGAL_DPO_CONTACT`                    |
| EU/EEA representative, or reviewed “Not applicable” | `LEGAL_EU_REPRESENTATIVE`              |
| Canonical immutable version                         | `LEGAL_DOCUMENT_VERSION`               |
| Effective date                                      | `LEGAL_DOCUMENT_EFFECTIVE_DATE`        |
| Exact provider inventory and roles                  | `LEGAL_SERVICE_PROVIDERS`              |
| Processing and storage locations                    | `LEGAL_PROCESSING_LOCATIONS`           |
| Log, backup and deletion-propagation retention      | `LEGAL_LOG_BACKUP_RETENTION`           |
| Support and moderation retention                    | `LEGAL_SUPPORT_MODERATION_RETENTION`   |
| Moderation appeal route                             | `LEGAL_MODERATION_APPEAL_ROUTE`        |
| Adult-content policy                                | `LEGAL_ADULT_CONTENT_POLICY`           |
| CSAM/CSAE escalation and reporting process          | `LEGAL_CHILD_SAFETY_REPORTING_PROCESS` |
| Public business telephone                           | `LEGAL_CONTACT_PHONE`                  |
| Privacy mailbox                                     | `PRIVACY_CONTACT_EMAIL`                |
| Support mailbox                                     | `SUPPORT_CONTACT_EMAIL`                |
| Safety/moderation mailbox                           | `SAFETY_CONTACT_EMAIL`                 |
| Child-safety responsible individual/function        | `CHILD_SAFETY_CONTACT_NAME`            |
| Child-safety mailbox                                | `CHILD_SAFETY_CONTACT_EMAIL`           |

After review, update `document-control.json` atomically: set `version`,
`lastReviewedDate` and `effectiveDate`, set `status` to `published`, propagate
the version to every declared file and to the mobile production environment,
then run the legal and production preflights. Never change an already accepted
version in place; issue a new version instead.
