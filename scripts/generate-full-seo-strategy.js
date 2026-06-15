const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const blogDir = path.join(publicDir, "blog");
const site = "https://portalprojectflow.com";
const today = "2026-06-11";
const supportEmail = "suporte@portalprojectflow.com";
const whatsapp = "https://wa.me/5511943362288?text=Ol%C3%A1%2C%20quero%20solicitar%20uma%20demonstra%C3%A7%C3%A3o%20do%20FlowProject";

const corePages = [
  page("dashboard-projetos", "dashboard de projetos", "Dashboard de Projetos para Gestores | FlowProject", "Dashboard de projetos com horas, prazos, equipes, status report, custos e KPIs para controlar a operação em tempo real.", "Dashboard de projetos para controlar operação, prazos e KPIs", "Dashboard em tempo real", "dashboard.png", "Dashboard do FlowProject com agenda, projetos, OS e lembretes", ["gestao-operacional", "controle-horas-projetos", "pmo", "indicadores-status-report"]),
  page("gestao-operacional", "gestão operacional", "Gestão Operacional para Serviços B2B | FlowProject", "Gestão operacional com projetos, horas, equipes, clientes, OS, indicadores e status report em uma plataforma SaaS.", "Gestão operacional para empresas de serviços e consultorias", "Operação integrada", "OPERACAO.PNG", "Tela de gestão operacional do FlowProject", ["dashboard-projetos", "gestao-consultoria", "controle-horas-projetos", "pmo"]),
  page("controle-horas-projetos", "controle de horas projetos", "Controle de Horas em Projetos | FlowProject", "Controle de horas projetos com timesheet, apontamentos, aprovações, custos, produtividade e indicadores por cliente.", "Controle de horas em projetos com timesheet e custo real", "Controle de horas", "kanban.png", "Kanban com projetos, horas e status no FlowProject", ["apontamento-horas", "gestao-recursos-projetos", "dashboard-projetos", "gestao-consultoria"]),
  page("gestao-consultoria", "gestão de consultoria", "Gestão de Consultoria com Horas e Projetos | FlowProject", "Gestão de consultoria com projetos, clientes, consultores, horas, OS, implantação ERP, custos e status reports.", "Gestão de consultoria com controle de projetos, horas e clientes", "Consultorias B2B", "recursos.png", "Gestão de consultores e recursos no FlowProject", ["implantacao-erp", "controle-horas-projetos", "status-report-consultoria", "gestao-operacional"]),
  page("implantacao-erp", "implantação ERP", "Implantação ERP com Cronograma e Status | FlowProject", "Implantação ERP com Kanban, Gantt, consultores, horas, riscos, custos, clientes e status report automático.", "Implantação ERP com cronograma, consultores e status report", "Projetos ERP", "kanban.png", "Kanban para implantação ERP no FlowProject", ["status-report-implantacao-erp", "gestao-consultoria", "controle-horas-projetos", "pmo"]),
  page("pmo", "PMO", "PMO com Indicadores e Status Report | FlowProject", "PMO com governança de projetos, indicadores, dashboard, status report executivo, horas, recursos, custos e riscos.", "PMO com governança, indicadores e status report executivo", "PMO e governança", "workspace.png", "Workspace de projeto para PMO no FlowProject", ["dashboard-projetos", "indicadores-status-report", "status-report-executivo", "gestao-recursos-projetos"]),
  page("apontamento-horas", "apontamento de horas", "Apontamento de Horas por Projeto | FlowProject", "Apontamento de horas por projeto, tarefa, cliente e consultor com aprovação, histórico, custos e produtividade.", "Apontamento de horas por projeto com aprovação e histórico", "Timesheet operacional", "workspace.png", "Workspace com tarefas e apontamento de horas", ["controle-horas-projetos", "gestao-recursos-projetos", "dashboard-projetos", "status-report-semanal"]),
  page("gestao-recursos-projetos", "gestão de recursos", "Gestão de Recursos em Projetos | FlowProject", "Gestão de recursos em projetos com alocação, agenda, skills, valor hora, produtividade, disponibilidade e custos.", "Gestão de recursos em projetos com agenda, skills e custos", "Recursos e alocação", "recursos.png", "Tela de recursos com skills, agenda e valor hora", ["controle-horas-projetos", "apontamento-horas", "pmo", "dashboard-projetos"]),
  page("indicadores-projetos", "indicadores de projetos", "Indicadores de Projetos e KPIs | FlowProject", "Indicadores de projetos para acompanhar prazo, horas, custos, margem, produtividade, riscos e status executivo.", "Indicadores de projetos para decisões operacionais e executivas", "KPIs de projetos", "relatorio.png", "Relatórios e indicadores de projetos no FlowProject", ["dashboard-projetos", "pmo", "indicadores-status-report", "status-report-executivo"])
];

const statusPages = [
  ["o-que-e-status-report", "o que é status report", "O que é Status Report de Projetos | FlowProject", "Entenda o que é status report, quando usar, quais indicadores incluir e como automatizar relatórios de projetos.", "O que é status report e como usar na gestão de projetos"],
  ["modelo-status-report", "modelo status report", "Modelo de Status Report para Projetos | FlowProject", "Modelo de status report com estrutura, KPIs, riscos, próximos passos, exemplos e automação para projetos.", "Modelo de status report para projetos, PMO e consultorias"],
  ["exemplo-status-report", "exemplo status report", "Exemplo de Status Report de Projetos | FlowProject", "Exemplo de status report com indicadores, riscos, prazo, horas, custos, comunicação executiva e cliente.", "Exemplo de status report para comunicar progresso com clareza"],
  ["status-report-semanal", "status report semanal", "Status Report Semanal de Projetos | FlowProject", "Status report semanal para acompanhar entregas, horas, riscos, pendências, próximos passos e decisões do projeto.", "Status report semanal para cadência de execução"],
  ["status-report-mensal", "status report mensal", "Status Report Mensal Executivo | FlowProject", "Status report mensal para consolidar indicadores, custos, horas, riscos, decisões, carteira e evolução dos projetos.", "Status report mensal para diretoria, PMO e clientes"],
  ["status-report-executivo", "status report executivo", "Status Report Executivo de Projetos | FlowProject", "Status report executivo com visão de prazo, custo, risco, margem, horas, decisões e portfólio de projetos.", "Status report executivo para decisões rápidas"],
  ["status-report-implantacao-erp", "status report implantação ERP", "Status Report para Implantação ERP | FlowProject", "Status report para implantação ERP com fases, consultores, riscos, horas, pendências, cronograma e cliente.", "Status report para implantação ERP com fases e riscos"],
  ["status-report-consultoria", "status report consultoria", "Status Report para Consultoria | FlowProject", "Status report para consultoria com entregas, horas, clientes, consultores, custos, riscos e próximos passos.", "Status report para consultoria, clientes e gestores"],
  ["status-report-excel", "status report excel", "Status Report Excel vs Plataforma | FlowProject", "Compare status report em Excel com plataforma SaaS, automação, indicadores, histórico, colaboração e governança.", "Status report em Excel: limites, riscos e alternativa SaaS"],
  ["status-report-power-bi", "status report Power BI", "Status Report Power BI e Projetos | FlowProject", "Status report Power BI para projetos: veja quando usar BI, dashboard operacional e automação de dados.", "Status report Power BI integrado à gestão operacional"],
  ["indicadores-status-report", "indicadores status report", "Indicadores para Status Report | FlowProject", "Indicadores para status report: prazo, horas, custo, margem, riscos, produtividade, entregas e saúde do projeto.", "Indicadores para status report de projetos e PMO"]
].map(([slug, keyword, title, description, h1]) => ({
  slug, keyword, title, description, h1,
  eyebrow: "Cluster status report",
  image: "workspace.png",
  imageAlt: "Workspace do FlowProject com status reports de projeto",
  related: ["status-report-semanal", "status-report-executivo", "dashboard-projetos", "pmo"].filter((item) => item !== slug),
  faq: faqFor(keyword)
}));

const allLandingPages = [...corePages, ...statusPages];
const bySlug = new Map(allLandingPages.map((item) => [item.slug, item]));

const blogSeeds = [
  ["gestao-projetos", "Como escolher um software de gestão de projetos para empresas de serviços", "software de gestão de projetos para empresas de serviços"],
  ["gestao-projetos", "Gestão de projetos operacionais: como sair das planilhas sem perder controle", "gestão de projetos operacionais"],
  ["gestao-projetos", "Kanban e Gantt juntos: quando usar cada visão na gestão de projetos", "kanban e gantt na gestão de projetos"],
  ["gestao-projetos", "Como organizar uma carteira de projetos com clientes, equipes e prazos", "carteira de projetos"],
  ["gestao-projetos", "Indicadores essenciais para acompanhar projetos de serviços B2B", "indicadores de projetos"],
  ["gestao-projetos", "Checklist para implantar uma rotina de gestão de projetos na empresa", "checklist gestão de projetos"],
  ["gestao-projetos", "Como reduzir atrasos em múltiplos projetos de clientes", "reduzir atrasos em projetos"],
  ["erp", "Como controlar projetos de implantação ERP com mais previsibilidade", "controle de implantação ERP"],
  ["erp", "Cronograma de implantação ERP: etapas, riscos e boas práticas", "cronograma de implantação ERP"],
  ["erp", "Como acompanhar consultores em projetos de ERP sem depender de planilhas", "consultores ERP"],
  ["erp", "Status report para implantação ERP: o que incluir no relatório", "status report implantação ERP"],
  ["erp", "Como reduzir atrasos em projetos de implantação de sistemas", "atrasos em implantação de sistemas"],
  ["erp", "Gestão de horas em consultorias ERP: como medir execução e custo", "gestão de horas consultoria ERP"],
  ["erp", "Como organizar fases de implantação ERP no Kanban e no Gantt", "fases de implantação ERP"],
  ["consultoria", "Gestão de consultoria: como controlar clientes, horas e rentabilidade", "gestão de consultoria"],
  ["consultoria", "Como acompanhar consultores externos sem perder rastreabilidade", "acompanhar consultores"],
  ["consultoria", "Como padronizar entregas em consultorias de TI", "padronizar entregas consultoria"],
  ["consultoria", "Como calcular produtividade em consultorias de projetos", "produtividade em consultorias"],
  ["consultoria", "Gestão de clientes em consultorias B2B: processos que precisam estar integrados", "gestão de clientes consultoria"],
  ["consultoria", "Como transformar horas apontadas em visão financeira na consultoria", "horas apontadas consultoria"],
  ["consultoria", "Como usar status report para melhorar relacionamento com clientes", "status report para cliente"],
  ["controle-horas", "Controle de horas por projeto: boas práticas para gestores", "controle de horas por projeto"],
  ["controle-horas", "Apontamento de horas: como implantar sem criar burocracia", "apontamento de horas"],
  ["controle-horas", "Timesheet em projetos: como transformar registro em decisão", "timesheet em projetos"],
  ["controle-horas", "Como aprovar apontamentos de horas com menos retrabalho", "aprovação de horas"],
  ["controle-horas", "Como identificar sobrecarga de equipe usando horas e agenda", "sobrecarga de equipe"],
  ["controle-horas", "Valor hora de recursos: como usar na gestão financeira de projetos", "valor hora de recursos"],
  ["controle-horas", "Erros comuns no controle de horas e como evitar", "erros no controle de horas"],
  ["status-report", "Status report de projetos: modelo, indicadores e boas práticas", "status report de projetos"],
  ["status-report", "Como montar um relatório executivo de projetos sem retrabalho", "relatório executivo de projetos"],
  ["status-report", "Status report semanal: cadência, indicadores e pauta de reunião", "status report semanal"],
  ["status-report", "Status report mensal: como consolidar carteira e decisões", "status report mensal"],
  ["status-report", "Status report para cliente: como comunicar progresso com clareza", "status report para cliente"],
  ["status-report", "Status report em Excel: quando funciona e quando vira risco", "status report Excel"],
  ["status-report", "Indicadores de status report que todo PMO precisa acompanhar", "indicadores status report"],
  ["pmo", "Software para PMO: recursos essenciais para governança de projetos", "software para PMO"],
  ["pmo", "PMO em empresas de serviços: como conectar estratégia e execução", "PMO em empresas de serviços"],
  ["pmo", "Como acompanhar riscos, prazos e custos em múltiplos projetos", "riscos prazos custos projetos"],
  ["pmo", "Como usar dashboards para melhorar a tomada de decisão operacional", "dashboards de projetos"],
  ["pmo", "Indicadores de projetos para diretoria: o que levar para a reunião", "indicadores de projetos para diretoria"],
  ["pmo", "Como criar governança de projetos sem travar a operação", "governança de projetos"],
  ["pmo", "Como um PMO pode reduzir controles paralelos", "controles paralelos PMO"],
  ["gestao-operacional", "Gestão operacional: o que é e como aplicar em empresas B2B", "gestão operacional B2B"],
  ["gestao-operacional", "Como centralizar clientes, projetos, OS e equipes em uma plataforma", "centralizar operação"],
  ["gestao-operacional", "Controle operacional para empresas de serviços: guia prático", "controle operacional"],
  ["gestao-operacional", "Como reduzir controles paralelos na operação de serviços", "controles paralelos"],
  ["gestao-operacional", "Gestão de prestação de serviços: processos que precisam estar integrados", "gestão de prestação de serviços"],
  ["gestao-operacional", "Como criar uma rotina operacional para gestores, coordenadores e técnicos", "rotina operacional"],
  ["gestao-operacional", "Sinais de que sua empresa precisa de uma plataforma de gestão operacional", "plataforma de gestão operacional"],
  ["gestao-operacional", "Como controlar custos de projetos com horas, despesas e recursos", "custos de projetos"]
];

const categories = {
  "gestao-projetos": "Gestão de Projetos",
  erp: "ERP",
  consultoria: "Consultoria",
  "controle-horas": "Controle de Horas",
  "status-report": "Status Report",
  pmo: "PMO",
  "gestao-operacional": "Gestão Operacional"
};

const articles = blogSeeds.map(([category, title, keyword], index) => {
  const landing = chooseLanding(category, index);
  return {
    category,
    categoryName: categories[category],
    title,
    slug: slugify(title),
    keyword,
    titleMeta: limit(`${title} | FlowProject`, 60),
    description: limit(`${title}. Guia prático com indicadores, processos, exemplos, links internos e CTA para demonstração do FlowProject.`, 155),
    landing
  };
});

function page(slug, keyword, title, description, h1, eyebrow, image, imageAlt, related) {
  return { slug, keyword, title, description, h1, eyebrow, image, imageAlt, related, faq: faqFor(keyword) };
}

function faqFor(keyword) {
  return [
    [`O FlowProject ajuda com ${keyword}?`, `Sim. O FlowProject centraliza projetos, horas, equipes, clientes, indicadores e status reports para transformar ${keyword} em uma rotina rastreável.`],
    ["É possível solicitar uma demonstração?", "Sim. A empresa pode solicitar uma demonstração para avaliar fluxos de projetos, consultorias, ERP, PMO, horas e dashboards."],
    ["O sistema substitui planilhas?", "Sim. A proposta é reduzir controles paralelos e manter histórico, aprovações, indicadores e comunicação em uma única plataforma."]
  ];
}

function chooseLanding(category, index) {
  const map = {
    "gestao-projetos": ["dashboard-projetos", "indicadores-projetos", "pmo"],
    erp: ["implantacao-erp", "status-report-implantacao-erp", "gestao-consultoria"],
    consultoria: ["gestao-consultoria", "controle-horas-projetos", "status-report-consultoria"],
    "controle-horas": ["controle-horas-projetos", "apontamento-horas", "gestao-recursos-projetos"],
    "status-report": ["o-que-e-status-report", "modelo-status-report", "indicadores-status-report"],
    pmo: ["pmo", "dashboard-projetos", "status-report-executivo"],
    "gestao-operacional": ["gestao-operacional", "dashboard-projetos", "controle-horas-projetos"]
  };
  return map[category][index % map[category].length];
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function limit(value, max) {
  return value.length <= max ? value : `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}`;
}

function jsonLd(data) {
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n  </script>`;
}

function head({ title, description, path: pagePath, image = "dashboard.png", imageAlt = "FlowProject", keywords = [] }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(limit(title, 60))}</title>
  <meta name="description" content="${esc(limit(description, 155))}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="author" content="FlowProject" />
  <meta name="theme-color" content="#f49e47" />
  <meta name="keywords" content="${esc(keywords.join(", "))}" />
  <link rel="canonical" href="${site}${pagePath}" />
  <link href="/logof.png" rel="icon" type="image/png" />
  <link href="/venda.css?v=1778794300" rel="stylesheet" />
  <link href="/seo.css?v=20260611" rel="stylesheet" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="pt_BR" />
  <meta property="og:site_name" content="FlowProject" />
  <meta property="og:title" content="${esc(limit(title, 60))}" />
  <meta property="og:description" content="${esc(limit(description, 155))}" />
  <meta property="og:url" content="${site}${pagePath}" />
  <meta property="og:image" content="${site}/${image}" />
  <meta property="og:image:alt" content="${esc(imageAlt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(limit(title, 60))}" />
  <meta name="twitter:description" content="${esc(limit(description, 155))}" />
  <meta name="twitter:image" content="${site}/${image}" />
`;
}

function topbar(active = "") {
  const links = [["/", "Home"], ["/dashboard-projetos", "Dashboard"], ["/gestao-operacional", "Operação"], ["/controle-horas-projetos", "Horas"], ["/gestao-consultoria", "Consultoria"], ["/implantacao-erp", "ERP"], ["/pmo", "PMO"], ["/blog", "Blog"]];
  return `<header class="sales-topbar">
    <div class="sales-shell sales-topbar-inner">
      <a class="sales-logo" href="/" aria-label="FlowProject"><img src="/logof.png" alt="Logo FlowProject" /><span>FlowProject</span></a>
      <nav class="sales-nav" aria-label="Navegação principal">${links.map(([href, label]) => `<a href="${href}"${active === href ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
      <div class="sales-actions"><a class="sales-btn secondary" href="/login">Entrar</a><a class="sales-btn orange" href="/venda">Solicitar Demonstração</a></div>
    </div>
  </header>`;
}

function footer() {
  return `<footer class="sales-footer seo-footer"><div class="sales-shell sales-footer-inner"><span>FlowProject - Software de gestão de projetos e operações.</span><nav aria-label="Links"><a href="/dashboard-projetos">Dashboard de projetos</a><a href="/gestao-operacional">Gestão operacional</a><a href="/controle-horas-projetos">Controle de horas</a><a href="/gestao-consultoria">Gestão de consultoria</a><a href="/venda">Demonstração</a><a href="/privacidade">Privacidade</a><a href="mailto:${supportEmail}">${supportEmail}</a></nav></div></footer>`;
}

function organizationSchema() {
  return { "@context": "https://schema.org", "@type": "Organization", name: "FlowProject", url: site, logo: `${site}/logof.png`, email: supportEmail, contactPoint: [{ "@type": "ContactPoint", contactType: "sales", email: supportEmail, availableLanguage: "pt-BR" }] };
}

function softwareSchema(pathname = "/") {
  return { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "FlowProject", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: `${site}${pathname}`, image: `${site}/dashboard.png`, description: "SaaS para gestão de projetos, gestão operacional, consultorias, implantação ERP, controle de horas, status reports e dashboards gerenciais.", featureList: ["Dashboard de projetos", "Gestão operacional", "Controle de horas", "Apontamento de horas", "Gestão de consultoria", "Implantação ERP", "PMO", "Status report automático", "Indicadores e KPIs"], offers: { "@type": "Offer", priceCurrency: "BRL", availability: "https://schema.org/InStock" } };
}

function breadcrumbSchema(items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: `${site}${item.path}` })) };
}

function faqSchema(faq) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) };
}

function proseBlocks(keyword, h1) {
  return [
    [`Por que ${keyword} precisa estar conectado à operação`, `${h1} não deve ser uma tela isolada nem um relatório montado apenas no fim do mês. Em empresas de serviços, consultorias, PMOs e times de implantação ERP, a informação nasce na execução: horas apontadas, tarefas concluídas, riscos percebidos pelo consultor, despesas aprovadas, mudança de escopo, agenda de recursos e decisões tomadas com o cliente. Quando esses dados ficam espalhados em planilhas, mensagens e apresentações, o gestor passa mais tempo reconciliando versões do que tomando decisões. O FlowProject foi desenhado para conectar a rotina operacional ao acompanhamento gerencial, criando uma base única para controle de prazo, custo, produtividade, qualidade e comunicação.`],
    ["Problemas comuns quando o controle fica em planilhas", `Planilhas são flexíveis, mas perdem força quando muitos projetos, clientes e recursos precisam colaborar. O mesmo campo pode ser preenchido de formas diferentes, fórmulas quebram, versões circulam por e-mail, aprovações ficam sem histórico e indicadores importantes chegam tarde. Em ${keyword}, isso costuma gerar reuniões longas, status subjetivo, atrasos identificados apenas no fechamento e dificuldade para explicar margem, horas consumidas ou pendências do cliente. A estratégia correta é manter a simplicidade operacional para a equipe e, ao mesmo tempo, estruturar os dados para o gestor.`],
    ["Como o FlowProject organiza a rotina", "A plataforma centraliza projetos, clientes, equipes, apontamentos, ordens de serviço, despesas, agendas, feedbacks, dashboards e status reports. O gestor acompanha a execução por projeto e por cliente, enquanto o PMO ou diretoria consegue enxergar carteira, riscos, gargalos e indicadores. O resultado é uma operação mais previsível: menos conferência manual, menos retrabalho, mais histórico e maior clareza para conversar com clientes e lideranças."],
    ["Indicadores que merecem atenção", "Os indicadores mais úteis combinam prazo, esforço e impacto financeiro. Horas planejadas versus horas realizadas mostram consumo de capacidade. Status por fase revela gargalos. Pendências e riscos indicam onde uma decisão precisa acontecer. Custos, despesas e valor hora ajudam a analisar margem. Produtividade por recurso orienta alocação. Em vez de acompanhar dezenas de métricas soltas, o FlowProject organiza sinais que ajudam gestores a priorizar ações e comunicar o que realmente mudou."],
    ["Como usar a página na sua estratégia de crescimento", `Esta página foi criada para capturar buscas de intenção clara por ${keyword}. Ela deve receber links da Home, de artigos do blog e de páginas relacionadas, além de apontar para a página de demonstração. Essa estrutura fortalece autoridade temática porque mostra ao Google que o domínio cobre gestão de projetos, operação, horas, PMO, consultorias, ERP, status report e indicadores de forma conectada.`]
  ];
}

function extraLandingBlocks(keyword) {
  return [
    ["Como estruturar a implantação na empresa", `A adoção de ${keyword} deve começar com um diagnóstico simples: quais informações são necessárias para operar melhor, quais indicadores são usados em reunião, quais dados chegam atrasados e quais controles duplicados consomem tempo da equipe. Depois disso, vale separar a implantação em ondas. Primeiro, cadastre clientes, projetos, responsáveis e fases. Em seguida, padronize apontamentos de horas, aprovações e status. Por fim, conecte dashboards, status reports e indicadores executivos. Essa sequência reduz resistência porque a equipe percebe valor operacional antes de a gestão cobrar maturidade analítica.`],
    ["Governança sem excesso de burocracia", "Muitas empresas tentam melhorar a gestão criando formulários, planilhas auxiliares e apresentações adicionais. O efeito colateral é previsível: a equipe passa a registrar a mesma informação em lugares diferentes. A governança eficiente nasce quando o dado operacional é aproveitado para controle gerencial. Se o consultor aponta horas no contexto do projeto, o gestor não precisa pedir outra atualização para saber esforço consumido. Se riscos e pendências ficam ligados ao status report, a reunião executiva ganha objetividade. O FlowProject segue essa lógica para equilibrar controle, velocidade e colaboração."],
    ["Impacto em vendas, retenção e relacionamento com clientes", `Uma operação que domina ${keyword} também melhora a percepção do cliente. Relatórios claros reduzem ansiedade, históricos organizados dão segurança, indicadores objetivos facilitam renegociações e o acompanhamento de horas evita discussões tardias sobre escopo. Para consultorias e empresas de serviços, isso influencia retenção e expansão de contrato. O cliente tende a confiar mais quando enxerga progresso, próximos passos, riscos e decisões pendentes com transparência. Por isso, páginas de SEO sobre temas operacionais também funcionam como ativos comerciais: elas educam o comprador e conduzem para a demonstração.`],
    ["Critérios para avaliar uma plataforma", "Ao comparar ferramentas, observe se a solução cobre apenas tarefas ou se conecta a operação completa. Uma boa plataforma deve ter cadastro de projetos, clientes e recursos; controle de horas; agenda; indicadores; gestão de status; relatórios; permissões; histórico; e caminhos claros para exportar ou compartilhar informações. Também é importante verificar se a interface ajuda o usuário operacional, porque dados confiáveis dependem de adoção. O FlowProject foi posicionado para empresas B2B que precisam dessa combinação entre usabilidade, controle gerencial e profundidade operacional."],
    ["Próximo passo recomendado", `Se a sua empresa já aparece no Google para termos relacionados a ${keyword}, mas ainda está em posições intermediárias, a prioridade é fortalecer profundidade de conteúdo, linkagem interna e conversão. Esta página deve receber links de artigos do blog, apontar para páginas irmãs do cluster e conduzir para /venda. Depois da publicação, acompanhe impressões, CTR, posição média e conversões por consulta no Google Search Console. As páginas que alcançarem posição 11 a 20 devem receber melhorias de exemplos, FAQs, comparativos e provas do produto para buscar Top 10.`]
  ];
}

function landingHtml(item) {
  const schemas = [organizationSchema(), softwareSchema(`/${item.slug}`), breadcrumbSchema([{ name: "Home", path: "/" }, { name: item.h1, path: `/${item.slug}` }]), faqSchema(item.faq)];
  const links = item.related.map((slug) => bySlug.get(slug)).filter(Boolean);
  return `${head({ title: item.title, description: item.description, path: `/${item.slug}`, image: item.image, imageAlt: item.imageAlt, keywords: [item.keyword, "FlowProject", "gestão de projetos", "gestão operacional", "controle de horas", "PMO"] })}
  ${schemas.map(jsonLd).join("\n  ")}
</head>
<body><div class="sales-page seo-page">${topbar(`/${item.slug}`)}<main>
  <section class="hero seo-hero"><div class="sales-shell hero-grid"><div><span class="eyebrow">${esc(item.eyebrow)}</span><h1>${esc(item.h1)}</h1><p class="hero-lead">${esc(item.description)} Centralize projetos, horas, equipes, clientes e indicadores em uma única plataforma.</p><div class="hero-ctas"><a class="sales-btn primary" href="/venda">Solicitar Demonstração</a><a class="sales-btn secondary" href="/blog">Ver conteúdos</a></div><div class="hero-proof"><div class="proof-item"><strong>360</strong><span>visão operacional</span></div><div class="proof-item"><strong>KPIs</strong><span>indicadores</span></div><div class="proof-item"><strong>Lead</strong><span>demonstração</span></div></div></div><div class="hero-product"><div class="product-frame"><img src="/${item.image}" alt="${esc(item.imageAlt)}" /></div></div></div></section>
  <section class="section"><div class="sales-shell seo-article-body">${proseBlocks(item.keyword, item.h1).map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}<h2>Boas práticas para implementar</h2>${["Defina responsáveis por projeto, cliente e carteira para evitar zonas cinzentas.", "Padronize status, riscos, fases, apontamentos e critérios de aceite.", "Use dashboard e status report para reunião de rotina, não apenas para fechamento mensal.", "Conecte horas, custos e indicadores para transformar execução em decisão.", "Crie CTAs claros para demonstração em páginas de fundo de funil."].map((t) => `<h3>${esc(t)}</h3><p>${esc(t)} No FlowProject, essa prática ganha rastreabilidade porque cada informação fica ligada ao contexto do projeto, do cliente, da equipe e do período analisado.</p>`).join("")}${extraLandingBlocks(item.keyword).map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}</div></section>
  <section class="section soft"><div class="sales-shell"><div class="section-head center"><h2>Recursos relacionados</h2><p>Topic cluster interno para fortalecer relevância semântica e levar visitantes para páginas de alta conversão.</p></div><div class="benefits-grid">${links.map((link) => `<article class="benefit-card"><div class="benefit-icon">SEO</div><h3><a href="/${link.slug}">${esc(link.h1)}</a></h3><p>${esc(link.description)}</p></article>`).join("")}</div></div></section>
  <section class="section"><div class="sales-shell"><div class="section-head center"><h2>Perguntas frequentes</h2><p>Dúvidas comuns antes de avaliar o FlowProject.</p></div><div class="faq-grid">${item.faq.map(([q, a]) => `<article class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></article>`).join("")}</div></div></section>
  <section class="sales-shell final-cta"><h2>Solicite uma demonstração do FlowProject</h2><p>Veja como controlar projetos, horas, equipes, clientes, PMO, consultorias, implantação ERP e status reports em uma única plataforma.</p><div class="hero-ctas"><a class="sales-btn orange" href="/venda">Solicitar Demonstração</a><a class="sales-btn secondary" href="${whatsapp}" target="_blank" rel="noopener">WhatsApp</a></div></section>
</main>${footer()}</div></body></html>`;
}

function homeHtml() {
  const faq = faqFor("software de gestão de projetos e operações");
  const schemas = [organizationSchema(), softwareSchema("/"), breadcrumbSchema([{ name: "Home", path: "/" }]), faqSchema(faq)];
  const sections = [["Dashboard em tempo real", "dashboard-projetos"], ["Controle de Horas", "controle-horas-projetos"], ["Gestão Operacional", "gestao-operacional"], ["Gestão de Consultorias", "gestao-consultoria"], ["Implantação ERP", "implantacao-erp"], ["Status Report Automático", "o-que-e-status-report"], ["Indicadores e KPIs", "indicadores-projetos"], ["PMO", "pmo"]];
  return `${head({ title: "Software de Gestão de Projetos e Operações", description: "Centralize projetos, horas, equipes, clientes e indicadores em uma única plataforma SaaS para operação, PMO e consultorias.", path: "/", keywords: ["software de gestão de projetos", "gestão operacional", "controle de horas", "dashboard de projetos"] })}
  ${schemas.map(jsonLd).join("\n  ")}
</head><body><div class="sales-page seo-page">${topbar("/")}<main>
  <section class="hero"><div class="sales-shell hero-grid"><div><span class="eyebrow">SaaS B2B para operação</span><h1>Software de Gestão de Projetos e Operações</h1><p class="hero-lead">Centralize projetos, horas, equipes, clientes e indicadores em uma única plataforma.</p><div class="hero-ctas"><a class="sales-btn primary" href="/venda">Solicitar Demonstração</a><a class="sales-btn secondary" href="/dashboard-projetos">Ver dashboard</a></div><div class="hero-proof"><div class="proof-item"><strong>PMO</strong><span>governança</span></div><div class="proof-item"><strong>ERP</strong><span>implantação</span></div><div class="proof-item"><strong>KPIs</strong><span>decisão</span></div></div></div><div class="hero-product"><div class="product-frame"><img src="/dashboard.png" alt="Dashboard de projetos do FlowProject" /></div></div></div></section>
  <section class="section"><div class="sales-shell"><div class="section-head center"><h2>Uma plataforma para a rotina real de projetos</h2><p>O FlowProject conecta execução, gestão operacional, controle de horas, consultorias, implantação ERP, PMO, status report e dashboards gerenciais.</p></div><div class="benefits-grid">${sections.map(([label, slug], index) => `<article class="benefit-card"><div class="benefit-icon">${String(index + 1).padStart(2, "0")}</div><h3><a href="/${slug}">${label}</a></h3><p>${esc(bySlug.get(slug)?.description || "Recurso conectado à estratégia de SEO e conversão do FlowProject.")}</p></article>`).join("")}</div></div></section>
  <section class="section soft"><div class="sales-shell seo-article-body">${proseBlocks("software de gestão de projetos e operações", "Software de Gestão de Projetos e Operações").map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}</div></section>
  <section class="sales-shell final-cta"><h2>Quer transformar visitantes em leads qualificados?</h2><p>Solicite uma demonstração e veja o FlowProject aplicado à sua operação.</p><div class="hero-ctas"><a class="sales-btn orange" href="/venda">Solicitar Demonstração</a></div></section>
</main>${footer()}</div></body></html>`;
}

function vendaHtml() {
  const faq = [["Por que trocar planilhas Excel pelo FlowProject?", "Porque o FlowProject mantém histórico, aprovações, indicadores, horas, custos e status reports conectados ao projeto e ao cliente."], ["O formulário gera contato comercial?", "Sim. O formulário abre uma conversa de demonstração pelo WhatsApp com os dados preenchidos."], ["Para quem a demonstração é indicada?", "Para consultorias, PMOs, empresas de serviços, equipes de implantação ERP e operações que controlam horas e projetos."]];
  const schemas = [organizationSchema(), softwareSchema("/venda"), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Demonstração", path: "/venda" }]), faqSchema(faq)];
  return `${head({ title: "Solicitar Demonstração do FlowProject", description: "Veja o FlowProject em ação: projetos, horas, equipe, clientes, status report, PMO, ERP e dashboards em uma plataforma.", path: "/venda", keywords: ["solicitar demonstração", "software de gestão de projetos", "controle de horas"] })}
  ${schemas.map(jsonLd).join("\n  ")}
</head><body><div class="sales-page seo-page">${topbar("/venda")}<main>
  <section class="hero conversion-hero"><div class="sales-shell conversion-grid"><div><span class="eyebrow">Demonstração comercial</span><h1>Pare de controlar projetos, horas e status report em planilhas.</h1><p class="hero-lead">Veja em uma demonstração como o FlowProject centraliza operação, PMO, consultorias, implantação ERP, clientes, indicadores e equipes para gerar previsibilidade.</p><div class="hero-proof"><div class="proof-item"><strong>Menos Excel</strong><span>mais histórico</span></div><div class="proof-item"><strong>Mais clareza</strong><span>status report</span></div><div class="proof-item"><strong>Mais leads</strong><span>CTA direto</span></div></div></div><form class="lead-form" id="leadForm"><h2>Solicitar Demonstração</h2><label>Nome<input id="leadName" required placeholder="Seu nome" /></label><label>Empresa<input id="leadCompany" required placeholder="Nome da empresa" /></label><label>WhatsApp<input id="leadPhone" required placeholder="(00) 00000-0000" /></label><label>Principal dor<select id="leadPain"><option>Controle de horas</option><option>Dashboard de projetos</option><option>Gestão operacional</option><option>Implantação ERP</option><option>Status report</option><option>PMO</option></select></label><button class="sales-btn orange" type="submit">Solicitar Demonstração</button></form></div></section>
  <section class="section"><div class="sales-shell"><div class="section-head center"><h2>Benefícios para converter operação em controle</h2><p>Uma demonstração mostra a diferença entre uma planilha estática e uma plataforma que organiza a execução todos os dias.</p></div><div class="benefits-grid">${["Dashboard em tempo real", "Controle de horas e apontamentos", "Status report automático", "Gestão de consultorias", "Implantação ERP com cronograma", "PMO com indicadores"].map((x, i) => `<article class="benefit-card"><div class="benefit-icon">${String(i + 1).padStart(2, "0")}</div><h3>${x}</h3><p>Veja como o FlowProject reduz retrabalho, melhora rastreabilidade e cria uma base confiável para decisões comerciais e operacionais.</p></article>`).join("")}</div></div></section>
  <section class="section soft"><div class="sales-shell"><div class="section-head"><h2>FlowProject vs planilhas Excel</h2><p>Excel ajuda no início, mas vira gargalo quando a operação cresce.</p></div><div class="seo-comparison"><article><strong>Planilhas Excel</strong><span>Versões duplicadas, fórmulas frágeis, pouca rastreabilidade, status subjetivo e indicadores montados manualmente.</span></article><article><strong>FlowProject</strong><span>Dados por projeto, cliente, recurso, horas, custos, status report, dashboard, histórico e aprovações em um só fluxo.</span></article></div></div></section>
  <section class="section"><div class="sales-shell"><div class="section-head center"><h2>Perguntas frequentes</h2></div><div class="faq-grid">${faq.map(([q, a]) => `<article class="faq-item"><h3>${q}</h3><p>${a}</p></article>`).join("")}</div></div></section>
  <a class="sticky-cta sales-btn orange" href="#leadForm">Solicitar Demonstração</a>
</main>${footer()}<script>document.getElementById("leadForm").addEventListener("submit",function(e){e.preventDefault();const text=encodeURIComponent("Olá, quero uma demonstração do FlowProject. Nome: "+leadName.value+" | Empresa: "+leadCompany.value+" | WhatsApp: "+leadPhone.value+" | Dor: "+leadPain.value);location.href="https://wa.me/5511943362288?text="+text;});</script></div></body></html>`;
}

function articleHtml(article) {
  const landing = bySlug.get(article.landing);
  const faq = faqFor(article.keyword);
  const related = articles.filter((x) => x.category === article.category && x.slug !== article.slug).slice(0, 3);
  const schemas = [organizationSchema(), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: article.title, path: `/blog/${article.slug}` }]), faqSchema(faq), { "@context": "https://schema.org", "@type": "Article", headline: article.title, description: article.description, author: { "@type": "Organization", name: "FlowProject" }, publisher: { "@type": "Organization", name: "FlowProject", logo: { "@type": "ImageObject", url: `${site}/logof.png` } }, datePublished: today, dateModified: today, mainEntityOfPage: `${site}/blog/${article.slug}`, image: `${site}/dashboard.png`, articleSection: article.categoryName, keywords: article.keyword }];
  const blocks = proseBlocks(article.keyword, article.title);
  return `${head({ title: article.titleMeta, description: article.description, path: `/blog/${article.slug}`, keywords: [article.keyword, article.categoryName, "FlowProject"], image: "dashboard.png" })}
  ${schemas.map(jsonLd).join("\n  ")}
</head><body><div class="sales-page seo-page">${topbar("/blog")}<main><article><section class="hero seo-hero compact"><div class="sales-shell"><span class="eyebrow">${esc(article.categoryName)}</span><h1>${esc(article.title)}</h1><p class="hero-lead">${esc(article.description)}</p><div class="hero-ctas"><a class="sales-btn primary" href="/venda">Solicitar Demonstração</a><a class="sales-btn secondary" href="/${landing.slug}">Ver solução</a></div></div></section><section class="section"><div class="sales-shell seo-article-layout"><div class="seo-article-body">${blocks.map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}${["Diagnóstico inicial", "Padronização do processo", "Indicadores e cadência", "Adoção pela equipe", "Evolução contínua"].map((h) => `<h2>${h}</h2><p>Para aplicar ${esc(article.keyword)} com consistência, comece identificando onde a informação nasce, quem aprova, quem consome o indicador e qual decisão depende dele. Depois, transforme esse fluxo em rotina: cadência semanal, responsáveis claros, campos padronizados e conexão com clientes, projetos, horas e custos. Essa disciplina reduz ruído e ajuda a empresa a ganhar autoridade operacional.</p>`).join("")}${extraLandingBlocks(article.keyword).map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`).join("")}<h2>Perguntas frequentes</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</div><aside class="seo-article-aside"><div class="seo-sticky-box"><span class="eyebrow">CTA</span><h2>Veja o FlowProject em ação</h2><p>Todos os artigos apontam para a página de demonstração para transformar tráfego orgânico em leads qualificados.</p><a class="sales-btn orange" href="/venda">Solicitar Demonstração</a><a class="seo-text-link" href="/${landing.slug}">Ler sobre ${esc(landing.keyword)}</a></div></aside></div></section></article><section class="section soft"><div class="sales-shell"><div class="section-head"><h2>Links internos do cluster</h2></div><div class="seo-article-grid">${related.map((x) => `<article class="seo-card"><span>${esc(x.categoryName)}</span><h2><a href="/blog/${x.slug}">${esc(x.title)}</a></h2><p>${esc(x.description)}</p></article>`).join("")}</div></div></section></main>${footer()}</div></body></html>`;
}

function blogIndexHtml() {
  return `${head({ title: "Blog FlowProject: Projetos, PMO, ERP e Horas", description: "50 artigos SEO sobre gestão de projetos, PMO, ERP, consultoria, controle de horas, status report e gestão operacional.", path: "/blog", keywords: ["blog gestão de projetos", "PMO", "ERP", "controle de horas"] })}
  ${[organizationSchema(), breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }])].map(jsonLd).join("\n  ")}
</head><body><div class="sales-page seo-page">${topbar("/blog")}<main><section class="hero seo-hero compact"><div class="sales-shell"><span class="eyebrow">Topic cluster</span><h1>Blog sobre gestão de projetos, PMO, ERP, horas e status report</h1><p class="hero-lead">Conteúdos planejados para aumentar autoridade temática, impressões orgânicas e pedidos de demonstração.</p></div></section><section class="section"><div class="sales-shell seo-article-grid">${articles.map((article) => `<article class="seo-card"><span>${esc(article.categoryName)}</span><h2><a href="/blog/${article.slug}">${esc(article.title)}</a></h2><p>${esc(article.description)}</p><a class="seo-text-link" href="/venda">Solicitar Demonstração</a></article>`).join("")}</div></section></main>${footer()}</div></body></html>`;
}

function seoCss() {
  return `.seo-page .sales-nav a[aria-current="page"]{color:var(--fp-indigo)}.seo-page .hero-product{align-self:center}.seo-hero.compact{padding:78px 0 68px}.seo-hero.compact .sales-shell{max-width:980px}.seo-hero.compact h1{margin:18px 0 16px;font-size:clamp(38px,5.4vw,68px);line-height:1}.seo-article-body{max-width:860px;font-size:18px;line-height:1.75;color:#334155}.seo-article-body h2{margin:34px 0 12px;color:var(--fp-ink);font-size:34px;line-height:1.08}.seo-article-body h3{margin:24px 0 8px;color:var(--fp-ink)}.seo-article-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:34px;align-items:start}.seo-article-aside{position:relative}.seo-sticky-box{position:sticky;top:96px;padding:22px;border:1px solid var(--fp-line);background:#fff;border-radius:16px;box-shadow:0 14px 36px rgba(15,23,42,.07)}.seo-sticky-box h2{font-size:24px;line-height:1.12;margin:14px 0 10px}.seo-sticky-box p{color:#475569;line-height:1.6}.seo-card{padding:22px;border:1px solid var(--fp-line);background:#fff;border-radius:16px;box-shadow:0 14px 36px rgba(15,23,42,.07)}.seo-card span{display:inline-flex;margin-bottom:10px;color:#c2410c;background:#fff7ed;border:1px solid #fed7aa;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900;text-transform:uppercase}.seo-card h2{font-size:22px;line-height:1.15;margin:0 0 10px}.seo-card p{color:#475569;line-height:1.6}.seo-card a{color:inherit;text-decoration:none}.seo-text-link{display:inline-flex;margin-top:12px;font-weight:900;color:var(--fp-indigo)!important}.seo-article-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.seo-comparison{display:grid;grid-template-columns:1fr 1fr;gap:14px}.seo-comparison article,.lead-form{padding:24px;border:1px solid var(--fp-line);border-radius:16px;background:#fff;box-shadow:0 14px 36px rgba(15,23,42,.07)}.seo-comparison strong,.seo-comparison span{display:block}.seo-comparison span{margin-top:8px;color:#475569;line-height:1.6}.conversion-grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:44px;align-items:center;min-height:calc(100vh - 74px);padding:74px 0}.lead-form{display:grid;gap:12px}.lead-form h2{margin:0;font-size:30px}.lead-form label{display:grid;gap:7px;color:#334155;font-weight:900}.lead-form input,.lead-form select{min-height:46px;padding:0 12px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}.sticky-cta{position:fixed;right:18px;bottom:18px;z-index:40}.seo-footer{margin-top:40px}@media (max-width:1040px){.seo-article-layout,.conversion-grid,.seo-comparison{grid-template-columns:1fr}.seo-article-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:760px){.seo-article-grid{grid-template-columns:1fr}.seo-hero.compact{padding:54px 0}.seo-article-body h2{font-size:28px}.sticky-cta{left:16px;right:16px}}`;
}

function sitemapXml() {
  const urls = [
    { loc: "/", priority: "1.0" },
    { loc: "/venda", priority: "1.0" },
    ...allLandingPages.map((x) => ({ loc: `/${x.slug}`, priority: x.slug.includes("status-report") || x.slug.includes("indicadores-status") || x.slug.includes("modelo") || x.slug.includes("exemplo") || x.slug.includes("o-que-e") ? "0.85" : "0.9" })),
    { loc: "/blog", priority: "0.8" },
    ...articles.map((x) => ({ loc: `/blog/${x.slug}`, priority: "0.65" })),
    { loc: "/privacidade", priority: "0.4" },
    { loc: "/termos", priority: "0.4" },
    { loc: "/lgpd", priority: "0.4" },
    { loc: "/dpa", priority: "0.4" }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site}${u.loc}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join("\n")}\n</urlset>\n`;
}

function implementationReport() {
  const commercial = [
    { slug: "", title: "Software de Gestão de Projetos e Operações", description: "Centralize projetos, horas, equipes, clientes e indicadores em uma única plataforma SaaS para operação, PMO e consultorias." },
    { slug: "venda", title: "Solicitar Demonstração do FlowProject", description: "Veja o FlowProject em ação: projetos, horas, equipe, clientes, status report, PMO, ERP e dashboards em uma plataforma." },
    ...allLandingPages.map((item) => ({ slug: item.slug, title: limit(item.title, 60), description: limit(item.description, 155) }))
  ];
  const lines = [
    "# Relatório de Implementação SEO - FlowProject",
    "",
    `Gerado em: ${today}`,
    "",
    "## Páginas Comerciais e Clusters",
    "",
    "| URL | Meta Title | Meta Description |",
    "| --- | --- | --- |",
    ...commercial.map((item) => `| ${site}/${item.slug} | ${item.title} | ${item.description} |`),
    "",
    "## Blog - 50 Artigos SEO",
    "",
    "| URL | Cluster | Meta Title | Meta Description |",
    "| --- | --- | --- | --- |",
    ...articles.map((item) => `| ${site}/blog/${item.slug} | ${item.categoryName} | ${item.titleMeta} | ${item.description} |`),
    "",
    "## Linkagem Interna",
    "",
    "- Home aponta para Dashboard Projetos, Gestão Operacional, Controle Horas, Gestão Consultoria, Implantação ERP, PMO, Indicadores e Status Report.",
    "- Páginas comerciais apontam entre si por related pages e CTA para /venda.",
    "- Cluster Status Report aponta para páginas semanais, executivas, PMO, dashboard e indicadores.",
    "- Todos os artigos têm CTA e link interno para /venda, além de link para landing page relacionada.",
    "- Footer reforça Dashboard, Gestão Operacional, Controle de Horas, Gestão de Consultoria e Demonstração.",
    "",
    "## Schemas Implementados",
    "",
    "- Organization",
    "- SoftwareApplication",
    "- FAQPage",
    "- BreadcrumbList",
    "- Article nos artigos do blog",
    "- Open Graph e Twitter Cards em páginas geradas",
    "",
    "## Sugestões para Top 10",
    "",
    "- Solicitar indexação das URLs prioritárias no Google Search Console após deploy.",
    "- Monitorar consultas em posição 11-20 e reforçar exemplos, screenshots, comparativos e FAQs.",
    "- Criar backlinks em diretórios SaaS B2B, parceiros ERP, consultorias e conteúdos convidados.",
    "- Adicionar estudos de caso reais, depoimentos e provas sociais com dados mensuráveis.",
    "- Medir conversão orgânica por evento de clique em /venda e WhatsApp.",
    "- Publicar atualizações mensais nos artigos que ganharem impressões sem cliques.",
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function preserveLogin() {
  const indexPath = path.join(publicDir, "index.html");
  const loginPath = path.join(publicDir, "login.html");
  if (fs.existsSync(indexPath) && !fs.existsSync(loginPath)) {
    fs.copyFileSync(indexPath, loginPath);
  }
  if (fs.existsSync(loginPath)) {
    let html = fs.readFileSync(loginPath, "utf8");
    if (!html.includes('meta name="description"')) {
      html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>Login FlowProject</title>\n<meta name="description" content="Acesse o FlowProject para gerenciar projetos, horas, equipes, clientes, indicadores e status reports." />');
    }
    html = html.replace(/<link rel="canonical" href="https:\/\/portalprojectflow.com\/" \/>/, '<link rel="canonical" href="https://portalprojectflow.com/login" />');
    fs.writeFileSync(loginPath, html, "utf8");
  }
}

function main() {
  preserveLogin();
  if (fs.existsSync(blogDir)) {
    for (const entry of fs.readdirSync(blogDir)) {
      if (entry.endsWith(".html")) fs.unlinkSync(path.join(blogDir, entry));
    }
  }
  write(path.join(publicDir, "seo.css"), seoCss());
  write(path.join(publicDir, "index.html"), homeHtml());
  // venda.html has a hand-built pricing/checkout page. Keep it out of the SEO generator
  // so the individual and company plans are not replaced by the generic lead page.
  allLandingPages.forEach((item) => write(path.join(publicDir, `${item.slug}.html`), landingHtml(item)));
  write(path.join(blogDir, "index.html"), blogIndexHtml());
  articles.forEach((article) => write(path.join(blogDir, `${article.slug}.html`), articleHtml(article)));
  write(path.join(publicDir, "sitemap.xml"), sitemapXml());
  write(path.join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
  write(path.join(root, "seo-implementation-report.md"), implementationReport());
  console.log(`Generated ${allLandingPages.length} landing/status pages and ${articles.length} blog articles.`);
}

main();
