/**
 * Script de Correção: Vincular usuários à empresa
 * 
 * Este script verifica se todos os usuários de uma empresa
 * têm o registro correspondente em userCompanies/{uid}
 * 
 * Execute no Console do Firebase ou como Cloud Function
 */

// OPÇÃO 1: EXECUTAR NO CONSOLE DO NAVEGADOR (F12)
// Copie e cole este código no Console enquanto estiver logado como SuperAdmin

async function corrigirVinculosDeUsuarios() {
  const db = firebase.firestore();
  
  console.log("🔍 Buscando todas as empresas...");
  
  const companiesSnap = await db.collection("companies").get();
  
  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    console.log(`\n📁 Empresa: ${companyId} (${companyDoc.data().name})`);
    
    const usersSnap = await db.collection("companies").doc(companyId).collection("users").get();
    
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      // Verificar se existe userCompanies/{uid}
      const userCompanyDoc = await db.doc(`userCompanies/${uid}`).get();
      
      if (!userCompanyDoc.exists) {
        console.log(`  ❌ Usuário ${userData.name} (${uid}) NÃO tem userCompanies`);
        console.log(`     Criando vínculo com empresa ${companyId}...`);
        
        try {
          await db.doc(`userCompanies/${uid}`).set({
            companyId: companyId
          });
          console.log(`  ✅ Vínculo criado com sucesso!`);
        } catch (err) {
          console.error(`  ❌ Erro ao criar vínculo:`, err);
        }
      } else {
        const existingCompanyId = userCompanyDoc.data().companyId;
        if (existingCompanyId !== companyId) {
          console.log(`  ⚠️ Usuário ${userData.name} está vinculado à empresa errada!`);
          console.log(`     Atual: ${existingCompanyId}, Correto: ${companyId}`);
        } else {
          console.log(`  ✅ Usuário ${userData.name} já está vinculado corretamente`);
        }
      }
    }
  }
  
  console.log("\n✅ Verificação concluída!");
}

// EXECUTE A FUNÇÃO:
corrigirVinculosDeUsuarios();

// ===================================================================
// OPÇÃO 2: CLOUD FUNCTION (adicionar em functions/index.js)
// ===================================================================

/*
exports.corrigirVinculos = functions.https.onRequest(async (req, res) => {
  // ATENÇÃO: Adicione autenticação aqui (apenas SuperAdmin deve poder executar)
  
  const db = admin.firestore();
  const results = [];
  
  const companiesSnap = await db.collection("companies").get();
  
  for (const companyDoc of companiesSnap.docs) {
    const companyId = companyDoc.id;
    const usersSnap = await db.collection("companies").doc(companyId).collection("users").get();
    
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      const userCompanyDoc = await db.doc(`userCompanies/${uid}`).get();
      
      if (!userCompanyDoc.exists) {
        await db.doc(`userCompanies/${uid}`).set({ companyId });
        results.push({
          uid,
          name: userData.name,
          companyId,
          action: "created"
        });
      }
    }
  }
  
  res.json({
    success: true,
    fixed: results.length,
    details: results
  });
});
*/

// ===================================================================
// OPÇÃO 3: CORREÇÃO MANUAL NO FIREBASE CONSOLE
// ===================================================================

/*
1. Abra o Firebase Console: https://console.firebase.google.com/project/flowproject-17930/firestore
2. Navegue até "Firestore Database"
3. Para cada usuário em companies/{companyId}/users/{uid}:
   a. Copie o UID do usuário
   b. Vá para a collection "userCompanies"
   c. Crie um documento com ID = UID do usuário
   d. Adicione o campo: { companyId: "id-da-empresa" }
*/
