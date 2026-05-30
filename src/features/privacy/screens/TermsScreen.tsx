import React from 'react';
import { LegalDoc, LegalParagraph as P, LegalSection as Section } from '../components/LegalDoc';

export const TermsScreen: React.FC = () => {
  return (
    <LegalDoc title="Conditions d'utilisation" lastUpdated="Dernière mise à jour : 25 avril 2026">
      <Section title="1. Acceptation">
        <P>
          En créant un compte ou en utilisant l&apos;application Chathouse, vous acceptez les
          présentes conditions d&apos;utilisation. Si vous n&apos;acceptez pas l&apos;intégralité
          des termes, n&apos;utilisez pas le service.
        </P>
      </Section>

      <Section title="2. Éligibilité">
        <P>
          Vous devez avoir au moins 16 ans pour utiliser Chathouse. En dessous de cet âge, vous
          devez obtenir le consentement explicite de votre représentant légal.
        </P>
      </Section>

      <Section title="3. Comportements interdits">
        <P>• Harcèlement, discrimination, propos haineux, contenu sexuel non consenti.</P>
        <P>• Usurpation d&apos;identité, faux comptes, automatisation non autorisée (bots).</P>
        <P>
          • Diffusion d&apos;œuvres protégées sans droits, contenu illégal selon la loi applicable.
        </P>
        <P>• Spam, hameçonnage, ingénierie sociale, exploitation de vulnérabilités.</P>
        <P>
          • Enregistrement d&apos;une room sans le consentement explicite de tous les participants.
        </P>
      </Section>

      <Section title="4. Modération">
        <P>
          Nous nous réservons le droit de suspendre ou supprimer tout compte en violation, sans
          préavis. Toutes les actions de modération sont journalisées et auditables.
        </P>
        <P>Vous pouvez signaler un utilisateur ou une room directement dans l&apos;interface.</P>
      </Section>

      <Section title="5. Contenu utilisateur">
        <P>
          Vous conservez l&apos;intégralité des droits sur le contenu que vous publiez. Vous nous
          accordez une licence non exclusive de stockage et de diffusion strictement nécessaire au
          fonctionnement du service.
        </P>
        <P>
          La fin de votre compte met fin à cette licence (sauf contenu déjà reçu par d&apos;autres
          utilisateurs sous forme de messages directs).
        </P>
      </Section>

      <Section title="6. Limitation de responsabilité">
        <P>
          Le service est fourni « en l&apos;état ». Nous ne garantissons pas qu&apos;il sera
          disponible sans interruption, ni que tout contenu publié par les utilisateurs respecte la
          loi.
        </P>
      </Section>

      <Section title="7. Modifications">
        <P>
          Ces conditions peuvent évoluer. Toute modification substantielle vous sera signalée par
          notification dans l&apos;application au moins 30 jours avant entrée en vigueur.
        </P>
      </Section>

      <Section title="8. Loi applicable">
        <P>
          Les présentes conditions sont régies par le droit français. Tout litige relèvera de la
          compétence des tribunaux français, sauf disposition impérative contraire.
        </P>
      </Section>
    </LegalDoc>
  );
};
