// FlowProject - Router simples (SPA)
// Mantém o app em 1 página (index.html), alternando views por id.

import { show, hide } from "../utils/dom.js";

const ids = {
  sidebar: "sidebar",
  viewLogin: "viewLogin",
  viewDashboard: "viewDashboard",
  viewAdmin: "viewAdmin",
  viewCompanies: "viewCompanies",
  viewManagerUsers: "viewManagerUsers",
};

function el(id){ return document.getElementById(id); }

export function setView(name){
  const sidebar = el(ids.sidebar);
  const viewLogin = el(ids.viewLogin);
  const viewDashboard = el(ids.viewDashboard);
  const viewAdmin = el(ids.viewAdmin);
  const viewCompanies = el(ids.viewCompanies);
  const viewManagerUsers = el(ids.viewManagerUsers);

  hide(viewLogin);
  hide(viewDashboard);
  hide(viewAdmin);
  hide(viewCompanies);
  hide(viewManagerUsers);

  if (name === "login"){
    document.body.classList.add("is-login");
    hide(sidebar);
  } else {
    document.body.classList.remove("is-login");
    show(sidebar);
  }

  if (name === "login") show(viewLogin);
  if (name === "dashboard") show(viewDashboard);
  if (name === "admin") show(viewAdmin);
  if (name === "companies") show(viewCompanies);
  if (name === "managerUsers") show(viewManagerUsers);
}
