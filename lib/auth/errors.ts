export function getAuthErrorMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Adresse e-mail ou mot de passe incorrect.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Confirmez votre adresse e-mail depuis le lien reçu avant de vous connecter.";
  }
  if (/user already registered|already been registered/i.test(message)) {
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous ou réinitialisez votre mot de passe.";
  }
  if (/too many requests|rate limit/i.test(message)) {
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  }
  if (/password/i.test(message)) {
    return "Le mot de passe ne respecte pas les exigences de sécurité configurées.";
  }
  return "La demande n’a pas abouti. Vérifiez les informations et réessayez.";
}