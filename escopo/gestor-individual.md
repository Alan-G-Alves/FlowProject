# FlowProject Gestor Individual

## Objetivo

Criar uma linha de produto para pessoa fisica/MEI que usa CPF no cadastro e precisa controlar projetos, participantes, despesas, feedbacks e relatorios sem contratar o plano empresarial por CNPJ.

## Regra comercial

- Cadastro do titular sempre por CPF.
- CNPJ nao deve ser aceito nos planos Gestor Individual.
- Cada conta individual possui 1 titular, apresentado como Gestor/Admin.
- O titular pode convidar participantes conforme o limite do plano.
- O titular pode tambem atuar como tecnico operacional, sem exigir novo produto.
- A cobranca e os limites devem ser por plano contratado.

## Planos sugeridos

| Plano | Usuarios incluidos | Composicao | Projetos ativos | Valor mensal sugerido |
| --- | --- | ---: | ---: | ---: |
| Gestor Start | 3 usuarios | 1 Gestor + 2 Participantes | 10 | R$ 19,90 |
| Gestor Pro | 6 usuarios | 1 Gestor + 5 Participantes | 20 | R$ 27,90 |
| Gestor Plus | 11 usuarios | 1 Gestor + 10 Participantes | 40 | R$ 57,90 |

## Como preservar o sistema atual

O fluxo atual de empresas continua como esta:

- Empresa usa CNPJ.
- Plano empresarial continua por faixa total de usuarios.
- Admin Master continua criando empresas pelo painel atual.
- Regras atuais de `companies`, `users`, `projects` e `userCompanies` nao devem ser alteradas na primeira etapa.

Para o Gestor Individual, a recomendacao e criar uma camada nova:

- `accountType: "individual"`
- `documentType: "cpf"`
- `ownerUid`
- `ownerRole: "admin"`
- `planTechLimit`
- `planProjectLimit`

O sistema pode continuar usando uma estrutura interna parecida com empresa, mas a interface deve chamar isso de "Meu espaco" ou "Minha operacao", nao "Empresa".

## Etapas tecnicas seguras

1. Publicar comunicacao comercial na pagina de venda para validar interesse.
2. Criar catalogo isolado de planos individuais.
3. Depois criar cadastro separado para CPF, sem alterar o cadastro CNPJ atual.
4. Em seguida aplicar limites de participantes e projetos apenas para contas `accountType: "individual"`.
5. Somente depois integrar cobranca recorrente e checkout.
