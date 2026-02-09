# 🚀 FlowProject - Instruções de Deploy

## 📋 Pré-requisitos

1. **Firebase CLI instalado**:
```bash
npm install -g firebase-tools
```

2. **Login no Firebase**:
```bash
firebase login
```

3. **Selecionar projeto**:
```bash
firebase use flowproject-17930
```

## 🔥 Deploy das Cloud Functions

As Cloud Functions são **OBRIGATÓRIAS** para o funcionamento correto do sistema. Sem elas, a criação de usuários falhará.

### 1. Navegar até o diretório functions:
```bash
cd functions
```

### 2. Instalar dependências:
```bash
npm install
```

### 3. Deploy:
```bash
firebase deploy --only functions
```

### 4. Verificar deploy:
```bash
firebase functions:log
```

## 🌐 Deploy do Hosting (opcional)

Se quiser fazer deploy do frontend:

```bash
firebase deploy --only hosting
```

## 🧪 Testar localmente (Firebase Emulator)

### 1. Instalar emuladores:
```bash
firebase init emulators
# Selecione: Authentication, Firestore, Functions
```

### 2. Iniciar emuladores:
```bash
firebase emulators:start
```

### 3. Acessar a UI do emulador:
```
http://localhost:4000
```

### 4. Configurar o app.js para usar emuladores:

No arquivo `public/src/config/firebase.js`, adicione após a inicialização:

```javascript
// APENAS PARA DESENVOLVIMENTO LOCAL
if (location.hostname === "localhost") {
  const { connectAuthEmulator } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const { connectFirestoreEmulator } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const { connectFunctionsEmulator } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js");
  
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
}
```

## ⚠️ Problemas Comuns

### 1. "Missing or insufficient permissions"

- **Causa**: Cloud Functions não deployadas
- **Solução**: Fazer deploy das functions: `firebase deploy --only functions`

### 2. "auth/email-already-in-use"

- **Causa**: Email já cadastrado no Firebase Authentication
- **Solução**: Usar outro email ou deletar o usuário existente no Console do Firebase

### 3. "permission-denied" ao criar usuário

- **Causa**: Regras do Firestore não permitem criação direta (correto)
- **Solução**: Garantir que a Cloud Function está funcionando

### 4. "FirebaseError: Missing or insufficient permissions"

- **Causa**: Tentando gravar direto no Firestore sem Cloud Function
- **Solução**: Verificar se `functions` está sendo passado corretamente em `getUsersDeps()`

## 📝 Checklist de Deploy

- [ ] Cloud Functions deployadas (`firebase deploy --only functions`)
- [ ] Firestore Rules deployadas (`firebase deploy --only firestore:rules`)
- [ ] Firestore Indexes deployados (`firebase deploy --only firestore:indexes`)
- [ ] Hosting deployado (opcional) (`firebase deploy --only hosting`)
- [ ] Testar criação de usuário
- [ ] Testar login de admin, gestor, coordenador e técnico
- [ ] Verificar isolamento multi-tenant

## 🔗 Links Úteis

- Firebase Console: https://console.firebase.google.com/project/flowproject-17930
- Firestore Database: https://console.firebase.google.com/project/flowproject-17930/firestore
- Authentication: https://console.firebase.google.com/project/flowproject-17930/authentication
- Functions: https://console.firebase.google.com/project/flowproject-17930/functions
- Hosting: https://console.firebase.google.com/project/flowproject-17930/hosting

---

**Última atualização**: 2026-02-09
