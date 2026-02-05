// public/src/ui/refs.js
// Centraliza document.getElementById em um só lugar.

const byId = (id) => document.getElementById(id);

// Views
export const viewLogin = byId("viewLogin");
export const viewDashboard = byId("viewDashboard");
export const viewAdmin = byId("viewAdmin");
export const viewCompanies = byId("viewCompanies");
export const viewManagerUsers = byId("viewManagerUsers");

// Sidebar
export const sidebar = byId("sidebar");
export const btnToggleSidebar = byId("btnToggleSidebar");
export const navHome = byId("navHome");
export const navAddProject = byId("navAddProject");
export const navAddTech = byId("navAddTech");
export const navReports = byId("navReports");
export const navConfig = byId("navConfig");
export const navLogout = byId("navLogout");

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

// Users
export const usersTbody = byId("usersTbody");
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
export const teamChipsEl = byId("teamChips");
export const createUserAlert = byId("createUserAlert");

// Gestor
export const btnBackFromManagerUsers = byId("btnBackFromManagerUsers");
export const btnOpenCreateTech = byId("btnOpenCreateTech");
export const mgrUserSearch = byId("mgrUserSearch");
export const mgrTeamFilter = byId("mgrTeamFilter");
export const btnReloadMgrUsers = byId("btnReloadMgrUsers");
export const mgrUsersTbody = byId("mgrUsersTbody");
export const mgrUsersEmpty = byId("mgrUsersEmpty");

// Create tech modal
export const modalCreateTech = byId("modalCreateTech");
export const btnCloseCreateTech = byId("btnCloseCreateTech");
export const btnCancelCreateTech = byId("btnCancelCreateTech");
export const btnCreateTech = byId("btnCreateTech");
export const techUidEl = byId("techUid");
export const techNameEl = byId("techName");
export const techEmailEl = byId("techEmail");
export const techPhoneEl = byId("techPhone");
export const techActiveEl = byId("techActive");
export const mgrTeamChipsEl = byId("mgrTeamChips");
export const createTechAlert = byId("createTechAlert");

// Managed teams modal
export const modalManagedTeams = byId("modalManagedTeams");
export const managedTeamsSubtitle = byId("managedTeamsSubtitle");
export const managedTeamsChips = byId("managedTeamsChips");
export const managedTeamsAlert = byId("managedTeamsAlert");
export const btnCloseManagedTeams = byId("btnCloseManagedTeams");
export const btnCancelManagedTeams = byId("btnCancelManagedTeams");
export const btnSaveManagedTeams = byId("btnSaveManagedTeams");
