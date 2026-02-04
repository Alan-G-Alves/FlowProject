# FlowProject - Módulos (início da refatoração)

Esta pasta marca o começo da modularização do frontend (JS puro ES Modules).

## O que já foi extraído
- `utils/roles.js`: `normalizeRole()` e alias `humanizeRole()` (corrige erro ao abrir detalhes da equipe).

## Próximos módulos sugeridos
- `utils/dom.js` (show/hide/escapeHtml)
- `services/firestore.service.js` (db + helpers)
- `ui/router.js` (setView)
- `domain/teams.domain.js` (teams + modal)

> Objetivo: reduzir o `public/app.js` gradualmente, sem quebrar o app em produção.

## Extraído nesta etapa
- `utils/dom.js`: show/hide/escapeHtml
- `ui/router.js`: setView (SPA)

## v3
- `ui/alerts.js`: `setAlert()` e `clearAlert()`.
- `utils/format.js`: `normalizePhone()`, `normalizeCnpj()`, `slugify()`.
- `utils/validators.js`: validações básicas de e-mail e CNPJ.

## v3.4
- `services/firestore.service.js`: bootstrap Firestore (platformUsers, userCompanies, company users).
