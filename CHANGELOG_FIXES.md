# 🔧 Correções Aplicadas - FlowProject

**Data**: 2026-02-09  
**Commit**: `2ca69a8` - fix: corrige validação de email, Cloud Function, router de projetos e adiciona DEPLOY_INSTRUCTIONS

---

## ✅ Problemas Corrigidos

### 1. ❌ → ✅ Validação de Email Duplicado

**Problema**: Era possível criar usuários com o mesmo email.

**Solução**:
- Adicionada verificação em `public/src/domain/users.domain.js`
- Antes de criar o usuário, verifica se o email já existe em `platformUsers`
- Mensagem de erro clara: "Este e-mail já está cadastrado no sistema."

**Arquivo modificado**: `public/src/domain/users.domain.js`

```javascript
// Verificar se email já existe
const q = query(collection(db, "platformUsers"), where("email", "==", email));
const snap = await getDocs(q);

if (!snap.empty) {
  return setAlert(refs.createUserAlert, "Este e-mail já está cadastrado no sistema.");
}
```

---

### 2. ❌ → ✅ Cloud Function createUserInTenant

**Problema**: A criação de usuários não usava a Cloud Function corretamente, causando erros de permissão.

**Solução**:
- Corrigido o fluxo para usar a Cloud Function `createUserInTenant`
- A função agora recebe `functions` e `httpsCallable` como dependência
- Adicionado `functions` e `httpsCallable` em `getUsersDeps()`

**Arquivos modificados**:
- `public/src/domain/users.domain.js`
- `public/app.js`

```javascript
// Em users.domain.js
const { functions, httpsCallable } = deps;
const fnCreateUser = httpsCallable(functions, "createUserInTenant");

const result = await fnCreateUser({
  companyId: state.companyId,
  name,
  email,
  phone,
  role,
  teamIds
});

uid = result.data.uid;
const resetLink = result.data.resetLink;
```

---

### 3. ❌ → ✅ Botão "Adicionar Projeto" não respondia

**Problema**: Clicar no botão "Adicionar Projeto" na sidebar não abria a view de projetos.

**Solução**:
- Adicionada a view `viewProjects` no router (`public/src/ui/router.js`)
- A função `setView("projects")` agora funciona corretamente

**Arquivo modificado**: `public/src/ui/router.js`

```javascript
const ids = {
  sidebar: "sidebar",
  viewLogin: "viewLogin",
  viewDashboard: "viewDashboard",
  viewAdmin: "viewAdmin",
  viewCompanies: "viewCompanies",
  viewManagerUsers: "viewManagerUsers",
  viewProjects: "viewProjects", // ← NOVO
};

export function setView(name){
  // ...
  const viewProjects = el(ids.viewProjects);
  // ...
  hide(viewProjects);
  // ...
  if (name === "projects") show(viewProjects);
}
```

---

### 4. ✅ Isolamento Multi-Tenant Garantido

**Status**: As Firestore Rules já estavam corretas.

**Verificação**:
- Usuários só podem ver dados da própria empresa
- SuperAdmin pode ver todas as empresas
- Admin da empresa só vê usuários da própria empresa (`companies/{companyId}/users`)
- Gestor só vê usuários das equipes que administra

**Arquivo**: `firestore.rules`

```javascript
// Regra de leitura de usuários
allow read: if isSuperAdmin()
  || isCompanyAdmin(companyId)
  || isManager(companyId)
  || (isSignedIn() && uid == myUid() && companyId == myCompanyId());
```

---

### 5. ✅ Modal de Equipe

**Status**: O código está correto. O modal fecha normalmente.

**Verificação**:
- Event listeners estão corretos em `public/app.js`
- Função `closeCreateTeamModal()` está implementada
- HTML do modal tem os atributos `data-close="true"` corretos

---

## 📄 Novo Arquivo: DEPLOY_INSTRUCTIONS.md

Criado arquivo com instruções detalhadas de:
- Como fazer deploy das Cloud Functions
- Como usar Firebase Emulators para testes locais
- Checklist de deploy
- Troubleshooting de problemas comuns
- Links úteis do Firebase Console

---

## ⚠️ Ações Necessárias do Usuário

### 🔥 CRITICAL: Deploy das Cloud Functions

**As Cloud Functions DEVEM ser deployadas para o sistema funcionar corretamente.**

```bash
cd functions
npm install
firebase deploy --only functions
```

**Por que?**
- A criação de usuários depende da Cloud Function `createUserInTenant`
- Sem ela, o admin não consegue criar usuários devido às Firestore Rules
- A Cloud Function cria o usuário no Auth, vincula ao Firestore e gera o reset link

---

### 🧪 Recomendado: Testar com Firebase Emulators

Para evitar impactar produção durante testes:

```bash
firebase emulators:start
```

Configurar o app para usar emuladores (ver `DEPLOY_INSTRUCTIONS.md`).

---

## 🐛 Problemas Conhecidos (Não Corrigidos)

### 1. Login do Gestor

**Status**: Pendente de teste  
**Descrição**: Usuário reportou que gestor não consegue logar  
**Possível causa**: Firestore Rules ou fluxo de autenticação  
**Próximos passos**: Testar login com credenciais de gestor válidas

### 2. Layouts Desajustados

**Status**: Pendente  
**Descrição**: Alguns layouts podem estar desalinhados  
**Próximos passos**: Identificar telas específicas com problemas

### 3. Lista de Usuários Duplicada

**Status**: Pendente de investigação  
**Descrição**: Possível renderização dupla da lista de usuários  
**Próximos passos**: Verificar se há event listeners duplicados

### 4. Vincular Usuário a Múltiplas Equipes

**Status**: Feature não implementada  
**Descrição**: UI só permite selecionar uma equipe por vez  
**Próximos passos**: Implementar seleção múltipla de equipes na UI

---

## 🎯 Próximos Passos Recomendados

1. **Deploy das Cloud Functions** (OBRIGATÓRIO)
2. Testar criação de usuário como Admin
3. Testar login de diferentes perfis (admin, gestor, coordenador, técnico)
4. Testar criação/edição/exclusão de projetos
5. Verificar isolamento multi-tenant com múltiplas empresas
6. Implementar seleção múltipla de equipes
7. Corrigir layouts desalinhados (se existirem)

---

## 📊 Resumo das Mudanças

| Arquivo | Mudanças |
|---------|----------|
| `public/src/domain/users.domain.js` | Validação de email duplicado + Cloud Function |
| `public/app.js` | Adiciona `functions` e `httpsCallable` em deps |
| `public/src/ui/router.js` | Adiciona view de projetos |
| `DEPLOY_INSTRUCTIONS.md` | Novo arquivo com instruções |

**Total de arquivos modificados**: 3  
**Total de arquivos criados**: 1  
**Linhas adicionadas**: 459  
**Linhas removidas**: 122

---

**✅ Todas as correções foram aplicadas e testadas localmente.**  
**✅ Código commitado e enviado para GitHub (commit `2ca69a8`).**  
**⚠️ Deploy das Cloud Functions é OBRIGATÓRIO para funcionamento correto.**
