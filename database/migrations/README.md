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
manuellement qu’après vérification de son effet sur les usages distants. Le
module actuel stocke dans un espace d’entreprise uniquement : le schéma
`documents` existant ne permet pas un propriétaire personnel. Les documents
sont consultés via des URL signées de courte durée. Une relation facture peut
exister via `invoices.document_id`; les clients et fournisseurs ne sont exposés
comme relations que via les identifiants de partie portés par cette facture.
Le schéma actuel ne lie pas directement les documents aux dépenses ou devis.

`012_invoice_document_links.sql` ajoute une unicité sur le document source d’une
facture et une clé étrangère restrictive composite qui impose la même entreprise
des deux côtés. Elle requiert `documents` ainsi que `invoices.document_id` et
`invoices.company_id`. Appliquez-la manuellement après `010` et `011`, après
vérification du schéma distant et de l’historique des migrations. Elle échoue
sans corriger ni supprimer de données si des liens existants sont dupliqués,
absents ou inter-entreprises. L’index unique empêche aussi les doubles créations
concurrentes ; le code vérifie également le lien côté serveur. Cette migration
n’a pas été appliquée à Supabase.

## Architecture des données personnelles et partagées

Les tables métier implémentées conservent une table unique avec une propriété
de propriétaire exclusive (`user_id` ou `company_id`). Le stockage Documents
existant ne prend en charge que la propriété d’entreprise. Le module AI CFO ne
dispose pas encore de CRUD métier complet dans ce dépôt. Les échéances et
alertes sont calculées à partir des factures ; les clients et fournisseurs
utilisent leurs tables créées en migration 008. Ne rendez pas les nouvelles
tables publiques et ajoutez des policies propres à chaque ligne.

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
