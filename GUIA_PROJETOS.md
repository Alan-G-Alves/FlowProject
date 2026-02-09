# 📦 Guia do Módulo de Projetos - FlowProject

## ✅ Status Atual

O módulo de Projetos está **100% implementado** e pronto para uso!

---

## 🎯 Funcionalidades Disponíveis

### 1️⃣ **Listar Projetos**
- ✅ Grid responsivo com cards de projetos
- ✅ Busca por nome
- ✅ Filtro por equipe
- ✅ Filtro por status (A Fazer, Em Andamento, Concluído)
- ✅ Filtro por coordenador
- ✅ Ordenação por data de criação (mais recente primeiro)

### 2️⃣ **Criar Projeto**
- ✅ Modal com formulário completo
- ✅ Campos:
  - Nome (obrigatório)
  - Descrição
  - Equipe (select)
  - Coordenador (filtrado pela equipe selecionada)
  - Status
  - Prioridade
  - Data de início
  - Data de término
- ✅ Validações:
  - Nome obrigatório
  - Equipe obrigatória
  - Coordenador obrigatório

### 3️⃣ **Ver Detalhes do Projeto**
- ✅ Modal com informações completas
- ✅ Botões:
  - Editar
  - Excluir
  - Fechar

### 4️⃣ **Editar Projeto**
- ✅ Modal pré-preenchido com dados atuais
- ✅ Atualização em tempo real
- ✅ Validações iguais ao criar

### 5️⃣ **Excluir Projeto**
- ✅ Confirmação antes de excluir
- ✅ Exclusão permanente do Firestore

---

## 🔐 Permissões (Firestore Rules)

| Ação | SuperAdmin | Admin | Gestor | Coordenador | Técnico |
|------|-----------|-------|--------|-------------|---------|
| **Listar** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Criar** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Editar** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Excluir** | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 🧪 Como Testar

### **Passo 1: Atualizar o código**
```bash
cd C:\projetos\FlowProject
git pull origin main
# Ctrl+F5 no navegador
```

### **Passo 2: Fazer login como Admin**
- Email: `alan.moraes@beeitpartner.com.br`
- Senha: [sua senha]

### **Passo 3: Acessar tela de Projetos**
- Clicar no botão **"Adicionar projeto"** na sidebar (ícone 📂)
- Deve abrir a tela de projetos

### **Passo 4: Criar um projeto**
1. Clicar em **"+ Criar Projeto"**
2. Preencher:
   - Nome: `Projeto Teste 1`
   - Descrição: `Descrição do projeto de teste`
   - Equipe: Selecionar uma equipe
   - Coordenador: Selecionar um coordenador (filtrado pela equipe)
   - Status: `a-fazer`
   - Prioridade: `media`
3. Clicar em **"Salvar"**
4. Verificar se o card aparece na grid

### **Passo 5: Ver detalhes**
1. Clicar no card do projeto
2. Deve abrir o modal com detalhes
3. Verificar se todas as informações aparecem

### **Passo 6: Editar projeto**
1. No modal de detalhes, clicar em **"Editar"**
2. Alterar o nome para `Projeto Teste 1 - Editado`
3. Clicar em **"Salvar"**
4. Verificar se o card foi atualizado

### **Passo 7: Testar filtros**
1. Criar mais projetos com diferentes equipes/status
2. Testar filtro por equipe
3. Testar filtro por status
4. Testar busca por nome

### **Passo 8: Excluir projeto**
1. Clicar em um projeto
2. Clicar em **"Excluir"**
3. Confirmar
4. Verificar se o card foi removido

---

## 📊 Estrutura de Dados (Firestore)

### **Path:**
```
companies/{companyId}/projects/{projectId}
```

### **Campos:**
```javascript
{
  name: "Nome do Projeto",
  description: "Descrição do projeto",
  teamId: "#1",                    // ID da equipe
  coordinatorUid: "abc123",        // UID do coordenador
  status: "a-fazer",               // a-fazer, em-andamento, concluido
  priority: "media",               // baixa, media, alta
  startDate: "2024-01-15",        // YYYY-MM-DD
  endDate: "2024-12-31",          // YYYY-MM-DD
  active: true,
  createdAt: Timestamp,
  createdBy: "uid-do-criador"
}
```

---

## 🐛 Possíveis Erros

### **1. Tela não abre ao clicar no botão**
**Causa:** Cache do navegador
**Solução:**
```bash
# Limpar cache
Ctrl + F5
```

### **2. "Erro ao carregar projetos"**
**Causa:** Firestore Rules ou companyId ausente
**Solução:**
```bash
# Deploy das Firestore Rules
firebase deploy --only firestore:rules

# Verificar no console se state.companyId existe
console.log(state.companyId);
```

### **3. Coordenadores não aparecem no select**
**Causa:** Filtro de equipe não está funcionando
**Solução:**
- Verificar se a equipe foi selecionada primeiro
- Os coordenadores devem ter `teamIds` que incluem o `teamId` selecionado

### **4. "Missing or insufficient permissions"**
**Causa:** Usuário sem permissão
**Solução:**
- Verificar role do usuário (`admin`, `gestor`, `coordenador`)
- Técnicos não podem criar projetos

---

## 📁 Arquivos do Módulo

### **Frontend:**
- `/public/index.html` - View e modais de projetos
- `/public/src/domain/projects.domain.js` - Lógica de negócio (548 linhas)
- `/public/src/ui/refs.js` - Referências dos elementos
- `/public/app.js` - Event listeners e inicialização

### **Backend:**
- `/firestore.rules` - Regras de segurança

---

## 🎨 Elementos da UI

### **View Principal:**
- `viewProjects` - Container principal
- `projectsGrid` - Grid de cards
- `projectsEmpty` - Estado vazio
- Filtros: busca, equipe, status, coordenador

### **Modais:**
1. `modalCreateProject` - Criar projeto
2. `modalProjectDetail` - Ver detalhes
3. `modalEditProject` - Editar projeto

---

## 🚀 Próximos Passos (Opcional)

Se quiser melhorar o módulo:

1. **Dashboard de Projetos:**
   - Gráficos de status
   - Projetos por equipe
   - Timeline de projetos

2. **Tarefas (Sprint 2):**
   - Adicionar tarefas aos projetos
   - Atribuir tarefas aos técnicos
   - Acompanhar progresso

3. **Relatórios:**
   - Relatório de projetos concluídos
   - Tempo médio de conclusão
   - Exportar para PDF/Excel

---

## ✅ Checklist de Teste

- [ ] Tela de projetos abre
- [ ] Botão "Criar Projeto" funciona
- [ ] Modal de criar abre
- [ ] Consegue criar projeto
- [ ] Card aparece na grid
- [ ] Consegue clicar no card
- [ ] Modal de detalhes abre
- [ ] Botão "Editar" funciona
- [ ] Consegue editar projeto
- [ ] Alterações aparecem no card
- [ ] Filtros funcionam (equipe, status, coordenador)
- [ ] Busca funciona
- [ ] Consegue excluir projeto
- [ ] Projeto é removido da grid

---

**Teste agora e me avise se encontrar algum problema!** 😊
