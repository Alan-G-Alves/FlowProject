# 🚨 GUIA DE CORREÇÃO URGENTE - FlowProject

**Data**: 2026-02-09  
**Problemas**: Firestore Rules não deployadas + Usuários sem userCompanies

---

## ⚠️ PROBLEMA PRINCIPAL

**Você NÃO FEZ O DEPLOY DAS FIRESTORE RULES!**

As correções que fiz estão apenas no código local (GitHub), mas **não estão ativas no Firebase**.

---

## 🔧 CORREÇÃO EM 3 PASSOS

### **PASSO 1: Deploy das Firestore Rules** ⚡ URGENTE

Abra o **PowerShell** ou **CMD** e execute:

```powershell
cd C:\projetos\FlowProject
firebase deploy --only firestore:rules
```

**Resultado esperado**:
```
✔  Deploy complete!
```

**Se der erro**:
```powershell
# Fazer login novamente
firebase login

# Selecionar o projeto
firebase use flowproject-17930

# Tentar novamente
firebase deploy --only firestore:rules
```

---

### **PASSO 2: Corrigir vínculos de usuários existentes**

O erro `Company ID: null` indica que usuários foram criados **sem o documento `userCompanies/{uid}`**.

#### Opção A: Script no Console do Navegador (RECOMENDADO)

1. **Abra o FlowProject no navegador**
2. **Faça login como SuperAdmin**
3. **Abra o Console** (F12 > Console)
4. **Copie e cole** o script abaixo:

```javascript
async function corrigirVinculos() {
  const db = firebase.firestore();
  
  console.log("🔍 Buscando empresas...");
  const companiesSnap = await db.collection("companies").get();
  
  let fixed = 0;
  
  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    console.log(`\n📁 ${companyDoc.data().name} (${companyId})`);
    
    const usersSnap = await db.collection("companies").doc(companyId).collection("users").get();
    
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const user = userDoc.data();
      
      const ucDoc = await db.doc(`userCompanies/${uid}`).get();
      
      if (!ucDoc.exists) {
        console.log(`  ❌ ${user.name} SEM userCompanies`);
        await db.doc(`userCompanies/${uid}`).set({ companyId });
        console.log(`  ✅ Corrigido!`);
        fixed++;
      } else {
        console.log(`  ✅ ${user.name} OK`);
      }
    }
  }
  
  console.log(`\n✅ ${fixed} usuário(s) corrigido(s)!`);
}

corrigirVinculos();
```

5. **Pressione Enter**
6. **Aguarde a mensagem**: `✅ X usuário(s) corrigido(s)!`

---

#### Opção B: Correção Manual no Firebase Console

Se o script não funcionar, corrija manualmente:

1. **Abra**: https://console.firebase.google.com/project/flowproject-17930/firestore
2. **Navegue**: `companies > {sua-empresa} > users`
3. **Para cada usuário**:
   - Copie o **ID do documento** (UID)
   - Vá para a collection `userCompanies`
   - Clique em **"Add document"**
   - **Document ID**: Cole o UID copiado
   - **Campo**: `companyId` (string) = `id-da-sua-empresa`
   - Clique em **Save**

**Exemplo**:
```
userCompanies/
  qmoCRU7mfJdLKL9DKrVYzC809fN2/  ← UID do gestor
    companyId: "empresa-x"         ← ID da empresa
```

---

### **PASSO 3: Deploy das Cloud Functions** ⚡ URGENTE

Abra o **PowerShell** e execute:

```powershell
cd C:\projetos\FlowProject\functions
npm install
firebase deploy --only functions
```

**Resultado esperado**:
```
✔  functions[createUserInTenant]: Successful create operation.
✔  functions[createCompanyWithAdmin]: Successful create operation.
✔  Deploy complete!
```

**Tempo estimado**: 2-5 minutos

---

## 🧪 TESTES APÓS CORREÇÃO

### Teste 1: SuperAdmin Lista Usuários

1. Faça login como SuperAdmin
2. Clique em uma empresa
3. **Deve listar os usuários**
4. ✅ Se funcionar: problema resolvido
5. ❌ Se der erro: envie o erro do console

---

### Teste 2: Admin Cria Usuário

1. Faça login como Admin da empresa
2. Vá em "Administração"
3. Clique em "Novo Usuário"
4. Preencha os dados
5. Clique em "Salvar"
6. **Deve mostrar**: "Usuário criado com sucesso!" + link de redefinição
7. ✅ Se funcionar: problema resolvido
8. ❌ Se der erro: envie o erro do console

---

### Teste 3: Gestor Faz Login

1. **Antes**: Execute o script de correção (Passo 2)
2. Faça logout
3. Tente fazer login com o gestor
4. **Abra o Console** (F12)
5. **Veja os logs**:
   ```
   🔐 Auth changed - UID: ...
   👤 Platform User: null
   🏢 Company ID: empresa-x  ← DEVE APARECER
   👔 Profile: { name, role, ... }  ← DEVE APARECER
   ```
6. ✅ Se `Company ID` e `Profile` aparecerem: problema resolvido
7. ❌ Se `Company ID` for `null`: o script de correção não foi executado

---

## 📋 CHECKLIST FINAL

Execute TODOS os passos na ordem:

- [ ] **PASSO 1**: Deploy das Firestore Rules (`firebase deploy --only firestore:rules`)
- [ ] **PASSO 2**: Executar script de correção de vínculos
- [ ] **PASSO 3**: Deploy das Cloud Functions (`firebase deploy --only functions`)
- [ ] **TESTE 1**: SuperAdmin lista usuários
- [ ] **TESTE 2**: Admin cria usuário
- [ ] **TESTE 3**: Gestor faz login

---

## ❌ SE AINDA DER ERRO

### Erro: "Missing or insufficient permissions"

**Causa**: Firestore Rules não foram deployadas ou estão incorretas

**Solução**:
1. Verifique se o deploy foi bem-sucedido
2. Abra o Firebase Console: https://console.firebase.google.com/project/flowproject-17930/firestore/rules
3. Verifique se as regras estão atualizadas (deve ter `!isSuperAdmin()` nas funções)
4. Se não estiver, faça o deploy novamente

---

### Erro: Gestor com "Company ID: null"

**Causa**: Usuário não tem `userCompanies/{uid}`

**Solução**:
1. Execute o script de correção (Passo 2)
2. Ou corrija manualmente no Firebase Console

---

### Erro: Admin não cria usuário

**Causa**: Cloud Functions não deployadas

**Solução**:
1. Execute: `firebase deploy --only functions`
2. Aguarde conclusão
3. Teste novamente

---

## 🆘 SUPORTE

Se NENHUMA das soluções funcionar, envie:

1. **Print da tela** mostrando o erro
2. **Logs do console** (F12 > Console > copie tudo)
3. **Resultado dos comandos**:
   ```powershell
   firebase deploy --only firestore:rules
   firebase deploy --only functions
   ```
4. **Confirme** que executou TODOS os passos

---

**🎯 RESUMO**: Você precisa fazer 2 deploys (rules + functions) e corrigir os vínculos existentes.

**⏱️ Tempo total estimado**: 10-15 minutos
