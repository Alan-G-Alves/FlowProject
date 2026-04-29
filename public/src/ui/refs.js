// public/src/ui/refs.js
// Centraliza document.getElementById em um só lugar.

const byId = (id) => document.getElementById(id);

// Views
export const viewLogin = byId("viewLogin");
export const viewDashboard = byId("viewDashboard");
export const viewReports = byId("viewReports");
export const viewAdmin = byId("viewAdmin");
export const viewCompanies = byId("viewCompanies");
export const viewManagerUsers = byId("viewManagerUsers");
export const viewClients = byId("viewClients");
export const viewSettings = byId("viewSettings");

// Sidebar
export const sidebar = byId("sidebar");
export const sidebarBrand = byId("sidebarBrand");
export const sidebarBrandLogo = byId("sidebarBrandLogo");
export const sidebarBrandTitle = byId("sidebarBrandTitle");
export const btnToggleSidebar = byId("btnToggleSidebar");
export const navHome = byId("navHome");
export const navAddProject = byId("navAddProject");
export const navMyProjects = byId("navMyProjects");
export const navAddTech = byId("navAddTech");
export const navClients = byId("navClients");
export const navReports = byId("navReports");
export const navFeedbacks = byId("navFeedbacks");
export const navExpenses = byId("navExpenses");
export const navConfig = byId("navConfig");
export const navLogout = byId("navLogout");

// Settings
export const settingsRoleLabel = byId("settingsRoleLabel");
export const settingsGrid = byId("settingsGrid");
export const settingsEmpty = byId("settingsEmpty");

// Company brand settings
export const modalCompanyBrand = byId("modalCompanyBrand");
export const btnCloseCompanyBrand = byId("btnCloseCompanyBrand");
export const btnCancelCompanyBrand = byId("btnCancelCompanyBrand");
export const btnSaveCompanyBrand = byId("btnSaveCompanyBrand");
export const btnResetCompanyBrand = byId("btnResetCompanyBrand");
export const companyBrandAlert = byId("companyBrandAlert");
export const companyBrandName = byId("companyBrandName");
export const companyBrandLogoFile = byId("companyBrandLogoFile");
export const companyBrandPreviewImg = byId("companyBrandPreviewImg");
export const companyBrandPreviewName = byId("companyBrandPreviewName");

// Report permissions settings
export const modalReportPermissions = byId("modalReportPermissions");
export const reportPermissionsAlert = byId("reportPermissionsAlert");
export const reportPermissionsTableBody = byId("reportPermissionsTableBody");
export const btnCloseReportPermissions = byId("btnCloseReportPermissions");
export const btnCancelReportPermissions = byId("btnCancelReportPermissions");
export const btnSaveReportPermissions = byId("btnSaveReportPermissions");
export const btnResetReportPermissions = byId("btnResetReportPermissions");

// Login
export const loginForm = byId("loginForm");
export const emailEl = byId("email");
export const passwordEl = byId("password");
export const btnForgot = byId("btnForgot");
export const loginAlert = byId("loginAlert");

// Avatar / menu
export const btnAvatar = byId("btnAvatar") || byId("avatarBtn");
export const userAvatar = byId("userAvatar");
export const userAvatarImg = byId("userAvatarImg");
export const userAvatarFallback = byId("userAvatarFallback");
export const userMenu = byId("userMenu");
export const avatarDropdown = byId("avatarDropdown");
export const btnEditProfile = byId("btnEditProfile");
export const btnUserLogout = byId("btnUserLogout");
export const notificationsMenu = byId("notificationsMenu");
export const btnNotifications = byId("btnNotifications");
export const notificationCount = byId("notificationCount");
export const notificationsPanel = byId("notificationsPanel");
export const notificationsList = byId("notificationsList");
export const btnMarkAllNotificationsRead = byId("btnMarkAllNotificationsRead");
export const btnHelpManual = byId("btnHelpManual");
export const modalHelpManual = byId("modalHelpManual");
export const btnCloseHelpManual = byId("btnCloseHelpManual");
export const btnCancelHelpManual = byId("btnCancelHelpManual");
export const manualTitle = byId("manualTitle");
export const manualSubtitle = byId("manualSubtitle");
export const manualRoleLabel = byId("manualRoleLabel");
export const manualSearch = byId("manualSearch");
export const manualContent = byId("manualContent");

// Perfil modal
export const profileModal = byId("profileModal");
export const btnCloseProfile = byId("btnCloseProfile");
export const btnCancelProfile = byId("btnCancelProfile");
export const btnSaveProfile = byId("btnSaveProfile");
export const profileAlert = byId("profileAlert");
export const profilePhotoPreview = byId("profilePhotoPreview");
export const profilePhotoImg = byId("profilePhotoImg");
export const profilePhotoFallback = byId("profilePhotoFallback");
export const profilePhotoFile = byId("profilePhotoFile");
export const profilePhotoUrl = byId("profilePhotoUrl");
export const btnProfileRemovePhoto = byId("btnProfileRemovePhoto");
export const profileName = byId("profileName");
export const profilePhone = byId("profilePhone");
export const profileEmail = byId("profileEmail");

// Dashboard
export const dashTitle = byId("dashTitle");
export const dashSubtitle = byId("dashSubtitle");
export const chipTeam = byId("chipTeam");
export const chipEmail = byId("chipEmail");
export const dashCards = byId("dashCards");
export const dashboardAgenda = byId("dashboardAgenda");
export const dashboardAgendaSubtitle = byId("dashboardAgendaSubtitle");
export const dashboardAgendaMonth = byId("dashboardAgendaMonth");
export const btnDashboardAgendaPrevMonth = byId("btnDashboardAgendaPrevMonth");
export const btnDashboardAgendaNextMonth = byId("btnDashboardAgendaNextMonth");
export const dashboardCalendar = byId("dashboardCalendar");
export const dashboardReminders = byId("dashboardReminders");
export const dashboardRemindersSubtitle = byId("dashboardRemindersSubtitle");
export const dashboardRemindersOpenCount = byId("dashboardRemindersOpenCount");
export const dashboardRemindersTodayCount = byId("dashboardRemindersTodayCount");
export const dashboardRemindersTotalCount = byId("dashboardRemindersTotalCount");
export const dashboardRemindersList = byId("dashboardRemindersList");
export const dashboardRemindersEmpty = byId("dashboardRemindersEmpty");
export const btnOpenReminderComposer = byId("btnOpenReminderComposer");
export const modalReminderComposer = byId("modalReminderComposer");
export const btnCloseReminderComposer = byId("btnCloseReminderComposer");
export const btnCancelReminderComposer = byId("btnCancelReminderComposer");
export const btnSaveReminder = byId("btnSaveReminder");
export const reminderComposerAlert = byId("reminderComposerAlert");
export const reminderDateInput = byId("reminderDateInput");
export const reminderColorOptions = byId("reminderColorOptions");
export const reminderMessageInput = byId("reminderMessageInput");
export const reminderTargetsWrap = byId("reminderTargetsWrap");
export const reminderTargetsList = byId("reminderTargetsList");
export const reminderSelfHintWrap = byId("reminderSelfHintWrap");
export const reminderSelfHint = byId("reminderSelfHint");
export const btnReminderToggleAllUsers = byId("btnReminderToggleAllUsers");
export const modalReminderDetail = byId("modalReminderDetail");
export const btnCloseReminderDetail = byId("btnCloseReminderDetail");
export const btnDeleteReminderDetail = byId("btnDeleteReminderDetail");
export const btnAcknowledgeReminderDetail = byId("btnAcknowledgeReminderDetail");
export const reminderDetailMeta = byId("reminderDetailMeta");
export const reminderDetailDate = byId("reminderDetailDate");
export const reminderDetailMessage = byId("reminderDetailMessage");
export const reminderDetailAuthor = byId("reminderDetailAuthor");
export const reminderDetailRecipient = byId("reminderDetailRecipient");
export const reportsPeriodFilter = byId("reportsPeriodFilter");
export const reportsClientFilter = byId("reportsClientFilter");
export const reportsTeamFilter = byId("reportsTeamFilter");
export const reportsStatusFilter = byId("reportsStatusFilter");
export const btnReloadReports = byId("btnReloadReports");
export const reportsGrid = byId("reportsGrid");
export const modalReportTechFilters = byId("modalReportTechFilters");
export const btnCloseReportTechFilters = byId("btnCloseReportTechFilters");
export const btnApplyReportTechFilters = byId("btnApplyReportTechFilters");
export const btnResetReportTechFilters = byId("btnResetReportTechFilters");
export const reportTechFilterPeriod = byId("reportTechFilterPeriod");
export const reportTechFilterStartDate = byId("reportTechFilterStartDate");
export const reportTechFilterEndDate = byId("reportTechFilterEndDate");
export const reportTechFilterClient = byId("reportTechFilterClient");
export const reportTechFilterProject = byId("reportTechFilterProject");
export const reportTechFilterActivityStatus = byId("reportTechFilterActivityStatus");
export const reportTechFilterTech = byId("reportTechFilterTech");

// Companies (master)
export const companiesGrid = byId("companiesGrid");
export const companiesEmpty = byId("companiesEmpty");
export const companySearch = byId("companySearch");
export const btnReloadCompanies = byId("btnReloadCompanies");
export const btnBackToDashboard = byId("btnBackToDashboard");
export const btnOpenCreateCompany = byId("btnOpenCreateCompany");

// Company detail (master)
export const modalCompanyDetail = byId("modalCompanyDetail");
export const btnCloseCompanyDetail = byId("btnCloseCompanyDetail");
export const companyDetailTitle = byId("companyDetailTitle");
export const companyDetailMeta = byId("companyDetailMeta");
export const companyDetailStatus = byId("companyDetailStatus");
export const btnToggleCompanyBlock = byId("btnToggleCompanyBlock");
export const companyUsersSearch = byId("companyUsersSearch");
export const companyUsersTotalCount = byId("companyUsersTotalCount");
export const companyUsersActiveCount = byId("companyUsersActiveCount");
export const companyUsersBlockedCount = byId("companyUsersBlockedCount");
export const companyUsersTbody = byId("companyUsersTbody");
export const companyUsersEmpty = byId("companyUsersEmpty");
export const companyUsersAlert = byId("companyUsersAlert");

// Create company
export const modalCreateCompany = byId("modalCreateCompany");
export const btnCloseCreateCompany = byId("btnCloseCreateCompany");
export const btnCancelCreateCompany = byId("btnCancelCreateCompany");
export const btnCreateCompany = byId("btnCreateCompany");
export const companyNameEl = byId("companyName");
export const companyCnpjEl = byId("companyCnpj");
export const companyIdEl = byId("companyId");
export const adminNameEl = byId("adminName");
export const adminEmailEl = byId("adminEmail");
export const adminPhoneEl = byId("adminPhone");
export const adminActiveEl = byId("adminActive");
export const createCompanyAlert = byId("createCompanyAlert");
export const createCompanySuccess = byId("createCompanySuccess");

// Admin (empresa)
export const btnBackFromAdmin = byId("btnBackFromAdmin");

// Teams
export const teamsGrid = byId("teamsGrid");
export const teamsEmpty = byId("teamsEmpty");
export const teamSearch = byId("teamSearch");
export const btnReloadTeams = byId("btnReloadTeams");
export const btnOpenCreateTeam = byId("btnOpenCreateTeam");
export const modalCreateTeam = byId("modalCreateTeam");
export const btnCloseCreateTeam = byId("btnCloseCreateTeam");
export const btnCancelCreateTeam = byId("btnCancelCreateTeam");
export const btnCreateTeam = byId("btnCreateTeam");
export const teamNameEl = byId("teamName");
export const teamIdEl = byId("teamId");
export const createTeamAlert = byId("createTeamAlert");

// Team details
export const modalTeamDetails = byId("modalTeamDetails");
export const btnCloseTeamDetails = byId("btnCloseTeamDetails");
export const btnCancelTeamDetails = byId("btnCancelTeamDetails");
export const teamDetailsNameEl = byId("teamDetailsName");
export const teamDetailsIdEl = byId("teamDetailsId");
export const teamDetailsStatusEl = byId("teamDetailsStatus");
export const teamDetailsUsersEl = byId("teamDetailsUsers");
export const teamDetailsEmptyEl = byId("teamDetailsEmpty");
export const teamDetailsAlert = byId("teamDetailsAlert");
export const btnTeamToggleActive = byId("btnTeamToggleActive");
export const btnTeamDelete = byId("btnTeamDelete");
export const btnAddUsersToTeam = byId("btnAddUsersToTeam");

// Modal: Add Users to Team
export const modalAddUsersToTeam = byId("modalAddUsersToTeam");
export const btnCloseAddUsersToTeam = byId("btnCloseAddUsersToTeam");
export const btnCancelAddUsersToTeam = byId("btnCancelAddUsersToTeam");
export const btnSaveAddUsersToTeam = byId("btnSaveAddUsersToTeam");
export const addUsersTeamName = byId("addUsersTeamName");
export const addUsersToTeamList = byId("addUsersToTeamList");
export const addUsersToTeamAlert = byId("addUsersToTeamAlert");

// Admin overview
export const adminUsersCount = byId("adminUsersCount");
export const adminManagersCount = byId("adminManagersCount");
export const adminTechsCount = byId("adminTechsCount");
export const adminAdminsCount = byId("adminAdminsCount");
export const adminCoordinatorsCount = byId("adminCoordinatorsCount");
export const adminTeamsCount = byId("adminTeamsCount");
export const adminBlockedUsersCount = byId("adminBlockedUsersCount");

// Users
export const usersTbody = byId("usersTbody");
export const usersPagination = byId("usersPagination");
export const usersEmpty = byId("usersEmpty");
export const userSearch = byId("userSearch");
export const userRoleFilter = byId("userRoleFilter");
export const btnReloadUsers = byId("btnReloadUsers");
export const btnOpenCreateUser = byId("btnOpenCreateUser");
export const modalCreateUser = byId("modalCreateUser");
export const btnCloseCreateUser = byId("btnCloseCreateUser");
export const btnCancelCreateUser = byId("btnCancelCreateUser");
export const btnCreateUser = byId("btnCreateUser");
export const newUserUidEl = byId("newUserUid");
export const newUserNameEl = byId("newUserName");
export const newUserRoleEl = byId("newUserRole");
export const newUserEmailEl = byId("newUserEmail");
export const newUserPhoneEl = byId("newUserPhone");
export const newUserActiveEl = byId("newUserActive");
export const newUserAddressEl = byId("newUserAddress");
export const newUserBirthDateEl = byId("newUserBirthDate");
export const newUserAgePreview = byId("newUserAgePreview");
export const newUserCpfEl = byId("newUserCpf");
export const newUserCnpjEl = byId("newUserCnpj");
export const newUserSoftSkillInputEl = byId("newUserSoftSkillInput");
export const newUserSoftSkillChips = byId("newUserSoftSkillChips");
export const newUserHardSkillInputEl = byId("newUserHardSkillInput");
export const newUserHardSkillChips = byId("newUserHardSkillChips");
export const newUserAvatarPreview = byId("newUserAvatarPreview");
export const newUserAvatarPreviewImg = byId("newUserAvatarPreviewImg");
export const newUserAvatarPreviewFallback = byId("newUserAvatarPreviewFallback");
export const newUserAvatarFileEl = byId("newUserAvatarFile");
export const btnNewUserRemovePhoto = byId("btnNewUserRemovePhoto");
export const newUserPhotoFileName = byId("newUserPhotoFileName");
export const newUserAttachmentsEl = byId("newUserAttachments");
export const newUserAttachmentsList = byId("newUserAttachmentsList");
export const newUserAttachmentsSummary = byId("newUserAttachmentsSummary");
export const teamChipsEl = byId("teamChips");
export const createUserAlert = byId("createUserAlert");

// Edit User Teams Modal
export const modalEditUserTeams = byId("modalEditUserTeams");
export const btnCloseEditUserTeams = byId("btnCloseEditUserTeams");
export const btnCancelEditUserTeams = byId("btnCancelEditUserTeams");
export const btnSaveEditUserTeams = byId("btnSaveEditUserTeams");
export const editUserTeamsChips = byId("editUserTeamsChips");
export const editUserTeamsAlert = byId("editUserTeamsAlert");
export const editUserTeamsTitle = byId("editUserTeamsTitle");

// Gestor
export const btnBackFromManagerUsers = byId("btnBackFromManagerUsers");
export const btnOpenCreateTech = byId("btnOpenCreateTech");
export const mgrUserSearch = byId("mgrUserSearch");
export const btnClearMgrUserSearch = byId("btnClearMgrUserSearch");
export const mgrTeamFilter = byId("mgrTeamFilter");
export const btnReloadMgrUsers = byId("btnReloadMgrUsers");
export const mgrUsersTbody = byId("mgrUsersTbody");
export const mgrUsersEmpty = byId("mgrUsersEmpty");
export const mgrUsersPagination = byId("mgrUsersPagination");

// Clients (Cadastro de Clientes)
export const btnOpenCreateClient = byId("btnOpenCreateClient");
export const clientsSearch = byId("clientsSearch");
export const btnClearClientsSearch = byId("btnClearClientsSearch");
export const clientsTbody = byId("clientsTbody");
export const clientsEmpty = byId("clientsEmpty");
export const clientsPagination = byId("clientsPagination");

// Create client modal
export const modalCreateClient = byId("modalCreateClient");
export const btnCloseCreateClient = byId("btnCloseCreateClient");
export const btnCancelCreateClient = byId("btnCancelCreateClient");
export const btnCreateClient = byId("btnCreateClient");
export const createClientAlert = byId("createClientAlert");
export const createClientSuccess = byId("createClientSuccess");

export const clientPhotoPreview = byId("clientPhotoPreview");
export const clientPhotoImg = byId("clientPhotoImg");
export const clientPhotoFallback = byId("clientPhotoFallback");
export const clientPhotoFile = byId("clientPhotoFile");
export const clientPhotoUrl = byId("clientPhotoUrl");
export const btnClientRemovePhoto = byId("btnClientRemovePhoto");
export const clientPhotoFileName = byId("clientPhotoFileName");

export const clientNameEl = byId("clientName");
export const clientCpfCnpjEl = byId("clientCpfCnpj");
export const clientAddressEl = byId("clientAddress");
export const clientPhoneEl = byId("clientPhone");
export const clientEmailEl = byId("clientEmail");
export const clientActiveEl = byId("clientActive");
export const clientKeyUserNameEl = byId("clientKeyUserName");
export const clientKeyUserEmailEl = byId("clientKeyUserEmail");
export const clientKeyUserPhoneEl = byId("clientKeyUserPhone");
export const btnAddClientKeyUser = byId("btnAddClientKeyUser");
export const clientKeyUsersList = byId("clientKeyUsersList");
export const clientKeyUsersEmpty = byId("clientKeyUsersEmpty");

// Client projects modal
export const modalClientProjects = byId("modalClientProjects");
export const btnCloseClientProjects = byId("btnCloseClientProjects");
export const btnCancelClientProjects = byId("btnCancelClientProjects");
export const clientProjectsTitle = byId("clientProjectsTitle");
export const clientProjectsTbody = byId("clientProjectsTbody");
export const clientProjectsEmpty = byId("clientProjectsEmpty");
export const modalClientKeyUsers = byId("modalClientKeyUsers");
export const btnCloseClientKeyUsers = byId("btnCloseClientKeyUsers");
export const btnCancelClientKeyUsers = byId("btnCancelClientKeyUsers");
export const clientKeyUsersTitle = byId("clientKeyUsersTitle");
export const clientKeyUsersTbody = byId("clientKeyUsersTbody");
export const clientKeyUsersModalEmpty = byId("clientKeyUsersModalEmpty");

// Create tech modal
export const modalCreateTech = byId("modalCreateTech");
export const btnCloseCreateTech = byId("btnCloseCreateTech");
export const btnCancelCreateTech = byId("btnCancelCreateTech");
export const btnCreateTech = byId("btnCreateTech");
export const techUidEl = byId("techUid");
export const techNameEl = byId("techName");
export const techEmailEl = byId("techEmail");
export const techPhoneEl = byId("techPhone");
export const techHourlyRateEl = byId("techHourlyRate");
export const techActiveEl = byId("techActive");
export const techAddressEl = byId("techAddress");
export const techBirthDateEl = byId("techBirthDate");
export const techAgePreview = byId("techAgePreview");
export const techCpfEl = byId("techCpf");
export const techCnpjEl = byId("techCnpj");
export const mgrTeamChipsEl = byId("mgrTeamChips");
export const createTechAlert = byId("createTechAlert");

// Create tech skills + avatar
export const techSoftSkillInputEl = byId("techSoftSkillInput");
export const techSoftSkillChips = byId("techSoftSkillChips");
export const techHardSkillInputEl = byId("techHardSkillInput");
export const techHardSkillChips = byId("techHardSkillChips");

export const techAvatarPreview = byId("techAvatarPreview");
export const techAvatarPreviewImg = byId("techAvatarPreviewImg");
export const techAvatarPreviewFallback = byId("techAvatarPreviewFallback");
export const techAvatarFileEl = byId("techAvatarFile");
export const btnTechRemovePhoto = byId("btnTechRemovePhoto");
export const techPhotoFileName = byId("techPhotoFileName");
export const techAttachmentsEl = byId("techAttachments");
export const techAttachmentsList = byId("techAttachmentsList");
export const techAttachmentsSummary = byId("techAttachmentsSummary");

// Managed teams modal
export const modalManagedTeams = byId("modalManagedTeams");
export const managedTeamsSubtitle = byId("managedTeamsSubtitle");
export const managedTeamsChips = byId("managedTeamsChips");
export const managedTeamsAlert = byId("managedTeamsAlert");
export const btnCloseManagedTeams = byId("btnCloseManagedTeams");
export const btnCancelManagedTeams = byId("btnCancelManagedTeams");
export const btnSaveManagedTeams = byId("btnSaveManagedTeams");

// My Projects (Kanban)
export const viewMyProjects = byId("viewMyProjects");
export const btnBackFromMyProjects = byId("btnBackFromMyProjects");
export const btnOpenCreateProjectFromKanban = byId("btnOpenCreateProjectFromKanban");
export const myProjectsViewTitle = byId("myProjectsViewTitle");
export const myProjectsViewSubtitle = byId("myProjectsViewSubtitle");
export const kanbanTodo = byId("kanbanTodo");
export const kanbanInProgress = byId("kanbanInProgress");
export const kanbanDone = byId("kanbanDone");
export const kanbanCountTodo = byId("kanbanCountTodo");
export const kanbanCountInProgress = byId("kanbanCountInProgress");
export const kanbanCountDone = byId("kanbanCountDone");

// My Activities
export const viewMyActivities = byId("viewMyActivities");
export const btnBackFromMyActivities = byId("btnBackFromMyActivities");
export const btnReloadMyActivities = byId("btnReloadMyActivities");
export const myActivitiesSearchInput = byId("myActivitiesSearchInput");
export const myActivitiesStartDateInput = byId("myActivitiesStartDateInput");
export const myActivitiesEndDateInput = byId("myActivitiesEndDateInput");
export const btnClearMyActivitiesPeriod = byId("btnClearMyActivitiesPeriod");
export const myActivitiesTotalCount = byId("myActivitiesTotalCount");
export const myActivitiesPendingCount = byId("myActivitiesPendingCount");
export const myActivitiesGeneratedCount = byId("myActivitiesGeneratedCount");
export const myActivitiesOverdueCount = byId("myActivitiesOverdueCount");
export const myActivitiesList = byId("myActivitiesList");
export const myActivitiesEmpty = byId("myActivitiesEmpty");
export const modalMyActivity = byId("modalMyActivity");
export const btnCloseMyActivityModal = byId("btnCloseMyActivityModal");
export const btnCancelMyActivityModal = byId("btnCancelMyActivityModal");
export const btnSaveMyActivityModal = byId("btnSaveMyActivityModal");
export const myActivityModalTitle = byId("myActivityModalTitle");
export const myActivityModalSubtitle = byId("myActivityModalSubtitle");
export const myActivityModalAlert = byId("myActivityModalAlert");
export const myActivityProject = byId("myActivityProject");
export const myActivityClient = byId("myActivityClient");
export const myActivityTask = byId("myActivityTask");
export const myActivityName = byId("myActivityName");
export const myActivityDate = byId("myActivityDate");
export const myActivityHours = byId("myActivityHours");
export const myActivityStatusBadge = byId("myActivityStatusBadge");
export const myActivityStartTime = byId("myActivityStartTime");
export const myActivityEndTime = byId("myActivityEndTime");
export const myActivityBreakTime = byId("myActivityBreakTime");
export const myActivityComputedHours = byId("myActivityComputedHours");
export const myActivityKeyUsers = byId("myActivityKeyUsers");
export const myActivityNote = byId("myActivityNote");
export const myActivityNoteCounter = byId("myActivityNoteCounter");
export const myActivityTip = byId("myActivityTip");
export const btnOpenActivityExpense = byId("btnOpenActivityExpense");
export const myActivityExpenseComposer = byId("myActivityExpenseComposer");
export const myActivityExpenseDrafts = byId("myActivityExpenseDrafts");
export const myActivityExpenseTotal = byId("myActivityExpenseTotal");
export const myActivityExpensePendingCount = byId("myActivityExpensePendingCount");
export const myActivityExpensesList = byId("myActivityExpensesList");

// My Feedbacks
export const viewMyFeedbacks = byId("viewMyFeedbacks");
export const myFeedbacksSearchInput = byId("myFeedbacksSearchInput");
export const myFeedbacksPageTitle = byId("myFeedbacksPageTitle");
export const myFeedbacksPageSubtitle = byId("myFeedbacksPageSubtitle");
export const myFeedbacksModeWrap = byId("myFeedbacksModeWrap");
export const btnMyFeedbacksModeReceived = byId("btnMyFeedbacksModeReceived");
export const btnMyFeedbacksModeApplied = byId("btnMyFeedbacksModeApplied");
export const myFeedbacksHeadline = byId("myFeedbacksHeadline");
export const myFeedbacksIntro = byId("myFeedbacksIntro");
export const myFeedbacksTotalCount = byId("myFeedbacksTotalCount");
export const myFeedbacksAverageScore = byId("myFeedbacksAverageScore");
export const myFeedbacksPositiveCount = byId("myFeedbacksPositiveCount");
export const myFeedbacksLatestDate = byId("myFeedbacksLatestDate");
export const myFeedbacksSectionTitle = byId("myFeedbacksSectionTitle");
export const myFeedbacksListMeta = byId("myFeedbacksListMeta");
export const myFeedbacksList = byId("myFeedbacksList");
export const myFeedbacksEmpty = byId("myFeedbacksEmpty");
export const myFeedbacksEmptyTitle = byId("myFeedbacksEmptyTitle");
export const myFeedbacksEmptyText = byId("myFeedbacksEmptyText");
export const myFeedbacksPagination = byId("myFeedbacksPagination");

// OS Approvals
export const viewOsApprovals = byId("viewOsApprovals");
export const osApprovalsSearchInput = byId("osApprovalsSearchInput");
export const osApprovalsManagerFilter = byId("osApprovalsManagerFilter");
export const osApprovalsProjectFilter = byId("osApprovalsProjectFilter");
export const osApprovalsPendingCount = byId("osApprovalsPendingCount");
export const osApprovalsApprovedCount = byId("osApprovalsApprovedCount");
export const osApprovalsPendingHours = byId("osApprovalsPendingHours");
export const osApprovalsApprovedHours = byId("osApprovalsApprovedHours");
export const osApprovalsBulkBar = byId("osApprovalsBulkBar");
export const osApprovalsSelectAll = byId("osApprovalsSelectAll");
export const osApprovalsBulkMeta = byId("osApprovalsBulkMeta");
export const btnOsApprovalsBulkAction = byId("btnOsApprovalsBulkAction");
export const osApprovalsList = byId("osApprovalsList");
export const osApprovalsPagination = byId("osApprovalsPagination");
export const osApprovalsEmpty = byId("osApprovalsEmpty");

// Expense Approvals
export const viewExpenseApprovals = byId("viewExpenseApprovals");
export const expenseApprovalsSearchInput = byId("expenseApprovalsSearchInput");
export const expenseApprovalsProjectFilter = byId("expenseApprovalsProjectFilter");
export const expenseApprovalsTypeFilter = byId("expenseApprovalsTypeFilter");
export const expenseApprovalsUserFilter = byId("expenseApprovalsUserFilter");
export const expenseApprovalsApproverFilter = byId("expenseApprovalsApproverFilter");
export const expenseApprovalsStartDateInput = byId("expenseApprovalsStartDateInput");
export const expenseApprovalsEndDateInput = byId("expenseApprovalsEndDateInput");
export const expenseApprovalsPendingCount = byId("expenseApprovalsPendingCount");
export const expenseApprovalsApprovedCount = byId("expenseApprovalsApprovedCount");
export const expenseApprovalsRejectedCount = byId("expenseApprovalsRejectedCount");
export const expenseApprovalsPendingValue = byId("expenseApprovalsPendingValue");
export const expenseApprovalsInternalValue = byId("expenseApprovalsInternalValue");
export const expenseApprovalsClientValue = byId("expenseApprovalsClientValue");
export const expenseApprovalsList = byId("expenseApprovalsList");
export const expenseApprovalsPagination = byId("expenseApprovalsPagination");
export const expenseApprovalsEmpty = byId("expenseApprovalsEmpty");
export const btnOpenManualExpense = byId("btnOpenManualExpense");

// Expense Form
export const modalExpenseForm = byId("modalExpenseForm");
export const btnCloseExpenseForm = byId("btnCloseExpenseForm");
export const btnCancelExpenseForm = byId("btnCancelExpenseForm");
export const btnSaveExpenseForm = byId("btnSaveExpenseForm");
export const expenseFormTitle = byId("expenseFormTitle");
export const expenseFormSubtitle = byId("expenseFormSubtitle");
export const expenseFormAlert = byId("expenseFormAlert");
export const expenseProjectEl = byId("expenseProject");
export const expenseTaskEl = byId("expenseTask");
export const expenseActivityEl = byId("expenseActivity");
export const expenseTypeEl = byId("expenseType");
export const expenseAmountEl = byId("expenseAmount");
export const expenseChargedToClientEl = byId("expenseChargedToClient");
export const expenseObservationEl = byId("expenseObservation");
export const expenseObservationHint = byId("expenseObservationHint");
export const expenseObservationCounter = byId("expenseObservationCounter");
export const expenseReceiptFileEl = byId("expenseReceiptFile");
export const expenseReceiptSummary = byId("expenseReceiptSummary");
export const expenseReceiptPreview = byId("expenseReceiptPreview");
export const btnRemoveExpenseReceipt = byId("btnRemoveExpenseReceipt");
export const expenseContextBanner = byId("expenseContextBanner");

// Projects
export const viewProjects = byId("viewProjects");
export const btnBackFromProjects = byId("btnBackFromProjects");
export const projectsGrid = byId("projectsGrid");
export const projectsEmpty = byId("projectsEmpty");
export const projectSearch = byId("projectSearch");
export const projectTeamFilter = byId("projectTeamFilter");
export const projectStatusFilter = byId("projectStatusFilter");
export const projectCoordinatorFilter = byId("projectCoordinatorFilter");
export const btnReloadProjects = byId("btnReloadProjects");
export const btnOpenCreateProject = byId("btnOpenCreateProject");

// Create project modal
export const modalCreateProject = byId("modalCreateProject");
export const btnCloseCreateProject = byId("btnCloseCreateProject");
export const btnCancelCreateProject = byId("btnCancelCreateProject");
export const btnCreateProject = byId("btnCreateProject");
export const projectNameEl = byId("projectName");
export const projectDescriptionEl = byId("projectDescription");
export const projectManagerEl = byId("projectManager");
export const projectCoordinatorEl = byId("projectCoordinator");
export const projectTeamEl = byId("projectTeam");
export const projectBillingValueEl = byId("projectBillingValue");
export const projectBillingHoursEl = byId("projectBillingHours");
export const projectStatusEl = byId("projectStatus");
export const projectPriorityEl = byId("projectPriority");
export const projectStartDateEl = byId("projectStartDate");
export const projectEndDateEl = byId("projectEndDate");
export const projectClientEl = byId("projectClient");
export const projectTechSelectEl = byId("projectTechSelect");
export const projectTechChipsEl = byId("projectTechChips");
export const projectBillingValueAmountEl = byId("projectBillingValueAmount");
export const projectBillingHoursAmountEl = byId("projectBillingHoursAmount");
export const projectContractFileEl = byId("projectContractFile");
export const projectContractFileNameEl = byId("projectContractFileName");
export const btnRemoveProjectContract = byId("btnRemoveProjectContract");
export const projectIdPreviewEl = byId("projectIdPreview");
export const createProjectAlert = byId("createProjectAlert");


// Project detail modal
export const modalProjectDetail = byId("modalProjectDetail");
export const btnCloseProjectDetail = byId("btnCloseProjectDetail");
export const btnCancelProjectDetail = byId("btnCancelProjectDetail");
export const projectDetailTitle = byId("projectDetailTitle");
export const projectDetailDescription = byId("projectDetailDescription");
export const projectDetailClient = byId("projectDetailClient");
export const projectDetailTeam = byId("projectDetailTeam");
export const projectDetailManager = byId("projectDetailManager");
export const projectDetailCoordinator = byId("projectDetailCoordinator");
export const projectDetailStatus = byId("projectDetailStatus");
export const projectDetailPriority = byId("projectDetailPriority");
export const projectDetailStartDate = byId("projectDetailStartDate");
export const projectDetailEndDate = byId("projectDetailEndDate");
export const projectDetailBillingValue = byId("projectDetailBillingValue");
export const projectDetailBillingHours = byId("projectDetailBillingHours");
export const projectDetailTechs = byId("projectDetailTechs");
export const projectDetailKeyUsers = byId("projectDetailKeyUsers");
export const projectDetailContract = byId("projectDetailContract");
export const projectDetailAlert = byId("projectDetailAlert");
export const projectWorkspaceTabs = byId("projectWorkspaceTabs");
export const projectWorkspacePanel = byId("projectWorkspacePanel");
export const btnCloseProjectWorkspace = byId("btnCloseProjectWorkspace");
export const btnOpenWorkspaceView = byId("btnOpenWorkspaceView");
export const btnOpenWorkspaceEdit = byId("btnOpenWorkspaceEdit");
export const btnDeleteWorkspaceProject = byId("btnDeleteWorkspaceProject");
export const projectWorkspaceTitle = byId("projectWorkspaceTitle");
export const projectWorkspaceSubtitle = byId("projectWorkspaceSubtitle");
export const projectWorkspaceBreadcrumb = byId("projectWorkspaceBreadcrumb");
export const projectWorkspaceCover = byId("projectWorkspaceCover");
export const btnOpenTaskForm = byId("btnOpenTaskForm");
export const projectTaskFormWrap = byId("projectTaskFormWrap");
export const taskNameInput = byId("taskNameInput");
export const taskStartDateInput = byId("taskStartDateInput");
export const taskEndDateInput = byId("taskEndDateInput");
export const taskPlannedHoursInput = byId("taskPlannedHoursInput");
export const btnCancelTaskForm = byId("btnCancelTaskForm");
export const btnSaveTask = byId("btnSaveTask");
export const projectTaskAlert = byId("projectTaskAlert");
export const projectTaskList = byId("projectTaskList");
export const btnEditProject = byId("btnEditProject");
export const btnDeleteProject = byId("btnDeleteProject");

// Edit project modal
export const modalEditProject = byId("modalEditProject");
export const btnCloseEditProject = byId("btnCloseEditProject");
export const btnCancelEditProject = byId("btnCancelEditProject");
export const btnUpdateProject = byId("btnUpdateProject");
export const editProjectNameEl = byId("editProjectName");
export const editProjectDescriptionEl = byId("editProjectDescription");
export const editProjectContractFileEl = byId("editProjectContractFile");
export const editProjectContractFileNameEl = byId("editProjectContractFileName");
export const btnRemoveEditProjectContract = byId("btnRemoveEditProjectContract");
export const editProjectClientEl = byId("editProjectClient");
export const editProjectTeamEl = byId("editProjectTeam");
export const editProjectManagerEl = byId("editProjectManager");
export const editProjectCoordinatorEl = byId("editProjectCoordinator");
export const editProjectStatusEl = byId("editProjectStatus");
export const editProjectPriorityEl = byId("editProjectPriority");
export const editProjectStartDateEl = byId("editProjectStartDate");
export const editProjectEndDateEl = byId("editProjectEndDate");
export const editProjectBillingValueAmountEl = byId("editProjectBillingValueAmount");
export const editProjectBillingHoursAmountEl = byId("editProjectBillingHoursAmount");
export const editProjectTechSelectEl = byId("editProjectTechSelect");
export const editProjectTechChipsEl = byId("editProjectTechChips");
export const editProjectKeyUsersEl = byId("editProjectKeyUsers");
export const editProjectAlert = byId("editProjectAlert");



// Feedback Técnico
export const modalTechFeedback = byId("modalTechFeedback");
export const btnCloseTechFeedback = byId("btnCloseTechFeedback");
export const btnCancelTechFeedback = byId("btnCancelTechFeedback");
export const btnSaveTechFeedback = byId("btnSaveTechFeedback");
export const techFeedbackSubtitle = byId("techFeedbackSubtitle");
export const techFeedbackDate = byId("techFeedbackDate");
export const techFeedbackScore = byId("techFeedbackScore");
export const techFeedbackNote = byId("techFeedbackNote");
export const techFeedbackAlert = byId("techFeedbackAlert");
export const techFeedbackList = byId("techFeedbackList");
