# Migrations Supabase

Les migrations de ce dépôt sont des scripts SQL à appliquer manuellement dans le
SQL Editor Supabase. Leur présence dans le dépôt ne signifie pas qu'elles ont
été appliquées à un projet distant.

## Parcours principal

Le tableau de bord n’exige plus d’entreprise et n’appelle pas les RPC de
`002_company_onboarding_rpcs.sql`. Cette migration peut rester inutilisée dans
le parcours principal; le fichier est conservé sans modification. Les
paramètres lisent directement `company_members` et `companies` avec la session
authentifiée, et la RLS existante continue de contrôler la lecture et l’écriture.

## Profil d'entreprise

`003_company_profile_fields.sql` ajoute des colonnes optionnelles à la table
`companies` existante pour les informations du profil. Le nom légal réutilise
`companies.name`; le pays et la devise réutilisent les colonnes `country` et
`currency`. Aucun champ de logo n’existait dans le schéma local, il n’est donc
pas ajouté.

Cette migration n’a pas été appliquée à une base distante. Avant application,
confirmez que la table `public.companies` existe et inspectez son schéma avec
`000_remote_schema_inventory.sql`. Sans entreprise associée, les paramètres
restent accessibles, mais la sauvegarde d’informations d’entreprise n’a pas de
cible et aucune entreprise n’est créée automatiquement.

## Factures saisies manuellement

Le module Factures réutilise `public.invoices`, ses montants existants et ses
politiques RLS. Pour activer les factures manuelles, appliquer dans l’ordre
`004_invoice_draft_status.sql`, `005_manual_invoices.sql`, puis
`006_optional_data_ownership.sql`. La première ajoute le statut `draft`; la
seconde autorise `document_id` à être NULL pour les factures saisies sans
document et ajoute `description` ainsi que des contraintes pour les champs,
dates et montants des nouvelles factures manuelles. La sixième migration rend
`company_id` facultatif, ajoute `user_id` et une politique RLS additive pour
les factures personnelles. Les données existantes conservent leur entreprise
et la politique entreprise initiale n’est pas modifiée.

Ces migrations ne sont pas appliquées automatiquement à Supabase. Une
contrainte garantit qu’une facture appartient soit à un utilisateur, soit à
une entreprise, jamais aux deux. Les accès personnels passent par
`user_id = auth.uid()`; les accès d’entreprise restent gouvernés par
`invoices_member_access`. Tester sur une base de préproduction les opérations
et l’isolation entre deux utilisateurs et deux entreprises avant le déploiement.

## Dépenses

`009_expenses.sql` crée `public.expenses` pour les dépenses personnelles et
d’entreprise, avec statut, devise, date, catégorie, notes et fournisseur
facultatif. Elle conserve la séparation exclusive `user_id`/`company_id`,
active la RLS et limite l’écriture d’entreprise aux rôles déjà autorisés à
gérer les contacts (`owner`, `admin`, `accountant`). Un fournisseur associé
doit appartenir au même espace. Cette migration dépend de `006` et `008` et
doit être inspectée puis appliquée manuellement après ces prérequis. Sa présence
dans le dépôt ne confirme pas qu’elle a été appliquée à Supabase.

## Documents

Le module Documents repose sur `public.documents` et le bucket privé
`documents`. `001_initial_schema.sql` contient déjà une première définition de
la table, du bucket et des policies Storage, mais sa présence ne prouve pas
qu’elle est appliquée à la base distante. `010_documents_storage.sql` est un
complément idempotent pour installer ou sécuriser la table, le bucket privé
(PDF/JPG/PNG, 10 Mio) et des policies de membre. Il utilise les objets
`companies`, `company_members`, `public.is_company_member(uuid)` et le schéma
Supabase Storage.

`011_document_registry.sql` ajoute les catégories et statuts documentaires
avec des valeurs par défaut compatibles avec les documents déjà stockés. Il
requiert la table `public.documents` créée par `001_initial_schema.sql` ou
`010_documents_storage.sql`. Appliquez d’abord les migrations requises dans
l’ordre approprié après avoir vérifié le schéma et les policies de la base
cible. Les documents existants reçoivent la catégorie `other` et le statut
`to_process`; ces valeurs ne décrivent pas le statut de paiement d’une facture.
Cette migration n’ajoute aucune relation vers une dépense ou un devis et sa
présence dans le dépôt ne confirme pas son application distante.

Avant toute application, inspectez le schéma, l’état du bucket et toutes les
policies Storage existantes. La migration force le bucket `documents` en privé
et ajuste ses limites/types autorisés. Elle ne doit être appliquée
manuellement qu’après vérification de son effet sur les usages distants. Les
migrations 001 et 010 imposent initialement un propriétaire entreprise.
`013_personal_documents.sql` est une migration additive qui rend
`company_id` nullable, ajoute `user_id`, impose un propriétaire unique par
document et ajoute des policies RLS/Storage personnelles. Les documents
d’entreprise restent inchangés. Les chemins personnels utilisent
`<user UUID>/personal/<fichier>`; les policies entreprise excluent ce dossier,
y compris si un UUID utilisateur correspondait à un UUID entreprise. Dans le
cas standard, appliquez 010, puis 011, puis 013; si une migration antérieure
fournit déjà un schéma et un bucket équivalents, vérifiez-les au préalable.
Cette migration doit être inspectée puis appliquée manuellement; sa présence
ici ne signifie pas qu’elle est appliquée à Supabase. Les documents sont
consultés via des URL signées de courte durée.
Une relation facture peut exister pour un document d’entreprise via
`invoices.document_id`; les clients et fournisseurs ne sont exposés comme
relations que via les identifiants de partie portés par cette facture. Le
schéma ne lie pas directement les documents aux dépenses ou devis.

`012_invoice_document_links.sql` ajoute une unicité sur le document source d’une
facture et une clé étrangère restrictive composite qui impose la même entreprise
des deux côtés. Elle requiert `documents` ainsi que `invoices.document_id` et
`invoices.company_id`. Appliquez-la manuellement après `010` et `011`, après
vérification du schéma distant et de l’historique des migrations. Elle échoue
sans corriger ni supprimer de données si des liens existants sont dupliqués,
absents ou inter-entreprises. L’index unique empêche aussi les doubles créations
concurrentes ; le code vérifie également le lien côté serveur. Cette migration
n’a pas été appliquée à Supabase.

L’import personnel ne fonctionnera qu’après inspection et application
manuelle de `013_personal_documents.sql` sur le projet Supabase cible. Cette
migration n’est exécutée ni par l’application ni par les tests.

## Correction Supabase géré des automatisations (migration 016)

Les diagnostics du projet cible ont confirmé que `public.expenses`,
`public.invoices` et `public.documents` existent, que les deux tables
`recurring_expenses` et `expense_payments` sont absentes, et que le rôle
`postgres` n'est pas superutilisateur mais peut appeler
`cron.schedule(text,text,text)`. Les migrations 014 et 015 historiques
exigeaient `rolsuper = true`; 014 utilisait également `SET ROLE`. Une erreur
pendant leur transaction annule leurs créations, ce qui explique les tables
absentes.

**Ne réappliquez pas les scripts historiques 014 ou 015.** Appliquez le fichier
complet `016_supabase_managed_schedulers.sql` dans le SQL Editor Supabase, après
avoir vérifié que les migrations métier 006, 008, 009, 010, 011, 012 et 013
sont déjà installées. Le script est local uniquement et n'a pas été exécuté
sur une base distante. Il crée/répare les colonnes, tables, contraintes,
index, RLS, RPC et triggers nécessaires, puis remplace idempotemment les trois
jobs nommés. Il n'exige ni rôle superutilisateur, ni `CREATE` sur `cron`, ni
`SET ROLE`, et ne crée pas d'extension ni de rôle.

Les fonctions planifiées sont détenues par le rôle qui applique la migration,
utilisent `SECURITY DEFINER`, `search_path` vide et un `row_security` explicite.
Le préflight exige les droits effectifs, la propriété nécessaire des tables,
les signatures Cron exécutables et l'absence de jobs conflictuels détenus par
un autre rôle/base. Il échoue explicitement si ces garanties ne sont pas
réunies. Les fonctions de facture ne modifient que `pending`/`receivable`
échues ; les fonctions de dépenses ne modifient que `pending` échues. Les
occurrences récurrentes sont protégées par une contrainte unique et `ON
CONFLICT DO NOTHING`.

**Contenu SQL exact à exécuter :** le contenu intégral et inchangé de
[`016_supabase_managed_schedulers.sql`](./016_supabase_managed_schedulers.sql),
une fois, dans le SQL Editor du bon projet. Vérifiez l'absence d'erreur avant
de considérer la migration appliquée. Les trois tâches doivent avoir ces
noms et commandes :

```sql
select jobid, jobname, username, database, schedule, command
from cron.job
where jobname in (
  'ai-finance-os-invoice-overdue-daily',
  'ai-finance-os-recurring-expenses-daily',
  'ai-finance-os-expenses-overdue-daily'
)
order by jobname;
```

Après application, contrôlez les exécutions et les fonctions :

```sql
select j.jobid, j.status, j.return_message, j.start_time, j.end_time
from cron.job_run_details as j
join cron.job as c on c.jobid = j.jobid
where c.jobname in (
  'ai-finance-os-invoice-overdue-daily',
  'ai-finance-os-recurring-expenses-daily',
  'ai-finance-os-expenses-overdue-daily'
)
order by j.start_time desc
limit 30;

select n.nspname, p.proname, r.rolname as owner, p.prosecdef, p.proconfig
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
join pg_catalog.pg_roles as r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in (
    'update_overdue_invoice_statuses',
    'update_overdue_expense_statuses',
    'generate_due_recurring_expense_occurrences'
  );
```

L'application de SQL distant reste une action manuelle à effectuer par vous ;
aucune connexion ni mutation distante n'a été réalisée pendant cette correction.

### Migrations 014/015 historiques — ne pas exécuter

Les paragraphes historiques ci-dessous décrivent l'ancien mécanisme et sont
conservés pour expliquer les changements. Ils ne constituent plus les
instructions de déploiement. Utilisez uniquement 016 pour réparer les échecs
et installer les trois tâches.

## Migration historique 014 : mise à jour planifiée des factures

L'ancien `014_invoice_overdue_scheduler.sql` préparait un job `pg_cron` nommé
`ai-finance-os-invoice-overdue-daily`. Il met une fois par jour à 00:10 UTC
uniquement les factures `pending` ou `receivable` dont l’échéance est avant la
date UTC du jour au statut `overdue`. Les factures `paid`, `draft`, `cancelled`,
les échéances nulles et les statuts inconnus ne sont pas modifiés. Le job
exécute le `UPDATE` sous le rôle dédié non-login `invoice_overdue_scheduler`,
avec RLS appliquée et privilèges de colonne limités à `status`; il n’emploie
pas `service_role`. Le script ne crée pas l’extension `pg_cron`.

Ce dépôt ne prouve ni que `pg_cron` est activé sur le projet Supabase cible ni
que ce job est actif en production. Avant application, dans le projet cible,
inspectez sans modifier :

```sql
select extname from pg_catalog.pg_extension where extname = 'pg_cron';
select pg_catalog.to_regprocedure('cron.schedule(text,text,text)') as named_schedule,
       pg_catalog.to_regprocedure('cron.unschedule(bigint)') as unschedule;
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'invoices'
order by ordinal_position;
select status::text, count(*) from public.invoices group by status::text order by status::text;
select c.relrowsecurity
from pg_catalog.pg_class c
where c.oid = 'public.invoices'::regclass;
select t.tgname, p.proname, pg_catalog.pg_get_triggerdef(t.oid)
from pg_catalog.pg_trigger t
join pg_catalog.pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.invoices'::regclass and not t.tgisinternal;
select jobid, jobname, username, database, schedule, command
from cron.job
where jobname = 'ai-finance-os-invoice-overdue-daily';
```

Vérifiez que le schéma et les statuts correspondent aux hypothèses de la
migration et que les triggers ne créent pas d’effets secondaires. Ces
instructions sont historiques : n'appliquez pas 014. Utilisez la migration
corrective 016 à la place. Le script historique interrompt et annule sa
transaction si ses pré-vérifications
échouent ou si un job de même nom, mais de propriétaire/base/commande
différents, est déjà présent. Une réexécution sous le même rôle vérifie puis
remplace uniquement ce job nommé avec la commande attendue.

Après application, contrôlez le résultat sans modifier de données :

```sql
select rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
from pg_catalog.pg_roles where rolname = 'invoice_overdue_scheduler';
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'invoice_overdue_scheduler';
select table_schema, table_name, column_name, privilege_type
from information_schema.role_column_grants
where grantee = 'invoice_overdue_scheduler';
select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'invoices'
  and policyname like 'invoice_overdue_scheduler%';
select jobid, jobname, username, database, schedule, command
from cron.job
where jobname = 'ai-finance-os-invoice-overdue-daily';
select j.jobid, j.status, j.return_message, j.start_time, j.end_time
from cron.job_run_details j
join cron.job c on c.jobid = j.jobid
where c.jobname = 'ai-finance-os-invoice-overdue-daily'
order by j.start_time desc limit 20;
```

Confirmez que le compte planificateur ne possède que les privilèges de lecture
sur `status`/`due_date` et de mise à jour de `status` sur `public.invoices`,
qu’il est non-login et sans `BYPASSRLS`, et que les exécutions réussissent.
Les permissions héritées de `PUBLIC` ainsi que les policies/triggers propres à
la base cible doivent aussi être inspectées. Le cron met à jour les factures
éligibles de façon idempotente. La synchronisation à l’ouverture de la page
reste un mécanisme complémentaire, pas un remplacement du job.

Pour désinstaller, en SQL Editor administrateur, retirez d’abord le job par son
nom puis les policies dédiées et les grants/rôle après avoir confirmé qu’aucun
autre job ne l’utilise :

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'ai-finance-os-invoice-overdue-daily';
drop policy if exists invoice_overdue_scheduler_select on public.invoices;
drop policy if exists invoice_overdue_scheduler_select_cap on public.invoices;
drop policy if exists invoice_overdue_scheduler_update on public.invoices;
drop policy if exists invoice_overdue_scheduler_update_cap on public.invoices;
revoke all privileges on table public.invoices from invoice_overdue_scheduler;
revoke select (status, due_date), update (status)
  on public.invoices from invoice_overdue_scheduler;
revoke all privileges on schema public from invoice_overdue_scheduler;
create or replace function public.set_invoice_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;
drop role invoice_overdue_scheduler;
```

## Dépenses et récurrences

`015_expense_operations.sql` est une migration historique, remplacée pour le
déploiement par 016. Elle
requiert les migrations `006`, `008`, `009`, `011`, `012` et `013`, ainsi que
`pg_cron` avec `cron.schedule(text,text,text)`. Elle étend les dépenses avec
échéances, HT/TVA et liens aux justificatifs/factures, crée l’historique des
paiements et les modèles récurrents avec RLS et contrôles de cohérence.
L’enregistrement d’un paiement passe par une RPC qui vérifie l’accès, verrouille
la dépense et empêche les paiements supérieurs au solde. Les insertions directes
dans `expense_payments` ne sont pas accordées aux utilisateurs authentifiés.

La migration installe deux jobs `pg_cron` en UTC : `ai-finance-os-expenses-overdue-daily`
à 00:20 met à jour les dépenses échues encore impayées, sans écraser les
statuts manuels `overdue`; `ai-finance-os-recurring-expenses-daily` à 00:25
génère les occurrences dues sans doublon. Les paiements complets restent
`paid`, et l’application recalcule également le statut à l’affichage pour ne
pas dépendre du prochain passage du cron. Le cron ne déclenche aucun paiement.
Le module Échéances reprend les dépenses avec échéance, en excluant les
dépenses liées à une facture déjà listée. « Payé ce mois-ci » ne compte que les
paiements portant une date réelle ; le schéma historique des factures ne
fournit pas de date de règlement fiable et ces factures payées ne sont donc pas
ajoutées à cet indicateur.

Avant toute application, inspectez les prérequis et les données dans le projet
cible. N'appliquez pas 015 séparément : appliquez uniquement 016 comme décrit
plus haut. Aucune migration n’a été appliquée sur Supabase distant. Les requêtes
suivantes sont conservées comme référence historique :

```sql
select jobid, jobname, username, database, schedule, command
from cron.job
where jobname in (
  'ai-finance-os-expenses-overdue-daily',
  'ai-finance-os-recurring-expenses-daily'
);
select j.jobid, j.status, j.return_message, j.start_time, j.end_time
from cron.job_run_details j
join cron.job c on c.jobid = j.jobid
where c.jobname in (
  'ai-finance-os-expenses-overdue-daily',
  'ai-finance-os-recurring-expenses-daily'
)
order by j.start_time desc limit 20;
```

La restauration de `set_invoice_updated_at()` ci-dessus convient uniquement si
sa définition antérieure correspond à celle vérifiée par le préflight. Sinon,
restaurez sa définition exacte depuis l’historique de migration de
l’environnement. La migration 014 est préparée localement et n’a pas été
exécutée sur Supabase.

## Architecture des données personnelles et partagées

Les tables métier implémentées conservent une table unique avec une propriété
de propriétaire exclusive (`user_id` ou `company_id`). Le stockage Documents
prend en charge les deux modes après application de la migration 013. Le module
AI CFO ne dispose pas encore de CRUD métier complet dans ce dépôt. Les
échéances et alertes sont calculées à partir des factures ; les clients et
fournisseurs utilisent leurs tables créées en migration 008. Ne rendez pas les
nouvelles tables publiques et ajoutez des policies propres à chaque ligne.

## Ancienne RPC de création d'entreprise

Avant d'appliquer `002_company_onboarding_rpcs.sql`, confirmez dans le projet
cible que :

- `public.companies` contient une colonne `id` UUID générée automatiquement et
  une colonne `name` compatible avec les noms de 1 à 160 caractères ;
- `public.company_members` possède les colonnes `company_id`, `user_id` et
  `role`, avec une clé unique ou primaire `(company_id, user_id)` ;
- `public.company_role` est un enum contenant `owner` ;
- `companies.id` est un UUID généré par la base, et aucune autre colonne sans
  valeur par défaut n'est obligatoire lors de la création d'une entreprise ;
- les triggers déjà présents sur `companies` ont été inspectés et ne créent pas
  d'effets secondaires incompatibles ;
- le trigger `on_auth_user_created` utilise déjà `public.handle_new_user()` ;
- cette migration RPC n'a pas déjà été appliquée.

Exécutez-la avec un rôle disposant de `BYPASSRLS` (dans Supabase, utiliser le
rôle administrateur prévu pour le SQL Editor).
`row_security = off` dans les fonctions ne désactive pas la RLS : l'appel échoue
si le propriétaire de la fonction ne peut pas contourner les politiques.

La migration ajoute deux fonctions seulement. La création valide la session
Auth, insère l'entreprise et l'adhésion `owner` dans un seul appel SQL, puis
retourne la ligne créée. La fonction de lecture ne retourne que les entreprises
pour lesquelles `auth.uid()` possède une adhésion. Les deux fonctions sont
exécutables par `authenticated` uniquement ; aucune clé `service_role` ni
politique générale d'insertion n'est nécessaire.

Après application, tester avec deux comptes de test appartenant à des
entreprises différentes et un compte sans adhésion :

1. Un compte connecté crée une entreprise ; vérifier l'entreprise et son unique
   adhésion `owner`.
2. Le compte de l'entreprise A ne voit que A avec `get_my_companies()`.
3. Le compte de l'entreprise B ne voit que B.
4. Le compte sans adhésion reçoit une liste vide.
5. Avec la session normale du compte A (jamais un client/service role admin),
   tenter de lire l'identifiant d'entreprise B et ses adhésions ; aucune ligne
   de B ne doit être retournée. Répéter dans l'autre sens.
6. Un appel sans session à la création est refusé.
7. Provoquer un échec contrôlé de création d'adhésion en environnement de test
   et confirmer qu'aucune entreprise partielle n'est conservée.

Ne rejouez pas `001_initial_schema.sql` sur une base où des objets existent :
il s'agit du schéma initial et il crée notamment les tables déjà en place dans
certains environnements. Aucun script ne doit être considéré comme déjà appliqué
sans vérification du projet cible.
