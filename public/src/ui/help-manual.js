import { escapeHtml } from "../utils/dom.js";

const REPORT_NAMES = [
  "Painel consolidado de projetos",
  "Saude operacional do periodo",
  "Projetos por status",
  "Horas previstas x executadas",
  "Clientes com maior volume executado",
  "Cronograma de projeto por periodo",
  "Relatorio de Atividade x Tecnico",
  "Relatorio de Despesas"
];

function currentGuideKey(state){
  if (state?.isSuperAdmin) return "master";
  const role = String(state?.profile?.role || "").toLowerCase();
  if (role === "admin") return "admin";
  if (role === "gestor" || role === "coordenador") return "gestao";
  return "tecnico";
}

function roleTitle(state){
  if (state?.isSuperAdmin) return "Admin Master";
  const role = String(state?.profile?.role || "").toLowerCase();
  const labels = {
    admin: "Admin da empresa",
    gestor: "Gestor",
    coordenador: "Coordenador",
    tecnico: "Tecnico"
  };
  return labels[role] || "Usuario";
}

function path(items){
  return `<div class="manual-path">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function steps(items){
  return `<ol class="manual-steps">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`;
}

function faq(question, answer){
  return `
    <details class="manual-faq-item">
      <summary>${escapeHtml(question)}</summary>
      <p>${escapeHtml(answer)}</p>
    </details>
  `;
}

function section(title, summary, paths, stepItems, note = ""){
  return `
    <article class="manual-section" data-manual-search="${escapeHtml(`${title} ${summary} ${paths.join(" ")} ${stepItems.join(" ")} ${note}`)}">
      <div class="manual-section-head">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(summary)}</p>
      </div>
      ${paths.length ? path(paths) : ""}
      ${stepItems.length ? steps(stepItems) : ""}
      ${note ? `<div class="manual-note">${escapeHtml(note)}</div>` : ""}
    </article>
  `;
}

function reportList(extraText){
  return `
    <div class="manual-report-list">
      ${REPORT_NAMES.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}
    </div>
    ${extraText ? `<p class="manual-inline-note">${escapeHtml(extraText)}</p>` : ""}
  `;
}

function tecnicoGuide(){
  return {
    key: "tecnico",
    title: "Manual do Tecnico",
    intro: "Use esta visao para acompanhar seus projetos, apontar atividades, registrar despesas da atividade e consultar feedbacks e relatorios liberados para o seu perfil.",
    sections: [
      section(
        "Acompanhar projetos",
        "Veja seus projetos em Kanban e acompanhe o status de cada entrega.",
        ["Pagina inicial", "Meus Projetos"],
        [
          "Entre no sistema e abra a Pagina inicial.",
          "Clique em Meus Projetos para visualizar o Kanban.",
          "Abra um projeto para consultar dados, tarefas, responsaveis e prazos.",
          "Use as colunas do Kanban para entender em qual etapa o projeto esta."
        ]
      ),
      section(
        "Apontar atividade",
        "Registre o horario trabalhado e envie a OS para aprovacao.",
        ["Pagina inicial", "Minhas Atividades", "Apontar atividade"],
        [
          "Abra Minhas Atividades.",
          "Use busca ou periodo para encontrar a atividade.",
          "Clique no icone de apontar/editar.",
          "Preencha inicio, fim, descanso e observacao com pelo menos 50 caracteres.",
          "Revise as horas calculadas pelo sistema.",
          "Clique em Salvar apontamento para enviar a OS."
        ],
        "Depois de salvar, a atividade fica como OS Enviada. Quando aprovada pela gestao, ela fica apenas para consulta."
      ),
      section(
        "Registrar despesa da atividade",
        "Inclua comprovantes ligados diretamente ao apontamento.",
        ["Minhas Atividades", "Apontar atividade", "Adicionar despesa"],
        [
          "Abra a atividade antes de salvar o apontamento.",
          "Clique para adicionar despesa.",
          "Informe tipo, valor, observacao e comprovante quando existir.",
          "Salve o apontamento; as despesas seguem junto para aprovacao."
        ],
        "Para Tecnico, despesas sao registradas dentro da atividade e ficam vinculadas ao proprio usuario."
      ),
      section(
        "Consultar feedbacks",
        "Acompanhe feedbacks recebidos pela equipe de gestao.",
        ["Menu lateral", "Feedbacks"],
        [
          "Abra Feedbacks no menu lateral.",
          "Use a busca para localizar uma anotacao.",
          "Abra o texto completo quando houver a opcao Ver mais.",
          "Acompanhe nota, data e responsavel pelo registro."
        ]
      ),
      section(
        "Relatorios do Tecnico",
        "Consulte os relatorios liberados pelo Admin da empresa.",
        ["Menu lateral", "Relatorios"],
        [
          "Abra Relatorios.",
          "Ajuste periodo, cliente, equipe ou status quando os filtros estiverem disponiveis.",
          "No Relatorio de Atividade x Tecnico, o Tecnico visualiza apenas os proprios dados.",
          "No Relatorio de Despesas, o Tecnico visualiza apenas as proprias despesas.",
          "Use PDF ou Excel nos cards habilitados quando precisar exportar."
        ],
        "Se algum relatorio nao aparecer, ele pode estar bloqueado nas permissoes de relatorios da empresa."
      )
    ],
    reportsText: "Para Tecnico, os dados sao restritos ao proprio usuario quando o relatorio envolve atividades ou despesas.",
    faqs: [
      faq("Por que nao consigo editar uma atividade aprovada?", "Atividades aprovadas ficam bloqueadas para preservar o historico da OS."),
      faq("Meu relatorio nao aparece. O que fazer?", "Solicite ao Admin da empresa a liberacao em Configuracoes > Permissoes de relatorios.")
    ]
  };
}

function gestaoGuide(profileRole){
  const label = profileRole === "coordenador" ? "Coordenador" : "Gestor";
  return {
    key: "gestao",
    title: `Manual do ${label}`,
    intro: "Use esta visao para acompanhar a carteira operacional, projetos, atividades, OS, despesas, feedbacks e relatorios do perfil.",
    sections: [
      section(
        "Acompanhar carteira de projetos",
        "Veja todos os projetos permitidos ao perfil e acompanhe andamento pelo Kanban.",
        ["Pagina inicial", "Projetos"],
        [
          "Abra a Pagina inicial.",
          "Clique em Projetos para ver a carteira.",
          "Use busca, equipe, status e coordenador para filtrar.",
          "Abra o projeto para consultar detalhes, tarefas, tecnicos, cliente, prazos e cobranca."
        ],
        "Gestor e Coordenador tambem podem usar Meus Projetos para focar nos projetos ligados ao proprio usuario."
      ),
      section(
        "Criar e organizar projeto",
        "Cadastre projeto, responsaveis, equipe, tecnicos e planejamento.",
        ["Projetos", "Novo projeto"],
        [
          "Clique em Novo projeto.",
          "Preencha nome, descricao e contrato PDF quando existir.",
          "Selecione cliente, equipe, gestor do projeto e coordenador quando aplicavel.",
          "Adicione os tecnicos participantes.",
          "Informe datas, prioridade e dados de cobranca.",
          "Salve para criar o projeto e abrir o acompanhamento."
        ]
      ),
      profileRole === "gestor"
        ? section(
            "Gerenciar tecnicos",
            "Cadastre e acompanhe tecnicos das equipes administradas.",
            ["Menu lateral", "Tecnicos"],
            [
              "Abra Tecnicos.",
              "Use busca e filtro por equipe para localizar usuarios.",
              "Clique para criar tecnico quando precisar adicionar alguem a equipe.",
              "Preencha dados, valor hora, skills, anexos e equipes.",
              "Salve e compartilhe o acesso de senha com o tecnico.",
              "Use o contador de feedback para registrar feedbacks do tecnico."
            ],
            "Se nenhuma equipe administrada aparecer, solicite ao Admin da empresa a configuracao das equipes do gestor."
          )
        : section(
            "Acompanhar tecnicos do projeto",
            "Veja tecnicos vinculados aos projetos coordenados e acompanhe entregas por atividades, OS e relatorios.",
            ["Projetos", "Abrir projeto", "Tecnicos"],
            [
              "Abra Projetos.",
              "Entre no projeto coordenado.",
              "Consulte os tecnicos vinculados no detalhe do projeto.",
              "Acompanhe atividades enviadas em OS para Aprovar.",
              "Use Relatorio de Atividade x Tecnico para conferir horas e apontamentos."
            ]
          ),
      section(
        "Criar tarefas e atividades",
        "Estruture o trabalho que sera executado pelos tecnicos.",
        ["Projetos", "Abrir projeto", "Area de trabalho"],
        [
          "Abra o projeto.",
          "Clique para adicionar uma tarefa.",
          "Informe nome, data inicial, data final e horas planejadas.",
          "Salve a tarefa e acompanhe as atividades vinculadas.",
          "Oriente os tecnicos a apontarem as atividades em Minhas Atividades."
        ]
      ),
      section(
        "Aprovar OS",
        "Revise apontamentos enviados por tecnicos e aprove ou estorne quando necessario.",
        ["Pagina inicial", "OS para Aprovar"],
        [
          "Abra OS para Aprovar.",
          "Use filtros de status, gestor e projeto.",
          "Confira tecnico, projeto, tarefa, data, horas previstas, horas apontadas e observacao.",
          "Clique no icone de aprovar para uma OS individual.",
          "Use selecao em massa para aprovar varias OS.",
          "Na aba de aprovadas, use estornar quando precisar devolver a OS para revisao."
        ]
      ),
      section(
        "Aprovar despesas",
        "Analise despesas de atividades ou despesas manuais conforme o acesso do perfil.",
        ["Menu lateral", "Despesas"],
        [
          "Abra Despesas.",
          "Filtre por projeto, tipo, usuario, aprovador ou periodo.",
          "Confira comprovante, valor, tipo e contexto da despesa.",
          "Aprove ou reprove a despesa.",
          "Quando disponivel, defina se a despesa fica como custo interno ou conta do cliente."
        ],
        "Gestor ve despesas dos proprios projetos e despesas tecnicas. Coordenador ve despesas vinculadas a projetos coordenados e despesas tecnicas permitidas."
      ),
      section(
        "Feedbacks da equipe",
        "Consulte recebidos e aplicados; gestores e coordenadores podem acompanhar feedbacks registrados.",
        ["Menu lateral", "Feedbacks"],
        [
          "Abra Feedbacks.",
          "Alterne entre feedbacks recebidos e aplicados quando a opcao aparecer.",
          "Use a busca para localizar historicos.",
          "Abra textos longos com Ver mais."
        ]
      ),
      section(
        "Relatorios de Gestor e Coordenador",
        "Acompanhe indicadores operacionais e exporte analises.",
        ["Menu lateral", "Relatorios"],
        [
          "Abra Relatorios.",
          "Use filtros globais e filtros individuais de cada card.",
          "Clique nos indicadores para abrir listas detalhadas de atividades.",
          "Maximize cards quando precisar analisar melhor.",
          "Exporte relatorios em PDF ou Excel."
        ],
        "Os relatorios exibidos dependem das permissoes definidas pelo Admin da empresa."
      )
    ],
    reportsText: "Gestor e Coordenador visualizam relatorios conforme permissao do Admin e escopo operacional do perfil.",
    faqs: [
      faq("Qual a diferenca entre Projetos e Meus Projetos?", "Projetos mostra a carteira permitida ao perfil. Meus Projetos destaca os projetos ligados ao usuario logado."),
      faq("Quando devo estornar uma OS?", "Use estorno quando a OS ja aprovada precisa voltar para revisao ou correcao.")
    ]
  };
}

function adminGuide(){
  return {
    key: "admin",
    title: "Manual do Admin da empresa",
    intro: "Use esta visao para administrar usuarios, equipes, clientes, projetos, permissoes, marca da empresa, OS, despesas, feedbacks e relatorios.",
    sections: [
      section(
        "Painel administrativo",
        "Acompanhe totais de usuarios, gestores, coordenadores, tecnicos, admins, equipes e bloqueios.",
        ["Pagina inicial", "Administracao"],
        [
          "Abra a Pagina inicial.",
          "Clique em Administracao.",
          "Revise os cards de resumo.",
          "Use busca e filtro de funcao para localizar usuarios."
        ]
      ),
      section(
        "Criar equipes",
        "Cadastre equipes que serao usadas em usuarios e projetos.",
        ["Administracao", "Equipes", "Nova equipe"],
        [
          "Clique em Nova equipe.",
          "Informe o nome da equipe.",
          "Confirme o identificador sugerido ou ajuste se necessario.",
          "Salve a equipe.",
          "Use detalhes da equipe para consultar ou ajustar integrantes."
        ]
      ),
      section(
        "Criar usuarios",
        "Somente o Admin da empresa cria Admins, Gestores, Coordenadores e Tecnicos dentro da empresa.",
        ["Administracao", "Usuarios", "Novo usuario"],
        [
          "Clique em Novo usuario.",
          "Informe nome, funcao, e-mail e telefone.",
          "Escolha entre Tecnico, Gestor, Coordenador ou Admin.",
          "Selecione pelo menos uma equipe para perfis que exigem equipe.",
          "Preencha foto, skills, CPF/CNPJ, endereco, data de nascimento e anexos quando necessario.",
          "Salve; o sistema cria o usuario e gera o acesso por redefinicao de senha."
        ],
        "Admins podem existir sem equipe. Para os demais perfis, selecione as equipes corretas antes de salvar."
      ),
      section(
        "Definir equipes administradas",
        "Associe gestores as equipes que eles podem administrar.",
        ["Administracao", "Usuarios", "Gestor", "Equipes administradas"],
        [
          "Localize o gestor na lista de usuarios.",
          "Abra a acao de equipes administradas.",
          "Selecione as equipes sob responsabilidade do gestor.",
          "Salve a alteracao.",
          "O gestor passa a trabalhar com os tecnicos dessas equipes."
        ]
      ),
      section(
        "Gerenciar tecnicos e feedbacks",
        "Cadastre, edite, visualize skills, anexos, equipes e feedbacks de tecnicos.",
        ["Menu lateral", "Tecnicos"],
        [
          "Abra Tecnicos.",
          "Use busca, filtro por equipe e paginacao.",
          "Crie ou edite tecnicos quando precisar.",
          "Abra o contador de feedback para registrar ou consultar feedbacks.",
          "Exporte a lista quando necessario."
        ]
      ),
      section(
        "Clientes e key users",
        "Mantenha clientes, contatos e vinculos de projetos atualizados.",
        ["Menu lateral", "Clientes"],
        [
          "Abra Clientes.",
          "Clique em Novo cliente.",
          "Preencha dados, contato, foto e status.",
          "Adicione key users com nome, e-mail e telefone.",
          "Salve e use as acoes da lista para editar, visualizar key users ou projetos do cliente."
        ]
      ),
      section(
        "Projetos, tarefas e acompanhamento",
        "Crie projetos completos e acompanhe a execucao da empresa.",
        ["Pagina inicial", "Projetos"],
        [
          "Abra Projetos.",
          "Crie ou edite projetos com cliente, equipe, gestor, coordenador, tecnicos, contrato, datas, status, prioridade e cobranca.",
          "Abra a area de trabalho do projeto.",
          "Crie tarefas com datas e horas planejadas.",
          "Acompanhe avancos pelo Kanban e pelos relatorios."
        ]
      ),
      section(
        "Permissoes e marca da empresa",
        "Controle o que cada perfil ve e personalize a identidade da empresa.",
        ["Menu lateral", "Configuracoes"],
        [
          "Abra Configuracoes.",
          "Use Marca da empresa para alterar nome e logo do menu e relatorios.",
          "Use Permissoes de relatorios para liberar ou ocultar cards por perfil.",
          "Salve as configuracoes para aplicar aos usuarios da empresa."
        ]
      ),
      section(
        "OS, despesas e operacao",
        "Aprove apontamentos, despesas e acompanhe custos operacionais.",
        ["Pagina inicial", "OS para Aprovar", "Menu lateral", "Despesas"],
        [
          "Abra OS para Aprovar para revisar apontamentos.",
          "Aprove ou estorne OS individualmente ou em massa.",
          "Abra Despesas para analisar comprovantes.",
          "Aprove ou reprove despesas e defina responsabilidade interna ou cliente quando aplicavel.",
          "Use filtros para encontrar registros por projeto, usuario, tipo ou periodo."
        ]
      ),
      section(
        "Relatorios do Admin",
        "Admin pode acessar todos os indicadores habilitados e configurar permissoes dos demais perfis.",
        ["Menu lateral", "Relatorios"],
        [
          "Abra Relatorios.",
          "Use periodo, cliente, equipe e status nos filtros globais.",
          "Use filtros especificos de cada card para aprofundar a analise.",
          "Clique em indicadores para abrir detalhes.",
          "Exporte cards ou o painel em PDF/Excel."
        ]
      )
    ],
    reportsText: "Admin pode liberar ou bloquear cada relatorio por perfil em Configuracoes > Permissoes de relatorios.",
    faqs: [
      faq("Quem pode criar Gestor, Coordenador e Admin?", "Somente o Admin da empresa cria esses perfis dentro da empresa."),
      faq("Por que um tecnico nao ve um relatorio?", "O relatorio pode estar desabilitado para Tecnico em Configuracoes > Permissoes de relatorios."),
      faq("Quando criar uma equipe antes do usuario?", "Crie a equipe primeiro quando o usuario precisa ficar vinculado a uma equipe desde o cadastro.")
    ]
  };
}

function masterGuide(){
  return {
    key: "master",
    title: "Manual do Admin Master",
    intro: "Use esta visao para administrar empresas da plataforma e criar o Admin inicial de cada empresa.",
    sections: [
      section(
        "Gerenciar empresas",
        "Consulte empresas cadastradas e usuarios vinculados.",
        ["Pagina inicial", "Empresas"],
        [
          "Abra Empresas.",
          "Use a busca para localizar a empresa.",
          "Abra detalhes para ver usuarios e status.",
          "Bloqueie ou desbloqueie empresa quando necessario."
        ]
      ),
      section(
        "Criar empresa com Admin",
        "Cadastre uma nova empresa e gere o primeiro Admin da empresa.",
        ["Empresas", "Nova empresa"],
        [
          "Informe nome, CNPJ e identificador da empresa.",
          "Informe nome, e-mail e telefone do Admin.",
          "Defina se o Admin inicia ativo.",
          "Salve e envie o link de definicao de senha ao Admin."
        ]
      )
    ],
    reportsText: "",
    faqs: [
      faq("O Admin Master cria usuarios operacionais?", "O fluxo principal do Admin Master e criar empresas e o Admin inicial. A administracao operacional fica com o Admin da empresa.")
    ]
  };
}

function getGuide(state){
  const key = currentGuideKey(state);
  if (key === "admin") return adminGuide();
  if (key === "gestao") return gestaoGuide(String(state?.profile?.role || "").toLowerCase());
  if (key === "master") return masterGuide();
  return tecnicoGuide();
}

function renderGuide(refs, state){
  if (!refs.manualContent) return;
  const guide = getGuide(state);
  const title = refs.manualTitle;
  const subtitle = refs.manualSubtitle;
  const role = refs.manualRoleLabel;
  if (title) title.textContent = guide.title;
  if (subtitle) subtitle.textContent = guide.intro;
  if (role) role.textContent = roleTitle(state);

  refs.manualContent.innerHTML = `
    <div class="manual-summary">
      <div>
        <span class="manual-kicker">Resumo simplificado</span>
        <strong>${escapeHtml(guide.title)}</strong>
        <p>${escapeHtml(guide.intro)}</p>
      </div>
    </div>
    <div class="manual-section-list">
      ${guide.sections.join("")}
    </div>
    ${guide.reportsText ? `
      <section class="manual-reports">
        <div class="manual-section-head">
          <h3>Relatorios disponiveis no sistema</h3>
          <p>${escapeHtml(guide.reportsText)}</p>
        </div>
        ${reportList("")}
      </section>
    ` : ""}
    <section class="manual-faq">
      <div class="manual-section-head">
        <h3>FAQ rapido</h3>
        <p>Duvidas comuns do perfil atual.</p>
      </div>
      ${guide.faqs.join("")}
    </section>
  `;
}

function applySearch(refs){
  const q = String(refs.manualSearch?.value || "").trim().toLowerCase();
  const nodes = Array.from(refs.manualContent?.querySelectorAll?.(".manual-section, .manual-faq-item, .manual-reports") || []);
  nodes.forEach((node) => {
    const text = String(node.getAttribute("data-manual-search") || node.textContent || "").toLowerCase();
    node.hidden = Boolean(q && !text.includes(q));
  });
}

export function initHelpManual(deps){
  const { refs, state } = deps || {};
  if (!refs?.modalHelpManual) return;
  const triggers = [refs.btnHelpManual, refs.navHelpManual].filter(Boolean);
  if (!triggers.length) return;

  const close = () => {
    refs.modalHelpManual.hidden = true;
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  };

  const open = () => {
    renderGuide(refs, state);
    refs.modalHelpManual.hidden = false;
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "true"));
    if (refs.manualSearch) {
      refs.manualSearch.value = "";
      window.setTimeout(() => refs.manualSearch?.focus(), 40);
    }
  };

  triggers.forEach((trigger) => {
    if (trigger.dataset.manualBound === "1") return;
    trigger.dataset.manualBound = "1";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (refs.modalHelpManual.hidden) open();
      else close();
    });
  });

  refs.btnCloseHelpManual?.addEventListener("click", close);
  refs.btnCancelHelpManual?.addEventListener("click", close);
  refs.modalHelpManual.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeHelpManual === "true") close();
  });
  refs.manualSearch?.addEventListener("input", () => applySearch(refs));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.modalHelpManual.hidden) close();
  });
}
