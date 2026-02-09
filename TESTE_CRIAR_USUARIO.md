# 🧪 TESTE ATUALIZADO - Admin Criar Usuário

**Data**: 2026-02-09  
**Commit**: `3469ab7` - Remove verificação de email do frontend

---

## ✅ **Correção Aplicada**

**Problema**: Admin recebia erro "Missing or insufficient permissions" ao tentar verificar se o email já existia.

**Causa**: O Admin não tem permissão de leitura na collection `platformUsers`.

**Solução**: Removida a verificação de email duplicado do frontend. A **Cloud Function** já faz essa validação.

---

## 🔄 **Como Atualizar e Testar**

### **PASSO 1: Atualizar o código local**

No seu computador (PowerShell):

```powershell
cd C:\projetos\FlowProject
git pull origin main
```

**Resultado esperado**:
```
Updating d80fd32..3469ab7
public/src/domain/users.domain.js | 31 ++++++++++++++++---------------
1 file changed, 19 insertions(+), 12 deletions(-)
```

---

### **PASSO 2: Limpar cache do navegador**

No navegador:
1. Pressione **Ctrl + Shift + Delete**
2. Selecione **"Imagens e arquivos em cache"**
3. Clique em **"Limpar dados"**

Ou simplesmente:
4. Pressione **Ctrl + F5** (recarrega ignorando cache)

---

### **PASSO 3: Testar criação de usuário**

1. **Faça login** como Admin da empresa
2. Vá em **"Administração" > "Usuários"**
3. Clique em **"+ Novo Usuário"**
4. **Abra o Console** (F12 > Console)
5. **Preencha os dados**:
   - Nome: João Teste
   - Email: joao.teste@exemplo.com
   - Telefone: 11999999999
   - Função: Técnico
   - Selecione pelo menos 1 equipe
6. Clique em **"Salvar"**

---

## 📊 **Resultados Esperados**

### **Console (F12)**:

Você deve ver estes logs:

```
🔧 Chamando Cloud Function createUserInTenant...
📦 Payload: {companyId: "bee-it-v1", name: "João Teste", email: "joao.teste@...", role: "tecnico", teamIds: [...]}
✅ Cloud Function retornou: {uid: "...", resetLink: "https://..."}
```

### **Na Tela**:

Deve aparecer o alerta verde:

```
✅ Usuário criado com sucesso!

Abrir link de definição de senha  [Copiar link]

Envie este link para joao.teste@exemplo.com. Ele serve para definir a senha no primeiro acesso.
```

---

## ❌ **Se Aparecer Erro**

### **Erro 1: "INTERNAL"**

```
functions/internal
```

**Causa**: Cloud Function não foi deployada ou crashou

**Solução**:
```powershell
cd C:\projetos\FlowProject\functions
firebase deploy --only functions
```

---

### **Erro 2: "Já existe um usuário com este e-mail"**

```
functions/already-exists
```

**Causa**: Email já está cadastrado no Firebase Authentication

**Solução**:
1. Use outro email OU
2. Delete o usuário existente no Firebase Console:
   - https://console.firebase.google.com/project/flowproject-17930/authentication/users

---

### **Erro 3: "Missing or insufficient permissions" (ainda)**

**Causa**: Você não atualizou o código ou não limpou o cache

**Solução**:
1. Execute `git pull origin main`
2. Pressione **Ctrl + F5** no navegador
3. Tente novamente

---

### **Erro 4: Cloud Function não aparece nos logs**

```
// Nenhum log aparece
```

**Causa**: JavaScript não está sendo carregado ou há erro de sintaxe

**Solução**:
1. Veja se há **erros em vermelho** no Console (F12)
2. Me envie os erros

---

## 🎯 **Checklist Final**

Antes de reportar problemas, certifique-se de:

- [ ] Executou `git pull origin main`
- [ ] Limpou o cache do navegador (Ctrl + F5)
- [ ] Cloud Functions deployadas (`firebase deploy --only functions`)
- [ ] Abriu o Console do navegador (F12)
- [ ] Preencheu **todos os campos** do formulário
- [ ] Selecionou **pelo menos 1 equipe** (se não for Admin)

---

## 📝 **Reportar Erro**

Se AINDA der erro, envie:

1. **Logs completos do Console** (F12 > Console > copie tudo)
2. **Print da tela** mostrando o erro
3. **Resultado do comando**:
   ```powershell
   cd C:\projetos\FlowProject
   git log --oneline -1
   ```
   Deve mostrar: `3469ab7 fix: remove verificação de email duplicado do frontend`

---

**✅ Pronto para testar!**

**Tempo estimado**: 2 minutos
