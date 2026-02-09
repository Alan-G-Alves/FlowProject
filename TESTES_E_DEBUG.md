# 🧪 Instruções de Teste e Resolução de Problemas

**Data**: 2026-02-09  
**Commit**: `5298899` - fix: corrige Firestore Rules para SuperAdmin, adiciona logs de debug e hover na sidebar

---

## ✅ Correções Aplicadas

### 1. ✅ SuperAdmin pode listar usuários de qualquer empresa

**Problema**: "Missing or insufficient permissions" ao tentar listar usuários.

**Causa**: As funções `isCompanyAdmin()`, `isManager()`, etc tentavam buscar `userCompanies/{uid}` para SuperAdmins, mas SuperAdmins não têm esse documento.

**Solução**: Adicionado `!isSuperAdmin()` nas funções de verificação de role:

```javascript
function isCompanyAdmin(companyId) {
  return isSignedIn()
    && !isSuperAdmin()  // ← NOVO
    && exists(/databases/$(database)/documents/userCompanies/$(myUid()))
    && companyId == myCompanyId()
    // ...
}
```

**Arquivo**: `firestore.rules`

---

### 2. ✅ Sidebar expande ao passar o mouse

**Problema**: Menu lateral não expandia com os nomes.

**Solução**: Adicionado comportamento de hover (mouseenter/mouseleave):

- **Mouseenter**: Expande automaticamente
- **Mouseleave**: Recolhe (se não estiver fixado)
- **Click**: Fixa/desfixa (toggle permanente)

**Arquivo**: `public/app.js`

---

### 3. ✅ Logs de debug para fluxo de autenticação

**Problema**: Gestor não conseguia logar sem mensagem de erro.

**Solução**: Adicionados logs no console para debug:

```javascript
console.log("🔐 Auth changed - UID:", user.uid, "Email:", user.email);
console.log("👤 Platform User:", platformUser);
console.log("🏢 Company ID:", companyId);
console.log("👔 Profile:", profile);
```

**Arquivo**: `public/app.js`

**Como usar**: Abra o Console do navegador (F12) e tente fazer login com o gestor. Os logs vão mostrar onde está falhando.

---

### 4. ✅ Tratamento de erro no botão "Adicionar Projeto"

**Problema**: Botão não respondia.

**Solução**: Adicionado try-catch para capturar erros:

```javascript
refs.navAddProject?.addEventListener("click", () => {
  try {
    setActiveNav("navAddProject");
    openProjectsView();
  } catch (err) {
    console.error("Erro ao abrir projetos:", err);
    alert("Erro ao abrir projetos: " + (err?.message || err));
  }
});
```

**Arquivo**: `public/app.js`

---

## ⚠️ Problemas Pendentes (Necessitam de Ação do Usuário)

### 1. ⚠️ Admin não consegue criar usuários

**Erro**: "Missing or insufficient permissions"

**Causa Provável**: **Cloud Functions não foram deployadas**

**Solução**: Deploy obrigatório das Cloud Functions:

```bash
cd C:\projetos\FlowProject
cd functions
firebase login
firebase use flowproject-17930
firebase deploy --only functions
```

**Verificação**: Após o deploy, teste criar um usuário. Se o erro persistir, verifique os logs:

```bash
firebase functions:log
```

---

### 2. ⚠️ Gestor não consegue logar

**Próximos Passos**:

1. **Teste com o console aberto** (F12 > Console)
2. **Verifique os logs** que adicionei:
   - `🔐 Auth changed`
   - `👤 Platform User`
   - `🏢 Company ID`
   - `👔 Profile`

3. **Possíveis causas**:
   - Usuário gestor não tem registro em `userCompanies/{uid}`
   - Usuário gestor está bloqueado (`active: false`)
   - Email/senha incorretos

4. **Verifique no Firestore**:
   - `userCompanies/{uid_do_gestor}` existe e tem `companyId`?
   - `companies/{companyId}/users/{uid_do_gestor}` existe?
   - O campo `active` é `true`?
   - O campo `role` é `"gestor"`?

---

### 3. ⚠️ Botão "Adicionar Projeto" não responde

**Próximos Passos**:

1. **Abra o Console** (F12 > Console)
2. **Clique no botão** "Adicionar Projeto"
3. **Verifique se aparece erro** no console
4. **Me envie o erro** se aparecer

Se não aparecer nenhum erro, o problema pode ser:
- JavaScript não está carregando
- Elemento `#navAddProject` não existe no HTML
- Conflito de cache do navegador (tente Ctrl+F5)

---

## 🧪 Checklist de Testes

### Teste como SuperAdmin:

- [ ] Login funciona
- [ ] Dashboard carrega
- [ ] Consegue ver lista de empresas
- [ ] Consegue abrir detalhes de uma empresa
- [ ] **Consegue ver lista de usuários da empresa**
- [ ] Consegue criar nova empresa

### Teste como Admin da Empresa:

- [ ] Login funciona
- [ ] Dashboard carrega
- [ ] **Consegue criar usuário** (requer Cloud Functions deployadas)
- [ ] Consegue ver lista de usuários
- [ ] Consegue criar equipe
- [ ] **Consegue clicar em "Adicionar Projeto"**

### Teste como Gestor:

- [ ] **Login funciona** (verificar logs no console)
- [ ] Dashboard carrega
- [ ] Consegue ver lista de técnicos da sua equipe
- [ ] Consegue criar técnico
- [ ] Consegue clicar em "Adicionar Projeto"

### Teste como Coordenador/Técnico:

- [ ] Login funciona
- [ ] Dashboard carrega
- [ ] Consegue ver projetos/tarefas (quando implementado)

---

## 📝 Como Reportar Erros

Para cada erro, envie:

1. **Perfil do usuário** (SuperAdmin, Admin, Gestor, etc)
2. **Ação realizada** (ex: "Tentei criar usuário")
3. **Erro exibido** na tela
4. **Logs do Console** (F12 > Console > copie os logs)
5. **Print da tela** (se relevante)

---

## 🔥 Deploy das Firestore Rules (OBRIGATÓRIO)

**As Firestore Rules foram atualizadas e precisam ser deployadas:**

```bash
cd C:\projetos\FlowProject
firebase deploy --only firestore:rules
```

**Verificação**: Após deploy, teste novamente como SuperAdmin.

---

## 🎯 Próximos Passos

1. **Deploy das Firestore Rules** ✅ OBRIGATÓRIO
2. **Deploy das Cloud Functions** ✅ OBRIGATÓRIO  
3. Teste como SuperAdmin (verificar se lista usuários)
4. Teste como Admin (verificar se cria usuários)
5. Teste como Gestor (verificar logs de login)
6. Reporte resultados para eu continuar as correções

---

**✅ Código commitado e enviado para GitHub (commit `5298899`).**  
**⚠️ Deploy das Rules e Functions é OBRIGATÓRIO para funcionamento correto.**
