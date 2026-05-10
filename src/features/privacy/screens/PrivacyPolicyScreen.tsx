import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../../shared/constants/theme';

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.body}>{children}</Text>
);

/**
 * Static privacy policy. Kept in-app rather than as a remote URL so it
 * works offline and the version reviewed at build time matches what the
 * user sees. Update this file alongside any data-handling change.
 */
export const PrivacyPolicyScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxl,
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom + spacing.giant,
        gap: spacing.lg,
      }}
    >
      <View>
        <Text style={styles.h1}>Politique de confidentialité</Text>
        <Text style={styles.lastUpdated}>Dernière mise à jour : 25 avril 2026</Text>
      </View>

      <Section title="1. Quelles données nous collectons">
        <P>
          • Données de compte : numéro de téléphone, nom d&apos;utilisateur, photo de profil,
          biographie, liens sociaux (optionnels).
        </P>
        <P>
          • Contenu : rooms hébergées, participations, messages directs, messages dans les rooms,
          réactions, demandes de prise de parole.
        </P>
        <P>
          • Métadonnées : date de création, dernière connexion, listes de followers, intérêts, rôle
          plateforme.
        </P>
        <P>
          • Géolocalisation (optionnelle, après consentement) : utilisée uniquement pour la
          fonctionnalité de carte. Stockée à la précision la plus basse compatible.
        </P>
        <P>
          • Données techniques : adresse IP, agent utilisateur, tokens d&apos;appareil pour les
          notifications push.
        </P>
      </Section>

      <Section title="2. Pourquoi nous les collectons">
        <P>• Fournir le service : créer un compte, joindre des rooms, échanger des messages.</P>
        <P>
          • Modération : signalements, suspensions et bannissements (intérêt légitime — sécurité de
          la communauté).
        </P>
        <P>
          • Notifications : informer des invitations, rooms démarrant, messages reçus (vous pouvez
          les désactiver dans les paramètres).
        </P>
        <P>
          • Statistiques anonymes (optionnel) : crash reports, télémétrie. Désactivé par défaut.
        </P>
      </Section>

      <Section title="3. Avec qui nous les partageons">
        <P>• Aucune vente. Aucune publicité tierce.</P>
        <P>
          • Sous-traitants techniques uniquement, sous contrat conforme RGPD : hébergement
          (serveur), envoi de SMS d&apos;authentification, notifications push.
        </P>
        <P>
          • En cas d&apos;obligation légale, réquisition judiciaire ou protection d&apos;une
          personne en danger.
        </P>
      </Section>

      <Section title="4. Combien de temps">
        <P>• Profil et contenu : tant que votre compte est actif.</P>
        <P>• Suppression du compte : 30 jours de période de grâce, puis purge définitive.</P>
        <P>• Logs techniques : 90 jours.</P>
        <P>
          • Journal de modération (signalements, suspensions) : conservé 1 an pour la conformité.
        </P>
      </Section>

      <Section title="5. Vos droits (RGPD)">
        <P>
          • Accès et portabilité : exportez l&apos;intégralité de vos données via Paramètres →
          Confidentialité → Exporter mes données.
        </P>
        <P>• Rectification : modifiez votre profil à tout moment.</P>
        <P>
          • Effacement : supprimez votre compte (Paramètres → Confidentialité → Supprimer mon
          compte).
        </P>
        <P>
          • Opposition : désactivez les notifications, le partage de localisation, ou le crash
          reporting depuis les paramètres.
        </P>
        <P>
          • Réclamation : vous pouvez saisir l&apos;autorité de contrôle compétente (CNIL en
          France).
        </P>
      </Section>

      <Section title="6. Sécurité">
        <P>• Mots de passe et codes OTP stockés sous forme hashée (bcrypt).</P>
        <P>• Tokens d&apos;authentification stockés dans le keychain sécurisé du téléphone.</P>
        <P>
          • Tous les échanges réseau sont chiffrés en HTTPS/TLS. Les flux audio sont chiffrés en
          DTLS-SRTP.
        </P>
      </Section>

      <Section title="7. Contact">
        <P>
          Pour toute question relative à vos données :{' '}
          <Text style={styles.email}>privacy@chathouse.app</Text>
        </P>
      </Section>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  lastUpdated: { color: colors.textMuted, fontSize: 11 },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  sectionBody: { gap: 6 },
  email: { color: colors.primary },
});
