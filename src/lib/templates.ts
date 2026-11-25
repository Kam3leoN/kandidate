import type { Application, Profile } from '../../shared/types.js';
import { analyzeAd, matchProfile } from '../../shared/analysis/index.js';

const dateFr = (d: string | null): string => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '');

/** Follow-up email drafts (relances) adapted to the stage of the application. */
export function followupTemplate(a: Application, p: Profile): { subject: string; body: string; kind: string } {
  const hello = a.contactName ? `Bonjour ${a.contactName},` : 'Bonjour,';
  const sign = [p.fullName, p.headline, p.phone, p.email].filter(Boolean).join('\n');
  let pitch = '';
  if (a.description) {
    const m = matchProfile(analyzeAd({ text: a.description, title: a.title, extraSkills: p.skills }), p);
    const top = m.matchedSkills.slice(0, 3);
    if (top.length) pitch = ` Mon expérience en ${top.length > 1 ? `${top.slice(0, -1).join(', ')} et ${top[top.length - 1]}` : top[0]} correspond directement aux besoins décrits dans l’annonce.`;
  }
  const where = a.company ? ` au sein de ${a.company}` : '';

  if (a.status === 'interview' || a.status === 'offer') {
    return {
      kind: 'Après entretien',
      subject: `Merci pour notre échange — ${a.title}`,
      body: `${hello}

Je vous remercie pour le temps que vous m’avez accordé lors de notre entretien pour le poste de ${a.title}${where}. Nos échanges ont renforcé mon envie de rejoindre l’équipe.${pitch}

Je reste à votre disposition pour toute information complémentaire et serais ravi(e) de connaître les prochaines étapes du processus.

Bien cordialement,
${sign}`,
    };
  }
  if (a.followupCount >= 1) {
    return {
      kind: `Relance n°${a.followupCount + 1}`,
      subject: `Candidature ${a.title} — toujours motivé(e)`,
      body: `${hello}

Je reviens vers vous au sujet de ma candidature au poste de ${a.title}${where}${a.appliedAt ? `, transmise le ${dateFr(a.appliedAt)}` : ''}. Je reste très intéressé(e) par cette opportunité.${pitch}

Pour faciliter votre décision, je peux vous partager des exemples de réalisations ou échanger 15 minutes par téléphone au moment qui vous convient.

Bien cordialement,
${sign}`,
    };
  }
  return {
    kind: 'Première relance',
    subject: `Suivi de ma candidature — ${a.title}`,
    body: `${hello}

Je me permets de revenir vers vous concernant ma candidature au poste de ${a.title}${where}${a.appliedAt ? `, envoyée le ${dateFr(a.appliedAt)}` : ''}.${pitch}

Ce poste m’intéresse vivement : seriez-vous disponible pour un premier échange dans les prochains jours ?

Bien cordialement,
${sign}`,
  };
}

export function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
