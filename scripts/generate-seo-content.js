const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const blogDir = path.join(publicDir, "blog");
const site = "https://portalprojectflow.com";
const supportEmail = "suporte@portalprojectflow.com";
const whatsapp = "https://wa.me/5511943362288?text=Ol%C3%A1%2C%20quero%20conhecer%20o%20FlowProject";
const today = "2026-05-20";

const landingPages = [
  {
    slug: "software-gestao-projetos",
    keyword: "software de gestao de projetos",
    title: "Software de Gestao de Projetos com Controle Operacional | FlowProject",
    description: "Software de gestao de projetos para controlar Kanban, Gantt, horas, OS, despesas, equipes, clientes e status reports em uma operacao B2B.",
    h1: "Software de gestao de projetos com controle operacional de ponta a ponta",
    eyebrow: "Gestao de projetos B2B",
    lead: "O FlowProject conecta planejamento, execucao tecnica, controle de horas, ordens de servico, despesas, recursos e relatorios para empresas que precisam sair de planilhas e ganhar previsibilidade operacional.",
    intent: "Empresas procurando uma plataforma para centralizar projetos, equipes, horas, custos e relatorios.",
    image: "dashboard.png",
    imageAlt: "Dashboard do FlowProject para gestao de projetos, agenda, OS e lembretes",
    sections: [
      ["Planejamento com Kanban e Gantt", "Organize projetos por status, prioridade, responsavel, cliente, prazo e horas planejadas. Use Kanban para a rotina diaria e Gantt para visualizar cronograma, dependencias e atrasos."],
      ["Execucao tecnica com rastreabilidade", "Registre atividades, acompanhe apontamentos, aprove OS e mantenha historico de execucao por recurso, cliente e projeto."],
      ["Gestao operacional e financeira", "Acompanhe horas, despesas, custo de recursos, margem e status do projeto para tomar decisoes com dados atualizados."]
    ],
    benefits: ["Projetos, clientes e equipes no mesmo fluxo", "Timesheet, OS e despesas integradas", "Status report automatico para gestor, executivo e cliente", "Historico persistente por cliente e recurso"],
    faq: [
      ["O FlowProject substitui planilhas de projeto?", "Sim. A plataforma centraliza projetos, atividades, horas, OS, despesas, clientes, equipes e relatorios em um fluxo operacional unico."],
      ["O software tem Kanban e Gantt?", "Sim. O FlowProject combina Kanban para acompanhamento visual e Gantt para cronogramas, tarefas, atividades e prazos."],
      ["Serve para empresas de servicos?", "Sim. O sistema foi criado para operacoes B2B com equipes tecnicas, consultorias, software houses, PMOs e prestadores de servicos."]
    ],
    related: ["controle-horas-projetos", "dashboard-projetos", "status-report-projetos"]
  },
  {
    slug: "software-ordem-servico",
    keyword: "software de ordem de servico",
    title: "Software de Ordem de Servico Integrado a Projetos | FlowProject",
    description: "Controle ordens de servico, apontamentos, aprovacoes, horas, despesas e relatorios por projeto, cliente e equipe tecnica.",
    h1: "Software de ordem de servico integrado a projetos, horas e clientes",
    eyebrow: "OS integrada",
    lead: "O FlowProject ajuda empresas de servicos a controlar OS sem separar a execucao tecnica do projeto, do timesheet, das despesas e do historico do cliente.",
    intent: "Gestores que precisam controlar OS, aprovar atividades e manter rastreabilidade operacional.",
    image: "workspace.png",
    imageAlt: "Workspace do FlowProject com tarefas, horas, despesas e status reports",
    sections: [
      ["Da atividade executada a aprovacao", "Acompanhe registros enviados pela equipe, revise apontamentos, aprove OS e mantenha evidencia do que foi realizado."],
      ["OS ligada ao projeto e ao cliente", "Cada ordem de servico fica conectada ao projeto, recurso, cliente e historico operacional, evitando informacoes soltas."],
      ["Menos retrabalho no fechamento", "Horas, atividades e despesas ficam organizadas para facilitar conferencia, faturamento, margem e comunicacao com cliente."]
    ],
    benefits: ["Aprovacao de OS por perfil", "Historico de atividades executadas", "Controle de horas e despesas no mesmo contexto", "Relatorios por projeto, cliente e recurso"],
    faq: [
      ["O sistema controla ordem de servico?", "Sim. O FlowProject permite acompanhar OS, apontamentos, aprovacoes, estornos e historico por projeto e recurso."],
      ["A OS fica ligada ao controle de horas?", "Sim. A execucao registrada pela equipe alimenta a visao de horas, produtividade e acompanhamento do projeto."],
      ["Serve para equipe tecnica externa?", "Sim. Empresas com tecnicos, consultores ou prestadores podem organizar atividades, OS, despesas e relatorios."]
    ],
    related: ["gestao-equipes-tecnicas", "controle-horas-projetos", "gestao-prestacao-servicos"]
  },
  {
    slug: "controle-horas-projetos",
    keyword: "controle de horas em projetos",
    title: "Controle de Horas em Projetos e Timesheet | FlowProject",
    description: "Controle horas por projeto, tarefa, cliente e recurso com timesheet, OS, aprovacoes, produtividade e relatorios operacionais.",
    h1: "Controle de horas em projetos com timesheet, OS e produtividade",
    eyebrow: "Timesheet operacional",
    lead: "O FlowProject organiza apontamentos de horas dentro do contexto real da operacao: projeto, cliente, tarefa, equipe, OS, despesa e relatorio.",
    intent: "Empresas buscando controlar horas trabalhadas, produtividade e custos por projeto.",
    image: "kanban.png",
    imageAlt: "Kanban do FlowProject com projetos, horas, custos e status",
    sections: [
      ["Horas por tarefa e recurso", "Registre horas trabalhadas por atividade, responsavel, cliente e projeto para entender carga, produtividade e custo real."],
      ["Aprovacoes e historico", "Mantenha rastreabilidade dos apontamentos, reduzindo divergencias entre o que foi planejado, executado e aprovado."],
      ["Indicadores para decisao", "Use horas planejadas e executadas para analisar atraso, margem, consumo de recursos e saude da carteira."]
    ],
    benefits: ["Timesheet por projeto e cliente", "Aprovacao de apontamentos", "Visao de produtividade por recurso", "Base para status report e controle financeiro"],
    faq: [
      ["O FlowProject tem timesheet?", "Sim. A plataforma permite acompanhar horas, atividades, responsaveis, aprovacoes e relatorios por projeto."],
      ["Consigo ver produtividade da equipe?", "Sim. O sistema ajuda a analisar apontamentos, agendas, carga e historico de execucao por recurso."],
      ["As horas alimentam relatorios?", "Sim. As horas registradas apoiam status reports, indicadores de custo e acompanhamento operacional."]
    ],
    related: ["controle-produtividade-equipe", "gestao-financeira-projetos", "software-ordem-servico"]
  },
  {
    slug: "gestao-operacional",
    keyword: "gestao operacional",
    title: "Plataforma de Gestao Operacional para Empresas de Servicos | FlowProject",
    description: "Gestao operacional para projetos, equipes tecnicas, OS, horas, despesas, clientes, dashboards e status reports em uma unica plataforma.",
    h1: "Gestao operacional para empresas que precisam controlar servicos, equipes e projetos",
    eyebrow: "Controle operacional",
    lead: "Mais que uma ferramenta de projetos, o FlowProject centraliza a rotina operacional de empresas B2B que precisam enxergar prazos, custos, produtividade e entregas.",
    intent: "Gestores operacionais procurando governanca para execucao, controle e acompanhamento.",
    image: "OPERACAO.PNG",
    imageAlt: "Tela de gestao operacional do FlowProject para controle de projetos, equipes, OS e indicadores",
    sections: [
      ["Operacao conectada", "Projetos, clientes, equipes, agendas, OS, horas, despesas e relatorios ficam no mesmo fluxo."],
      ["Visibilidade para gestores", "Acompanhe gargalos, pendencias, agendas e status sem depender de reunioes manuais ou planilhas paralelas."],
      ["Padrao para execucao tecnica", "Crie uma rotina clara para tecnicos, coordenadores, gestores e administradores trabalharem com o mesmo contexto."]
    ],
    benefits: ["Controle operacional B2B", "Gestao de equipes tecnicas", "Dashboards e status reports", "Historico por cliente e projeto"],
    faq: [
      ["O que e gestao operacional no FlowProject?", "E a centralizacao de projetos, equipes, horas, OS, despesas, clientes e relatorios em uma rotina unica de acompanhamento."],
      ["Serve para operacoes com servicos recorrentes?", "Sim. A plataforma atende empresas que executam projetos, suporte, implantacoes e servicos tecnicos recorrentes."],
      ["Ajuda gestores operacionais?", "Sim. O FlowProject oferece dashboards, historico, controle de atividades e visao por projeto, cliente e recurso."]
    ],
    related: ["gestao-prestacao-servicos", "gestao-equipes-tecnicas", "dashboard-projetos"]
  },
  {
    slug: "gestao-financeira-projetos",
    keyword: "gestao financeira de projetos",
    title: "Gestao Financeira de Projetos com Horas, Custos e Despesas | FlowProject",
    description: "Acompanhe custos, horas, despesas, margem, recursos e status financeiro de projetos em uma plataforma operacional B2B.",
    h1: "Gestao financeira de projetos com horas, despesas, custos e margem",
    eyebrow: "Visao financeira",
    lead: "O FlowProject aproxima execucao e financeiro ao conectar horas trabalhadas, custo de recursos, despesas, margem e relatorios do projeto.",
    intent: "Empresas que precisam controlar custo e margem de projetos e servicos.",
    image: "workspace.png",
    imageAlt: "Workspace do FlowProject com indicadores de horas, despesas e margem",
    sections: [
      ["Horas viram custo visivel", "Acompanhe consumo de horas por recurso, tarefa e cliente para entender custo real e impacto na margem."],
      ["Despesas com aprovacao", "Registre despesas operacionais, comprovantes e status para manter controle financeiro ligado ao projeto."],
      ["Relatorios para decisao", "Use dados do workspace para comunicar saude financeira, desvios, riscos e proximas acoes."]
    ],
    benefits: ["Controle de despesas por projeto", "Custo de recursos e valor hora", "Margem e consumo de horas", "Indicadores para gestores e executivos"],
    faq: [
      ["O FlowProject controla despesas?", "Sim. A plataforma permite registrar despesas, comprovantes, status e aprovacoes ligadas aos projetos."],
      ["Consigo acompanhar margem do projeto?", "Sim. O workspace ajuda a visualizar horas, custos, despesas e margem para apoiar decisoes."],
      ["Serve para fechamento financeiro?", "Sim. Os dados operacionais ajudam a conferir horas, OS, despesas e relatorios por cliente."]
    ],
    related: ["controle-horas-projetos", "status-report-projetos", "gestao-recursos-projetos"]
  },
  {
    slug: "gestao-equipes-tecnicas",
    keyword: "gestao de equipes tecnicas",
    title: "Gestao de Equipes Tecnicas, Recursos e Agendas | FlowProject",
    description: "Gerencie equipes tecnicas, recursos, skills, agendas, feedbacks, horas, OS e produtividade em uma plataforma operacional.",
    h1: "Gestao de equipes tecnicas com agenda, skills, horas e feedbacks",
    eyebrow: "Equipes tecnicas",
    lead: "O FlowProject ajuda gestores a enxergar quem esta alocado, quais skills existem, como esta a agenda, quanto foi executado e onde a equipe precisa de atencao.",
    intent: "Coordenadores e gestores que precisam organizar recursos tecnicos e produtividade.",
    image: "recursos.png",
    imageAlt: "Tela de recursos do FlowProject com equipe, skills, agenda e feedback",
    sections: [
      ["Recursos com contexto", "Cadastre equipe, valor hora, skills, status, feedbacks e historico de alocacao para planejar melhor."],
      ["Agenda e disponibilidade", "Visualize compromissos, projetos e atividades para reduzir conflitos de agenda e melhorar distribuicao de carga."],
      ["Produtividade acompanhada", "Relacione horas, atividades, OS e feedbacks para entender desempenho operacional com mais clareza."]
    ],
    benefits: ["Cadastro de recursos e skills", "Agenda por recurso", "Feedbacks e historico", "Produtividade por equipe"],
    faq: [
      ["Consigo cadastrar recursos tecnicos?", "Sim. O FlowProject permite gerenciar recursos, equipes, skills, valor hora, status, agenda e feedbacks."],
      ["A plataforma mostra agenda da equipe?", "Sim. A agenda ajuda gestores a acompanhar atividades planejadas e carga operacional."],
      ["Serve para coordenadores tecnicos?", "Sim. Coordenadores podem acompanhar projetos, recursos, atividades, OS e relatorios conforme perfil de acesso."]
    ],
    related: ["gestao-recursos-projetos", "controle-produtividade-equipe", "software-ordem-servico"]
  },
  {
    slug: "status-report-projetos",
    keyword: "status report de projetos",
    title: "Status Report de Projetos Automatico para Gestores e Clientes | FlowProject",
    description: "Gere status reports de projetos com horas, custos, tarefas, despesas, riscos, margem, executivo e cliente a partir da operacao.",
    h1: "Status report de projetos automatico com dados da operacao",
    eyebrow: "Status report automatico",
    lead: "O FlowProject transforma tarefas, horas, despesas, prazo, custos e margem em relatorios para gestor, executivo e cliente sem montar tudo manualmente.",
    intent: "Gestores buscando automatizar comunicacao de status e acompanhamento executivo.",
    image: "workspace.png",
    imageAlt: "Workspace com botoes de status report, executivo e cliente",
    sections: [
      ["Relatorio gerencial", "Mostre andamento, horas, custos, atividades, pendencias e proximas acoes para acompanhar a saude do projeto."],
      ["Resumo executivo", "Ofereca uma visao objetiva de prazo, risco, margem e evolucao para liderancas que precisam decidir rapido."],
      ["Comunicacao com cliente", "Gere informacoes claras para o cliente acompanhar entregas, tarefas e status sem excesso de ruido operacional."]
    ],
    benefits: ["Status report gerencial", "Status executivo", "Status report para cliente", "Menos montagem manual de relatorios"],
    faq: [
      ["O status report e automatico?", "Sim. O FlowProject usa dados do workspace para apoiar relatorios de status para gestor, executivo e cliente."],
      ["Quais dados entram no status report?", "Horas, custos, despesas, tarefas, atividades, margem, prazo, pendencias e contexto do projeto."],
      ["Ajuda na comunicacao com cliente?", "Sim. O status report para cliente organiza a comunicacao de entregas e proximos passos."]
    ],
    related: ["dashboard-projetos", "gestao-financeira-projetos", "software-pmo"]
  },
  {
    slug: "dashboard-projetos",
    keyword: "dashboard de projetos",
    title: "Dashboard de Projetos, OS, Agenda e Indicadores | FlowProject",
    description: "Dashboard de projetos para acompanhar agenda, OS, lembretes, indicadores, equipes, horas, clientes e status operacional.",
    h1: "Dashboard de projetos para enxergar operacao, agenda e pendencias",
    eyebrow: "Dashboard operacional",
    lead: "O dashboard do FlowProject concentra sinais importantes da operacao para gestores acompanharem projetos, agendas, OS, lembretes e prioridades.",
    intent: "Empresas buscando visibilidade gerencial e operacional de projetos.",
    image: "dashboard.png",
    imageAlt: "Dashboard do FlowProject com painel de projetos, agenda e OS",
    sections: [
      ["Painel para o dia a dia", "Veja agenda, lembretes e atalhos operacionais em uma tela pensada para acompanhamento recorrente."],
      ["OS e pendencias em foco", "Acesse aprovacoes e atividades que exigem acao do gestor sem procurar em planilhas ou mensagens."],
      ["Base para decisao", "Combine dashboard, Kanban, Gantt e relatorios para entender execucao, produtividade e gargalos."]
    ],
    benefits: ["Agenda de projetos", "OS para aprovar", "Mural de lembretes", "Atalhos para rotina operacional"],
    faq: [
      ["O FlowProject tem dashboard?", "Sim. A plataforma possui dashboard com agenda, projetos, OS para aprovar e lembretes."],
      ["O dashboard ajuda gestores?", "Sim. Ele centraliza sinais da operacao e reduz dependencia de controles paralelos."],
      ["Consigo acompanhar pendencias?", "Sim. OS, agenda, lembretes e projetos ajudam a identificar o que precisa de atencao."]
    ],
    related: ["gestao-operacional", "software-gestao-projetos", "status-report-projetos"]
  },
  {
    slug: "gestao-consultorias",
    keyword: "gestao de consultorias",
    title: "Gestao de Consultorias, Projetos, Horas e Clientes | FlowProject",
    description: "Plataforma para gestao de consultorias com projetos, clientes, consultores, horas, OS, despesas, dashboards e status reports.",
    h1: "Gestao de consultorias com controle de projetos, horas, OS e clientes",
    eyebrow: "Consultorias B2B",
    lead: "O FlowProject foi desenhado para consultorias que precisam organizar implantacoes, suporte, projetos, consultores, clientes, horas, custos e relatorios.",
    intent: "Consultorias buscando profissionalizar operacao, entregas e acompanhamento de clientes.",
    image: "recursos.png",
    imageAlt: "Gestao de recursos e consultores no FlowProject",
    sections: [
      ["Clientes e projetos organizados", "Mantenha historico por cliente, controle projetos em andamento e acompanhe entregas recorrentes."],
      ["Consultores, agendas e horas", "Gerencie alocacao, disponibilidade, apontamentos, OS, feedbacks e produtividade da equipe."],
      ["Relatorios para diretoria e cliente", "Use status reports para comunicar andamento, riscos, custos e proximas acoes com mais profissionalismo."]
    ],
    benefits: ["Projetos por cliente", "Controle de consultores", "Timesheet e OS", "Status reports para clientes"],
    faq: [
      ["Serve para consultoria de TI?", "Sim. Consultorias de TI, ERP, sistemas e operacoes B2B podem controlar projetos, horas, OS, despesas e relatorios."],
      ["Ajuda no relacionamento com cliente?", "Sim. Historico, relatorios e status reports tornam a comunicacao mais clara e rastreavel."],
      ["Consigo controlar consultores?", "Sim. E possivel acompanhar recursos, agendas, skills, horas e atividades."]
    ],
    related: ["gestao-implantacao-erp", "controle-projetos-erp", "gestao-prestacao-servicos"]
  },
  {
    slug: "gestao-implantacao-erp",
    keyword: "gestao de implantacao ERP",
    title: "Gestao de Implantacao ERP com Projetos, Consultores e Status | FlowProject",
    description: "Controle implantacao ERP com cronograma, Kanban, Gantt, consultores, horas, OS, clientes, custos e status reports automaticos.",
    h1: "Gestao de implantacao ERP com cronograma, equipe, horas e status report",
    eyebrow: "Implantacao ERP",
    lead: "O FlowProject ajuda consultorias e equipes de implantacao a acompanhar fases, tarefas, consultores, horas, despesas, riscos e comunicacao com o cliente.",
    intent: "Consultorias ERP e equipes de implantacao buscando controle de cronograma e execucao.",
    image: "kanban.png",
    imageAlt: "Kanban para controle de projetos de implantacao ERP",
    sections: [
      ["Cronograma de implantacao", "Use Gantt e Kanban para acompanhar fases, prazos, tarefas, responsaveis e dependencias."],
      ["Consultores e apontamentos", "Controle alocacao, horas, atividades, OS e custos de consultores por projeto e cliente."],
      ["Status para cliente", "Comunique progresso, riscos, pendencias e proximos passos com relatorios gerados a partir da operacao."]
    ],
    benefits: ["Kanban e Gantt para implantacao", "Controle de consultores", "Horas e OS por projeto", "Status report para cliente"],
    faq: [
      ["O FlowProject serve para implantacao ERP?", "Sim. Ele atende projetos de implantacao ERP, sistemas, suporte e consultoria com controle de horas, equipe e status."],
      ["Preciso focar em um ERP especifico?", "Nao. O fluxo e amplo para implantacoes de ERP e sistemas em geral."],
      ["Ajuda no cronograma?", "Sim. O Gantt e o Kanban ajudam a visualizar etapas, tarefas, atividades e prazos."]
    ],
    related: ["controle-projetos-erp", "gestao-consultorias", "status-report-projetos"]
  },
  {
    slug: "controle-produtividade-equipe",
    keyword: "controle de produtividade da equipe",
    title: "Controle de Produtividade da Equipe Tecnica | FlowProject",
    description: "Acompanhe produtividade da equipe com horas, atividades, OS, agenda, feedbacks, projetos, recursos e relatorios operacionais.",
    h1: "Controle de produtividade da equipe com horas, atividades e OS",
    eyebrow: "Produtividade operacional",
    lead: "O FlowProject da visibilidade para gestores entenderem carga, execucao, apontamentos, feedbacks e gargalos da equipe tecnica.",
    intent: "Gestores buscando medir produtividade sem perder contexto operacional.",
    image: "recursos.png",
    imageAlt: "Tela de equipes e recursos para controle de produtividade",
    sections: [
      ["Atividades com contexto", "Analise produtividade a partir de projetos, tarefas, clientes, OS, horas e agenda, nao apenas de numeros isolados."],
      ["Feedback e historico", "Registre feedbacks e mantenha historico por recurso para apoiar desenvolvimento e qualidade da operacao."],
      ["Mais previsibilidade", "Entenda carga, disponibilidade e volume executado para planejar melhor proximos projetos."]
    ],
    benefits: ["Horas por recurso", "Agenda e carga de trabalho", "Feedbacks registrados", "Indicadores por projeto e cliente"],
    faq: [
      ["Consigo medir produtividade?", "Sim. A plataforma ajuda a acompanhar horas, atividades, OS, agenda e historico por recurso."],
      ["Existe feedback para equipe?", "Sim. O FlowProject possui controle de feedbacks ligados aos recursos."],
      ["Ajuda a planejar alocacao?", "Sim. Agenda, skills e historico ajudam gestores a distribuir melhor a carga."]
    ],
    related: ["gestao-equipes-tecnicas", "controle-horas-projetos", "gestao-recursos-projetos"]
  },
  {
    slug: "gestao-prestacao-servicos",
    keyword: "gestao de prestacao de servicos",
    title: "Gestao de Prestacao de Servicos B2B com OS, Horas e Projetos | FlowProject",
    description: "Controle prestacao de servicos com projetos, clientes, OS, horas, despesas, equipes tecnicas, dashboards e relatorios.",
    h1: "Gestao de prestacao de servicos com controle operacional B2B",
    eyebrow: "Empresas de servicos",
    lead: "O FlowProject organiza a operacao de empresas que prestam servicos tecnicos, consultivos ou recorrentes para clientes B2B.",
    intent: "Empresas de servicos procurando sistema para controlar entregas, clientes e equipe.",
    image: "dashboard.png",
    imageAlt: "Dashboard para gestao de prestacao de servicos",
    sections: [
      ["Clientes e historico", "Centralize projetos, atividades, OS, despesas e relatorios por cliente para melhorar rastreabilidade."],
      ["Equipe e execucao", "Acompanhe tecnicos, consultores, agendas, horas, apontamentos e aprovacoes em um fluxo unico."],
      ["Indicadores e comunicacao", "Use dashboards e status reports para monitorar prazos, custos, produtividade e riscos."]
    ],
    benefits: ["Controle de clientes", "OS e timesheet", "Despesas e aprovacoes", "Relatorios de servicos"],
    faq: [
      ["Serve para empresas de servicos?", "Sim. O FlowProject atende empresas B2B que executam projetos, atendimento tecnico, consultoria e suporte."],
      ["Consigo controlar cliente por cliente?", "Sim. O sistema mantem historico operacional por cliente e projeto."],
      ["Ajuda no acompanhamento da equipe?", "Sim. Recursos, agendas, horas, OS e feedbacks ajudam a gerir a equipe tecnica."]
    ],
    related: ["software-ordem-servico", "gestao-operacional", "gestao-consultorias"]
  },
  {
    slug: "software-pmo",
    keyword: "software para PMO",
    title: "Software para PMO com Projetos, Indicadores e Status Reports | FlowProject",
    description: "Software para PMO acompanhar projetos, portifolio, indicadores, prazos, horas, custos, riscos, equipes e status reports.",
    h1: "Software para PMO com visao operacional, financeira e executiva dos projetos",
    eyebrow: "PMO e governanca",
    lead: "O FlowProject apoia PMOs que precisam padronizar acompanhamento de projetos, horas, custos, cronogramas, status reports e comunicacao executiva.",
    intent: "PMOs procurando ferramenta de controle, governanca e report executivo.",
    image: "workspace.png",
    imageAlt: "Workspace para PMO com indicadores e status report",
    sections: [
      ["Padrao de acompanhamento", "Organize projetos com status, responsaveis, prazos, tarefas, horas, custos e historico."],
      ["Relatorios executivos", "Gere visoes para liderancas acompanharem prazo, margem, risco e evolucao sem montar tudo do zero."],
      ["Operacao conectada ao PMO", "Traga dados reais de execucao, OS, despesas e equipe para a governanca de projetos."]
    ],
    benefits: ["Kanban e Gantt", "Status report executivo", "Indicadores de prazo e custo", "Historico e governanca por projeto"],
    faq: [
      ["O FlowProject serve para PMO?", "Sim. Ele apoia controle operacional, indicadores, cronogramas e status reports para governanca de projetos."],
      ["Tem relatorio executivo?", "Sim. A plataforma possui status executivo a partir dos dados do workspace."],
      ["Ajuda no portifolio?", "Sim. Kanban, dashboard e relatorios ajudam a acompanhar varios projetos e priorizar atencao."]
    ],
    related: ["status-report-projetos", "dashboard-projetos", "software-gestao-projetos"]
  },
  {
    slug: "controle-projetos-erp",
    keyword: "controle de projetos ERP",
    title: "Controle de Projetos ERP com Consultores, Horas e Cronograma | FlowProject",
    description: "Controle projetos ERP com fases, Kanban, Gantt, consultores, horas, OS, despesas, clientes, riscos e status reports.",
    h1: "Controle de projetos ERP para consultorias e equipes de implantacao",
    eyebrow: "Projetos ERP",
    lead: "O FlowProject ajuda a controlar projetos ERP de forma ampla, sem depender de um fornecedor especifico, conectando cronograma, equipe, horas, custos e cliente.",
    intent: "Consultorias e times internos procurando controlar projetos ERP e implantacoes.",
    image: "kanban.png",
    imageAlt: "Kanban de projetos ERP no FlowProject",
    sections: [
      ["Fases e entregas no Kanban", "Acompanhe projetos ERP por status, prioridade, responsavel, cliente e horas planejadas."],
      ["Cronograma no Gantt", "Visualize prazos, atividades, dependencias e atrasos para reduzir surpresa na implantacao."],
      ["Consultores e custos", "Controle horas, OS, despesas e margem para entender o impacto financeiro do projeto."]
    ],
    benefits: ["Kanban para projetos ERP", "Gantt para implantacao", "Timesheet de consultores", "Status report para cliente"],
    faq: [
      ["O FlowProject e somente para Protheus ou TOTVS?", "Nao. O foco e amplo: ERP, sistemas, consultorias, implantacoes e operacoes tecnicas em geral."],
      ["Ajuda a controlar consultores ERP?", "Sim. Recursos, agenda, horas, OS e feedbacks ajudam a acompanhar consultores."],
      ["Gera status do projeto?", "Sim. O workspace apoia status reports gerenciais, executivos e para clientes."]
    ],
    related: ["gestao-implantacao-erp", "gestao-consultorias", "controle-horas-projetos"]
  },
  {
    slug: "gestao-recursos-projetos",
    keyword: "gestao de recursos em projetos",
    title: "Gestao de Recursos em Projetos, Skills e Alocacao | FlowProject",
    description: "Gerencie recursos em projetos com skills, agenda, valor hora, feedbacks, apontamentos, OS, produtividade e relatorios.",
    h1: "Gestao de recursos em projetos com skills, agenda e produtividade",
    eyebrow: "Recursos e alocacao",
    lead: "O FlowProject da aos gestores uma visao pratica dos recursos envolvidos na operacao: quem esta disponivel, quais skills possui, quanto custa e o que executou.",
    intent: "Gestores buscando controlar alocacao, recursos e capacidade operacional em projetos.",
    image: "recursos.png",
    imageAlt: "Tela de recursos do FlowProject com skills, agenda, status e feedback",
    sections: [
      ["Cadastro de recursos completo", "Mantenha nome, equipe, valor hora, skills, status, feedbacks e vinculo com projetos em um so lugar."],
      ["Alocacao com agenda", "Use agenda e historico para planejar capacidade, evitar sobrecarga e melhorar previsibilidade."],
      ["Recursos ligados ao financeiro", "Valor hora, apontamentos e despesas ajudam a entender custo real e margem dos projetos."]
    ],
    benefits: ["Skills e equipes", "Valor hora e custo", "Agenda e disponibilidade", "Feedback e historico de execucao"],
    faq: [
      ["Consigo gerir recursos por projeto?", "Sim. O FlowProject permite acompanhar recursos, equipes, agenda, skills, horas e vinculos com projetos."],
      ["O valor hora entra na visao financeira?", "Sim. O valor hora dos recursos ajuda a compor custo, margem e analise operacional."],
      ["Serve para alocacao de consultores?", "Sim. Consultorias e equipes tecnicas podem usar agenda, skills e historico para planejar alocacao."]
    ],
    related: ["gestao-equipes-tecnicas", "gestao-financeira-projetos", "controle-produtividade-equipe"]
  }
];

const categories = [
  { slug: "gestao-projetos", name: "Gestao de projetos", description: "Planejamento, execucao, controle e governanca de projetos B2B." },
  { slug: "implantacao-erp", name: "Implantacao ERP", description: "Conteudos para consultorias e equipes que implantam ERP e sistemas." },
  { slug: "ordem-servico", name: "Ordens de servico", description: "OS, apontamentos, aprovacoes, evidencias e operacao tecnica." },
  { slug: "produtividade", name: "Produtividade", description: "Gestao de equipe, controle de horas, alocacao e indicadores." },
  { slug: "gestao-operacional", name: "Gestao operacional", description: "Controle operacional, prestacao de servicos, dashboards e processos." },
  { slug: "financeiro-projetos", name: "Financeiro de projetos", description: "Horas, custos, despesas, margem e visao financeira de projetos." },
  { slug: "pmo-dashboards", name: "PMO e dashboards", description: "Relatorios, indicadores, status report e acompanhamento executivo." }
];

const articleSeeds = [
  ["gestao-projetos", "Como escolher um software de gestao de projetos para empresas de servicos", "software de gestao de projetos para empresas de servicos", "Comparacao comercial"],
  ["gestao-projetos", "Gestao de projetos operacionais: como sair das planilhas sem perder controle", "gestao de projetos operacionais", "Educacional"],
  ["gestao-projetos", "Kanban e Gantt juntos: quando usar cada visao na gestao de projetos", "kanban e gantt na gestao de projetos", "Educacional"],
  ["gestao-projetos", "Como organizar uma carteira de projetos com clientes, equipes e prazos", "carteira de projetos com clientes", "Educacional"],
  ["gestao-projetos", "Indicadores essenciais para acompanhar projetos de servicos B2B", "indicadores de projetos de servicos", "Educacional"],
  ["gestao-projetos", "Como padronizar a execucao de projetos em equipes tecnicas", "padronizacao de projetos em equipes tecnicas", "Educacional"],
  ["gestao-projetos", "Checklist para implantar uma rotina de gestao de projetos na empresa", "checklist gestao de projetos", "Checklist"],
  ["implantacao-erp", "Como controlar projetos de implantacao ERP com mais previsibilidade", "controle de projetos de implantacao ERP", "Educacional"],
  ["implantacao-erp", "Cronograma de implantacao ERP: etapas, riscos e boas praticas", "cronograma de implantacao ERP", "Educacional"],
  ["implantacao-erp", "Como acompanhar consultores em projetos de ERP sem depender de planilhas", "acompanhar consultores ERP", "Educacional"],
  ["implantacao-erp", "Status report para implantacao ERP: o que incluir no relatorio", "status report implantacao ERP", "Educacional"],
  ["implantacao-erp", "Como reduzir atrasos em projetos de implantacao de sistemas", "reduzir atrasos em implantacao de sistemas", "Educacional"],
  ["implantacao-erp", "Gestao de horas em consultorias ERP: como medir execucao e custo", "gestao de horas consultoria ERP", "Educacional"],
  ["implantacao-erp", "Como organizar fases de implantacao ERP no Kanban e no Gantt", "fases de implantacao ERP Kanban Gantt", "Educacional"],
  ["ordem-servico", "Como controlar ordens de servico em empresas de servicos tecnicos", "controle de ordens de servico", "Educacional"],
  ["ordem-servico", "OS integrada ao projeto: por que isso melhora a rastreabilidade", "OS integrada ao projeto", "Educacional"],
  ["ordem-servico", "Fluxo de aprovacao de OS: como evitar retrabalho e divergencias", "fluxo de aprovacao de OS", "Educacional"],
  ["ordem-servico", "Como ligar ordem de servico, timesheet e despesas no mesmo processo", "ordem de servico timesheet despesas", "Educacional"],
  ["ordem-servico", "O que analisar antes de aprovar uma ordem de servico tecnica", "aprovar ordem de servico tecnica", "Checklist"],
  ["ordem-servico", "Como manter historico de servicos por cliente e projeto", "historico de servicos por cliente", "Educacional"],
  ["ordem-servico", "Erros comuns no controle de OS e como corrigi-los", "erros no controle de OS", "Educacional"],
  ["produtividade", "Como medir produtividade da equipe tecnica sem criar burocracia", "medir produtividade equipe tecnica", "Educacional"],
  ["produtividade", "Controle de horas por projeto: boas praticas para gestores", "controle de horas por projeto", "Educacional"],
  ["produtividade", "Como planejar a agenda de recursos em projetos de servicos", "agenda de recursos em projetos", "Educacional"],
  ["produtividade", "Skills, alocacao e valor hora: como gerir recursos tecnicos", "gestao de recursos tecnicos", "Educacional"],
  ["produtividade", "Feedback de equipe tecnica: como registrar e acompanhar evolucao", "feedback equipe tecnica", "Educacional"],
  ["produtividade", "Como identificar sobrecarga de equipe usando horas e agenda", "sobrecarga de equipe tecnica", "Educacional"],
  ["produtividade", "Produtividade em consultorias: indicadores para acompanhar mensalmente", "produtividade em consultorias", "Educacional"],
  ["gestao-operacional", "Gestao operacional: o que e e como aplicar em empresas B2B", "gestao operacional B2B", "Educacional"],
  ["gestao-operacional", "Como centralizar clientes, projetos, OS e equipes em uma plataforma", "centralizar clientes projetos OS equipes", "Educacional"],
  ["gestao-operacional", "Controle operacional para empresas de servicos: guia pratico", "controle operacional empresas de servicos", "Guia"],
  ["gestao-operacional", "Como reduzir controles paralelos na operacao de servicos", "reduzir controles paralelos", "Educacional"],
  ["gestao-operacional", "Gestao de prestacao de servicos: processos que precisam estar integrados", "gestao de prestacao de servicos", "Educacional"],
  ["gestao-operacional", "Como criar uma rotina operacional para gestores, coordenadores e tecnicos", "rotina operacional gestores coordenadores tecnicos", "Educacional"],
  ["gestao-operacional", "Sinais de que sua empresa precisa de uma plataforma de gestao operacional", "plataforma de gestao operacional", "Educacional"],
  ["financeiro-projetos", "Como controlar custos de projetos com horas, despesas e recursos", "controle de custos de projetos", "Educacional"],
  ["financeiro-projetos", "Margem de projeto: como acompanhar antes do fechamento", "margem de projeto", "Educacional"],
  ["financeiro-projetos", "Controle de despesas em projetos: como evitar perda de informacao", "controle de despesas em projetos", "Educacional"],
  ["financeiro-projetos", "Valor hora de recursos: como usar na gestao financeira de projetos", "valor hora de recursos", "Educacional"],
  ["financeiro-projetos", "Como transformar timesheet em visao financeira de projetos", "timesheet visao financeira projetos", "Educacional"],
  ["financeiro-projetos", "Relatorio financeiro de projetos: indicadores que importam", "relatorio financeiro de projetos", "Educacional"],
  ["financeiro-projetos", "Como melhorar previsibilidade financeira em empresas de servicos", "previsibilidade financeira empresas de servicos", "Educacional"],
  ["pmo-dashboards", "Status report de projetos: modelo, indicadores e boas praticas", "status report de projetos", "Educacional"],
  ["pmo-dashboards", "Dashboard de projetos: quais indicadores acompanhar no dia a dia", "dashboard de projetos", "Educacional"],
  ["pmo-dashboards", "Como montar um relatorio executivo de projetos sem retrabalho", "relatorio executivo de projetos", "Educacional"],
  ["pmo-dashboards", "Software para PMO: recursos essenciais para governanca de projetos", "software para PMO", "Comparacao comercial"],
  ["pmo-dashboards", "Como acompanhar riscos, prazos e custos em multiplos projetos", "acompanhar riscos prazos custos projetos", "Educacional"],
  ["pmo-dashboards", "Status report para cliente: como comunicar progresso com clareza", "status report para cliente", "Educacional"],
  ["pmo-dashboards", "Como usar dashboards para melhorar a tomada de decisao operacional", "dashboards tomada de decisao operacional", "Educacional"],
  ["pmo-dashboards", "PMO em empresas de servicos: como conectar estrategia e execucao", "PMO em empresas de servicos", "Educacional"]
];

const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
const landingBySlug = new Map(landingPages.map((p) => [p.slug, p]));

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonLd(data) {
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n  </script>`;
}

function head(meta) {
  const keywords = meta.keywords || [];
  const title = meta.title;
  const description = meta.description;
  const url = `${site}${meta.path}`;
  const image = `${site}/${meta.image || "dashboard.png"}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="author" content="FlowProject" />
  <meta name="theme-color" content="#f49e47" />
  <meta name="keywords" content="${esc(keywords.join(", "))}" />
  <link rel="canonical" href="${url}" />
  <link href="/logof.png" rel="icon" type="image/png" />
  <link rel="preload" as="image" href="/${esc(meta.image || "dashboard.png")}" />
  <link href="/venda.css?v=1778794300" rel="stylesheet" />
  <link href="/seo.css?v=20260520" rel="stylesheet" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content="FlowProject" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:alt" content="${esc(meta.imageAlt || "FlowProject")}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${image}" />
`;
}

function topbar(active = "") {
  const mainLinks = [
    ["/software-gestao-projetos", "Projetos"],
    ["/gestao-operacional", "Operacao"],
    ["/software-ordem-servico", "OS"],
    ["/controle-horas-projetos", "Horas"],
    ["/gestao-consultorias", "Consultorias"],
    ["/blog", "Blog"]
  ];
  return `<header class="sales-topbar">
      <div class="sales-shell sales-topbar-inner">
        <a class="sales-logo" href="/venda" aria-label="FlowProject">
          <img src="/logof.png" alt="Logo FlowProject" />
          <span>FlowProject</span>
        </a>
        <nav class="sales-nav" aria-label="Navegacao principal">
          ${mainLinks.map(([href, label]) => `<a href="${href}"${active === href ? ' aria-current="page"' : ""}>${label}</a>`).join("\n          ")}
        </nav>
        <div class="sales-actions">
          <a class="sales-btn secondary" href="${whatsapp}" target="_blank" rel="noopener">Demonstracao</a>
          <a class="sales-btn orange" href="/">Entrar</a>
        </div>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="sales-footer seo-footer">
      <div class="sales-shell sales-footer-inner">
        <span>FlowProject - Gestao operacional, projetos, equipes e servicos.</span>
        <nav aria-label="Links institucionais">
          <a href="/privacidade">Politica de Privacidade</a>
          <a href="/termos">Termos de Uso</a>
          <a href="mailto:${supportEmail}">Contato: ${supportEmail}</a>
          <a href="/lgpd">LGPD</a>
          <a href="/dpa">DPA</a>
        </nav>
      </div>
    </footer>`;
}

function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "FlowProject",
    url: site,
    logo: `${site}/logof.png`,
    email: supportEmail,
    contactPoint: [{
      "@type": "ContactPoint",
      contactType: "sales",
      email: supportEmail,
      availableLanguage: "Portuguese"
    }]
  };
}

function softwareSchema(page) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FlowProject",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${site}/${page.slug}`,
    image: `${site}/${page.image}`,
    description: page.description,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: "147.90",
      category: "monthly",
      availability: "https://schema.org/InStock"
    },
    featureList: [
      "Gestao de projetos",
      "Ordens de servico",
      "Timesheet e controle de horas",
      "Gestao de equipes tecnicas",
      "Controle financeiro de projetos",
      "Dashboards operacionais",
      "Status reports automaticos"
    ]
  };
}

function breadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${site}${item.path}`
    }))
  };
}

function faqSchema(faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer
      }
    }))
  };
}

function landingHtml(page) {
  const keywordLinks = page.related.map((slug) => landingBySlug.get(slug)).filter(Boolean);
  const schemas = [
    organizationSchema(),
    softwareSchema(page),
    breadcrumbSchema([
      { name: "Inicio", path: "/" },
      { name: page.h1, path: `/${page.slug}` }
    ]),
    faqSchema(page.faq),
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.h1,
      url: `${site}/${page.slug}`,
      inLanguage: "pt-BR",
      description: page.description,
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: `${site}/${page.image}`
      }
    }
  ];
  return `${head({
    title: page.title,
    description: page.description,
    path: `/${page.slug}`,
    image: page.image,
    imageAlt: page.imageAlt,
    keywords: [page.keyword, "FlowProject", "gestao operacional", "software B2B", "controle de projetos", "ordem de servico", "controle de horas"]
  })}
  ${schemas.map(jsonLd).join("\n  ")}
</head>
<body>
  <div class="sales-page seo-page">
    ${topbar(`/${page.slug}`)}
    <main>
      <section class="hero seo-hero">
        <div class="sales-shell hero-grid">
          <div>
            <span class="eyebrow">${esc(page.eyebrow)}</span>
            <h1>${esc(page.h1)}</h1>
            <p class="hero-lead">${esc(page.lead)}</p>
            <div class="hero-ctas">
              <a class="sales-btn primary" href="${whatsapp}" target="_blank" rel="noopener">Agendar demonstracao</a>
              <a class="sales-btn secondary" href="/venda#planos">Ver planos</a>
            </div>
            <div class="hero-proof" aria-label="Diferenciais do FlowProject">
              <div class="proof-item"><strong>OS</strong><span>integrada</span></div>
              <div class="proof-item"><strong>Horas</strong><span>timesheet</span></div>
              <div class="proof-item"><strong>ROI</strong><span>custos e margem</span></div>
            </div>
          </div>
          <div class="hero-product">
            <div class="product-frame">
              <img src="/${esc(page.image)}" alt="${esc(page.imageAlt)}" decoding="async" fetchpriority="high" />
            </div>
            <div class="floating-panel">
              <span>Controle operacional B2B</span>
              <strong>Projetos, equipes, horas, OS, custos e clientes no mesmo fluxo.</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sales-shell seo-intent-grid">
          <article class="seo-intent-card">
            <span class="eyebrow">Intencao de busca</span>
            <h2>Para quem esta procurando ${esc(page.keyword)}</h2>
            <p>${esc(page.intent)} O diferencial do FlowProject e tratar projeto como parte da operacao: tarefas, equipe tecnica, horas, OS, despesas, financeiro e comunicacao caminham juntos.</p>
          </article>
          <aside class="seo-side-list" aria-label="Recursos relacionados">
            ${page.benefits.map((benefit) => `<div><strong>${esc(benefit)}</strong><span>Recurso orientado a controle, produtividade e decisao operacional.</span></div>`).join("\n            ")}
          </aside>
        </div>
      </section>

      <section class="section soft">
        <div class="sales-shell">
          <div class="section-head center">
            <h2>Como o FlowProject melhora essa rotina</h2>
            <p>Uma plataforma SaaS B2B para empresas que precisam gerenciar execucao tecnica, prazos, custos, clientes e produtividade com menos retrabalho.</p>
          </div>
          <div class="benefits-grid">
            ${page.sections.map(([title, text], index) => `<article class="benefit-card">
              <div class="benefit-icon">${String(index + 1).padStart(2, "0")}</div>
              <h3>${esc(title)}</h3>
              <p>${esc(text)}</p>
            </article>`).join("\n            ")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sales-shell feature-shot seo-proof-shot">
          <div class="feature-shot-copy">
            <span class="eyebrow">Prova operacional</span>
            <h2>Feito para quem precisa enxergar prazo, custo, execucao e cliente</h2>
            <p>O Project Flow nao e apenas mais uma lista de tarefas. A plataforma foi pensada para empresas que precisam controlar operacao real: recursos, agenda, horas, ordens de servico, despesas, margem, historico e status report.</p>
            <div class="status-report-grid">
              <article><strong>Gestores</strong><span>Visao de prioridades, atrasos, aprovacoes e produtividade.</span></article>
              <article><strong>Executivos</strong><span>Resumo de saude, custo, margem e andamento dos projetos.</span></article>
              <article><strong>Clientes</strong><span>Comunicacao clara com entregas, pendencias e proximos passos.</span></article>
            </div>
          </div>
          <figure class="product-screenshot">
            <img src="/${esc(page.image)}" alt="${esc(page.imageAlt)}" loading="lazy" decoding="async" />
          </figure>
        </div>
      </section>

      <section class="section soft">
        <div class="sales-shell">
          <div class="section-head center">
            <h2>Perguntas frequentes</h2>
            <p>Respostas rapidas para avaliar o FlowProject em uma operacao B2B.</p>
          </div>
          <div class="faq-grid">
            ${page.faq.map(([q, a]) => `<article class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></article>`).join("\n            ")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sales-shell seo-link-grid">
          <div class="section-head">
            <h2>Continue avaliando o FlowProject</h2>
            <p>Veja paginas relacionadas para entender como a plataforma conecta gestao de projetos, operacao, equipes e financeiro.</p>
          </div>
          <div class="use-cases">
            ${keywordLinks.map((item) => `<article class="use-case"><strong><a href="/${item.slug}">${esc(item.h1)}</a></strong><span>${esc(item.description)}</span></article>`).join("\n            ")}
          </div>
        </div>
      </section>

      <section class="sales-shell final-cta">
        <h2>Quer ver o FlowProject aplicado na sua operacao?</h2>
        <p>Fale com um consultor e veja como controlar projetos, OS, horas, equipe, custos e status reports em uma plataforma unica.</p>
        <div class="hero-ctas">
          <a class="sales-btn orange" href="${whatsapp}" target="_blank" rel="noopener">Falar pelo WhatsApp</a>
          <a class="sales-btn secondary" href="/blog">Ver conteudos do blog</a>
        </div>
      </section>
    </main>
    ${footer()}
  </div>
</body>
</html>
`;
}

const articles = articleSeeds.map(([category, title, keyword, intent], index) => {
  const slug = slugify(title);
  const categoryData = categoryBySlug.get(category);
  const relatedLanding = landingPages[index % landingPages.length];
  return {
    category,
    categoryName: categoryData.name,
    title,
    slug,
    keyword,
    intent,
    description: `${title}. Veja conceitos, sinais de maturidade, indicadores e como o FlowProject ajuda empresas B2B a transformar operacao em controle.`,
    cta: `Veja como o FlowProject ajuda em ${relatedLanding.keyword}`,
    landing: relatedLanding.slug,
    outline: [
      `O que significa ${keyword} na rotina operacional`,
      "Principais problemas quando o controle fica em planilhas",
      "Indicadores e processos que precisam estar integrados",
      "Como padronizar a rotina com projetos, equipe, horas e OS",
      "Como o FlowProject apoia essa evolucao"
    ],
    keywords: [keyword, categoryData.name.toLowerCase(), "gestao operacional", "software B2B", "controle de projetos"]
  };
});

function articleCard(article) {
  return `<article class="seo-card">
            <span>${esc(article.categoryName)}</span>
            <h2><a href="/blog/${article.slug}">${esc(article.title)}</a></h2>
            <p>${esc(article.description)}</p>
            <a class="seo-text-link" href="/blog/${article.slug}">Ler artigo</a>
          </article>`;
}

function blogIndexHtml() {
  const schemas = [
    organizationSchema(),
    breadcrumbSchema([{ name: "Inicio", path: "/" }, { name: "Blog", path: "/blog" }]),
    {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: "Blog FlowProject",
      url: `${site}/blog`,
      inLanguage: "pt-BR",
      description: "Conteudos sobre gestao operacional, projetos, OS, horas, produtividade, consultorias, ERP, PMO e dashboards."
    }
  ];
  return `${head({
    title: "Blog FlowProject | Gestao Operacional, Projetos, OS e Produtividade",
    description: "Conteudos estrategicos sobre gestao operacional, projetos, implantacao ERP, ordens de servico, produtividade, PMO, dashboards e controle financeiro.",
    path: "/blog",
    image: "dashboard.png",
    imageAlt: "Dashboard do FlowProject",
    keywords: ["blog gestao operacional", "gestao de projetos", "controle de horas", "ordem de servico", "PMO", "implantacao ERP"]
  })}
  ${schemas.map(jsonLd).join("\n  ")}
</head>
<body>
  <div class="sales-page seo-page">
    ${topbar("/blog")}
    <main>
      <section class="hero seo-hero compact">
        <div class="sales-shell">
          <span class="eyebrow">Blog SEO B2B</span>
          <h1>Guias para controlar projetos, equipes, OS, horas e operacoes B2B</h1>
          <p class="hero-lead">Conteudos para gestores operacionais, PMOs, consultorias, equipes tecnicas, software houses e empresas de servicos que querem trocar controles paralelos por uma operacao mais previsivel.</p>
          <div class="hero-ctas">
            <a class="sales-btn primary" href="${whatsapp}" target="_blank" rel="noopener">Falar com consultor</a>
            <a class="sales-btn secondary" href="/gestao-operacional">Ver gestao operacional</a>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sales-shell">
          <div class="section-head center">
            <h2>Categorias</h2>
            <p>Clusters editoriais criados para construir autoridade em gestao operacional e SaaS B2B.</p>
          </div>
          <div class="seo-category-grid">
            ${categories.map((cat) => `<a class="seo-category" href="/blog/${cat.slug}">
              <strong>${esc(cat.name)}</strong>
              <span>${esc(cat.description)}</span>
            </a>`).join("\n            ")}
          </div>
        </div>
      </section>

      <section class="section soft">
        <div class="sales-shell">
          <div class="section-head">
            <h2>50 pautas estrategicas para gerar leads organicos</h2>
            <p>Cada artigo ja nasce com slug, palavra-chave, intencao de busca, CTA e linkagem interna.</p>
          </div>
          <div class="seo-article-grid">
            ${articles.map(articleCard).join("\n            ")}
          </div>
        </div>
      </section>
    </main>
    ${footer()}
  </div>
</body>
</html>
`;
}

function categoryHtml(category) {
  const list = articles.filter((article) => article.category === category.slug);
  const schemas = [
    organizationSchema(),
    breadcrumbSchema([
      { name: "Inicio", path: "/" },
      { name: "Blog", path: "/blog" },
      { name: category.name, path: `/blog/${category.slug}` }
    ])
  ];
  return `${head({
    title: `${category.name} | Blog FlowProject`,
    description: `${category.description} Artigos com foco em SEO, leads organicos e gestao operacional B2B.`,
    path: `/blog/${category.slug}`,
    image: "dashboard.png",
    imageAlt: "Dashboard do FlowProject",
    keywords: [category.name, "FlowProject", "gestao operacional", "SaaS B2B"]
  })}
  ${schemas.map(jsonLd).join("\n  ")}
</head>
<body>
  <div class="sales-page seo-page">
    ${topbar("/blog")}
    <main>
      <section class="hero seo-hero compact">
        <div class="sales-shell">
          <span class="eyebrow">Categoria</span>
          <h1>${esc(category.name)}</h1>
          <p class="hero-lead">${esc(category.description)} Conteudos planejados para educar compradores B2B e conectar a dor ao uso pratico do FlowProject.</p>
        </div>
      </section>
      <section class="section">
        <div class="sales-shell seo-article-grid">
          ${list.map(articleCard).join("\n          ")}
        </div>
      </section>
    </main>
    ${footer()}
  </div>
</body>
</html>
`;
}

function articleHtml(article) {
  const category = categoryBySlug.get(article.category);
  const landing = landingBySlug.get(article.landing);
  const related = articles
    .filter((item) => item.category === article.category && item.slug !== article.slug)
    .slice(0, 3);
  const schemas = [
    organizationSchema(),
    breadcrumbSchema([
      { name: "Inicio", path: "/" },
      { name: "Blog", path: "/blog" },
      { name: category.name, path: `/blog/${category.slug}` },
      { name: article.title, path: `/blog/${article.slug}` }
    ]),
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      author: { "@type": "Organization", name: "FlowProject" },
      publisher: { "@type": "Organization", name: "FlowProject", logo: { "@type": "ImageObject", url: `${site}/logof.png` } },
      datePublished: today,
      dateModified: today,
      mainEntityOfPage: `${site}/blog/${article.slug}`,
      image: `${site}/dashboard.png`,
      articleSection: category.name,
      keywords: article.keywords.join(", ")
    }
  ];
  return `${head({
    title: `${article.title} | FlowProject`,
    description: article.description,
    path: `/blog/${article.slug}`,
    image: "dashboard.png",
    imageAlt: "Dashboard do FlowProject",
    keywords: article.keywords
  })}
  ${schemas.map(jsonLd).join("\n  ")}
</head>
<body>
  <div class="sales-page seo-page">
    ${topbar("/blog")}
    <main>
      <article>
        <section class="hero seo-hero compact">
          <div class="sales-shell">
            <span class="eyebrow">${esc(category.name)}</span>
            <h1>${esc(article.title)}</h1>
            <p class="hero-lead">${esc(article.description)}</p>
            <div class="seo-meta-row">
              <span>Palavra-chave: ${esc(article.keyword)}</span>
              <span>Intencao: ${esc(article.intent)}</span>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="sales-shell seo-article-layout">
            <div class="seo-article-body">
              <h2>Resumo estrategico</h2>
              <p>Este artigo foi planejado para atrair compradores B2B que pesquisam por ${esc(article.keyword)} e precisam transformar controle operacional em rotina pratica. O foco editorial e mostrar problemas reais, criterios de avaliacao e caminhos para integrar projetos, equipe, horas, OS, despesas e relatorios.</p>
              <h2>Pontos principais</h2>
              ${article.outline.map((item, index) => `<section class="seo-outline-block">
                <h3>${index + 1}. ${esc(item)}</h3>
                <p>Explique o conceito com exemplos de empresas de servicos, consultorias, equipes tecnicas e PMOs. Inclua sinais de maturidade, erros comuns, indicadores e como uma plataforma operacional reduz controles paralelos.</p>
              </section>`).join("\n              ")}
              <h2>Palavras-chave relacionadas</h2>
              <ul class="seo-keyword-list">
                ${article.keywords.map((keyword) => `<li>${esc(keyword)}</li>`).join("\n                ")}
              </ul>
              <h2>Interlinking sugerido</h2>
              <p>Linkar para <a href="/${landing.slug}">${esc(landing.h1)}</a>, para a categoria <a href="/blog/${category.slug}">${esc(category.name)}</a> e para artigos relacionados do mesmo cluster.</p>
            </div>
            <aside class="seo-article-aside">
              <div class="seo-sticky-box">
                <span class="eyebrow">CTA</span>
                <h2>${esc(article.cta)}</h2>
                <p>Veja como o FlowProject conecta projeto, equipe tecnica, horas, OS, despesas, dashboards e status reports em uma operacao B2B.</p>
                <a class="sales-btn orange" href="/${landing.slug}">Conhecer solucao</a>
              </div>
            </aside>
          </div>
        </section>
      </article>

      <section class="section soft">
        <div class="sales-shell">
          <div class="section-head">
            <h2>Artigos relacionados</h2>
            <p>Conteudos do mesmo cluster para fortalecer autoridade semantica.</p>
          </div>
          <div class="seo-article-grid">
            ${related.map(articleCard).join("\n            ")}
          </div>
        </div>
      </section>
    </main>
    ${footer()}
  </div>
</body>
</html>
`;
}

function seoCss() {
  return `.seo-page .sales-nav a[aria-current="page"]{color:var(--fp-indigo)}
.seo-page .product-frame img{height:auto;object-fit:contain}
.seo-page .hero-product{align-self:center}
.seo-hero.compact{padding:78px 0 68px}
.seo-hero.compact .sales-shell{max-width:980px}
.seo-hero.compact h1{margin:18px 0 16px;font-size:clamp(38px,5.4vw,68px);line-height:1}
.seo-intent-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;align-items:stretch}
.seo-intent-card,.seo-side-list div,.seo-card,.seo-category,.seo-sticky-box{border:1px solid var(--fp-line);background:#fff;border-radius:16px;box-shadow:0 14px 36px rgba(15,23,42,.07)}
.seo-intent-card{padding:30px}
.seo-intent-card h2{margin:16px 0 12px;font-size:34px;line-height:1.08}
.seo-intent-card p{color:#475569;line-height:1.7;font-size:17px}
.seo-side-list{display:grid;gap:12px}
.seo-side-list div{padding:18px}
.seo-side-list strong,.seo-side-list span{display:block}
.seo-side-list span{margin-top:6px;color:var(--fp-muted);line-height:1.55}
.seo-proof-shot{align-items:center}
.seo-link-grid .use-case a,.seo-card a{color:inherit;text-decoration:none}
.seo-category-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.seo-category{display:block;padding:22px;text-decoration:none}
.seo-category strong,.seo-category span{display:block}
.seo-category span{margin-top:8px;color:var(--fp-muted);line-height:1.55}
.seo-article-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.seo-card{padding:22px}
.seo-card span{display:inline-flex;margin-bottom:10px;color:#c2410c;background:#fff7ed;border:1px solid #fed7aa;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900;text-transform:uppercase}
.seo-card h2{font-size:22px;line-height:1.15;margin:0 0 10px}
.seo-card p{color:#475569;line-height:1.6;margin:0 0 16px}
.seo-text-link{font-weight:900;color:var(--fp-indigo)!important}
.seo-meta-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.seo-meta-row span{border:1px solid var(--fp-line);background:#fff;border-radius:999px;padding:8px 12px;color:#475569;font-weight:800;font-size:13px}
.seo-article-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:34px;align-items:start}
.seo-article-body{font-size:18px;line-height:1.75;color:#334155}
.seo-article-body h2{color:var(--fp-ink);font-size:34px;line-height:1.08;margin:0 0 14px}
.seo-outline-block{padding:20px 0;border-top:1px solid var(--fp-line)}
.seo-outline-block h3{margin:0 0 8px;color:var(--fp-ink)}
.seo-keyword-list{display:flex;flex-wrap:wrap;gap:10px;padding:0;margin:0;list-style:none}
.seo-keyword-list li{padding:8px 12px;border:1px solid var(--fp-line);border-radius:999px;background:#fff;font-weight:800;color:#475569;font-size:14px}
.seo-article-aside{position:relative}
.seo-sticky-box{position:sticky;top:96px;padding:22px}
.seo-sticky-box h2{font-size:24px;line-height:1.12;margin:14px 0 10px}
.seo-sticky-box p{color:#475569;line-height:1.6}
.seo-footer{margin-top:40px}
@media (max-width:1040px){
  .seo-intent-grid,.seo-article-layout{grid-template-columns:1fr}
  .seo-category-grid,.seo-article-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:760px){
  .seo-category-grid,.seo-article-grid{grid-template-columns:1fr}
  .seo-hero.compact{padding:54px 0}
  .seo-intent-card h2,.seo-article-body h2{font-size:28px}
}
`;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function sitemapXml() {
  const urls = [
    { loc: "/venda", priority: "1.0", changefreq: "weekly" },
    ...landingPages.map((page) => ({ loc: `/${page.slug}`, priority: "0.9", changefreq: "weekly" })),
    { loc: "/blog", priority: "0.8", changefreq: "weekly" },
    ...categories.map((category) => ({ loc: `/blog/${category.slug}`, priority: "0.7", changefreq: "weekly" })),
    ...articles.map((article) => ({ loc: `/blog/${article.slug}`, priority: "0.6", changefreq: "monthly" })),
    { loc: "/privacidade", priority: "0.6", changefreq: "monthly" },
    { loc: "/termos", priority: "0.6", changefreq: "monthly" },
    { loc: "/lgpd", priority: "0.7", changefreq: "monthly" },
    { loc: "/dpa", priority: "0.6", changefreq: "monthly" }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((url) => `  <url>
    <loc>${site}${url.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>${url.loc === "/venda" ? `
    <image:image>
      <image:loc>${site}/dashboard.png</image:loc>
      <image:title>Dashboard de projetos do FlowProject</image:title>
      <image:caption>Painel de projetos com agenda, OS para aprovar e mural de lembretes.</image:caption>
    </image:image>
    <image:image>
      <image:loc>${site}/kanban.png</image:loc>
      <image:title>Kanban de projetos do FlowProject</image:title>
      <image:caption>Visao Kanban para acompanhar status, prioridades, horas e custos dos projetos.</image:caption>
    </image:image>` : ""}
  </url>`).join("\n")}
</urlset>
`;
}

function main() {
  write(path.join(publicDir, "seo.css"), seoCss());
  landingPages.forEach((page) => write(path.join(publicDir, `${page.slug}.html`), landingHtml(page)));
  write(path.join(blogDir, "index.html"), blogIndexHtml());
  categories.forEach((category) => write(path.join(blogDir, `${category.slug}.html`), categoryHtml(category)));
  articles.forEach((article) => write(path.join(blogDir, `${article.slug}.html`), articleHtml(article)));
  write(path.join(publicDir, "sitemap.xml"), sitemapXml());
  console.log(`Generated ${landingPages.length} landing pages, ${categories.length} categories and ${articles.length} article pages.`);
}

main();
