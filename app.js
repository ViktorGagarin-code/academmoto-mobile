import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let supabase;
let state = {
  clients: [],
  vehicles: [],
  catalog: [],
  employees: [],
  orders: [],
  lines: []
};

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(Number(value) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const toISO = (dateValue) => new Date(`${dateValue}T12:00:00`).toISOString();
const numberValue = (value) => Number(String(value || "0").replace(",", ".")) || 0;

document.addEventListener("DOMContentLoaded", () => {
  restoreSettings();
  $("orderDate").value = today();
  $("loginForm").addEventListener("submit", login);
  $("syncButton").addEventListener("click", loadAll);
  $("newOrderButton").addEventListener("click", newOrder);
  $("saveOrderButton").addEventListener("click", saveOrder);
  $("addLineButton").addEventListener("click", openLineDialog);
  $("confirmLineButton").addEventListener("click", addLine);
  $("lineCategory").addEventListener("change", fillLineItems);
  $("lineItem").addEventListener("change", fillLinePrice);
  $("clientForm").addEventListener("submit", saveClient);
  $("catalogForm").addEventListener("submit", saveCatalogItem);
  document.querySelectorAll(".tabbar button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
});

function restoreSettings() {
  $("supabaseUrl").value = localStorage.getItem("academmoto.supabaseUrl") || $("supabaseUrl").value;
  $("supabaseKey").value = localStorage.getItem("academmoto.supabaseKey") || $("supabaseKey").value;
  $("email").value = localStorage.getItem("academmoto.email") || $("email").value;
}

async function login(event) {
  event.preventDefault();
  $("loginError").textContent = "";
  const url = $("supabaseUrl").value.trim();
  const key = $("supabaseKey").value.trim();
  localStorage.setItem("academmoto.supabaseUrl", url);
  localStorage.setItem("academmoto.supabaseKey", key);
  localStorage.setItem("academmoto.email", $("email").value.trim());
  supabase = createClient(url, key);
  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });
  if (error) {
    $("loginError").textContent = error.message;
    return;
  }
  $("loginView").classList.add("hidden");
  $("mainView").classList.remove("hidden");
  await loadAll();
  toast("Вход выполнен");
}

async function loadAll() {
  try {
    const [clients, vehicles, catalog, employees, orders] = await Promise.all([
      query("clients", "id,full_name,phone"),
      query("vehicles", "*"),
      query("catalog_items", "*"),
      query("employees", "*"),
      query("work_orders", "*")
    ]);
    state.clients = clients.sort((a, b) => a.id.localeCompare(b.id));
    state.vehicles = vehicles;
    state.catalog = catalog.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    state.employees = employees.filter((employee) => employee.is_active).sort((a, b) => a.name.localeCompare(b.name));
    state.orders = orders.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    fillSelectors();
    renderClients();
    renderOrders();
    renderLines();
    toast("Синхронизировано");
  } catch (error) {
    toast(error.message);
  }
}

async function query(table, select) {
  const { data, error } = await supabase.from(table).select(select).is("deleted_at", null);
  if (error) throw error;
  return data || [];
}

function fillSelectors() {
  fillSelect($("orderClient"), state.clients, (client) => `${client.id} — ${client.full_name}`, (client) => client.id);
  fillSelect($("orderEmployee"), [{ id: "", name: "Не выбран" }, ...state.employees], (employee) => employee.name, (employee) => employee.id);
  fillLineItems();
  const maxNumber = Math.max(0, ...state.orders.map((order) => Number(order.number) || 0));
  if (!$("orderNumber").value) $("orderNumber").value = String(maxNumber + 1).padStart(4, "0");
}

function fillSelect(select, rows, title, value) {
  select.innerHTML = "";
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = value(row);
    option.textContent = title(row);
    select.append(option);
  });
}

function showView(viewID) {
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  $(viewID).classList.remove("hidden");
  document.querySelectorAll(".tabbar button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewID));
  $("viewTitle").textContent = {
    orderView: "Заказ",
    clientsView: "Клиенты",
    catalogView: "Товары",
    savedView: "Заказы"
  }[viewID];
}

function newOrder() {
  state.lines = [];
  $("orderDate").value = today();
  $("orderVehicle").value = "";
  $("orderMileage").value = "";
  $("orderComment").value = "";
  $("orderEmployee").value = "";
  const maxNumber = Math.max(0, ...state.orders.map((order) => Number(order.number) || 0));
  $("orderNumber").value = String(maxNumber + 1).padStart(4, "0");
  renderLines();
}

function openLineDialog() {
  fillLineItems();
  $("lineDialog").showModal();
}

function fillLineItems() {
  const category = $("lineCategory").value;
  const rows = state.catalog.filter((item) => item.category === category && item.deleted_at == null);
  fillSelect($("lineItem"), rows, (item) => item.name, (item) => item.id);
  fillLinePrice();
}

function fillLinePrice() {
  const item = state.catalog.find((row) => row.id === $("lineItem").value);
  $("linePrice").value = item ? Number(item.price || 0).toFixed(2) : "0";
}

function addLine(event) {
  event.preventDefault();
  const item = state.catalog.find((row) => row.id === $("lineItem").value);
  if (!item) return;
  state.lines.push({
    id: crypto.randomUUID(),
    category: $("lineCategory").value,
    item_id: item.id,
    name: item.name,
    quantity: numberValue($("lineQuantity").value),
    price: numberValue($("linePrice").value),
    discount: 0,
    purchase_price: Number(item.purchase_price || 0)
  });
  $("lineDialog").close();
  renderLines();
}

function renderLines() {
  $("orderLines").innerHTML = "";
  state.lines.forEach((line, index) => {
    const row = document.createElement("div");
    row.className = "item line-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHTML(line.name)}</strong>
        <div class="meta">${categoryTitle(line.category)} · ${line.quantity} × ${money(line.price)} · ${money(lineTotal(line))}</div>
      </div>
      <button type="button">×</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      state.lines.splice(index, 1);
      renderLines();
    });
    $("orderLines").append(row);
  });
  $("orderTotal").textContent = money(state.lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

function lineTotal(line) {
  return (Number(line.quantity) || 0) * (Number(line.price) || 0) * (1 - (Number(line.discount) || 0) / 100);
}

async function saveOrder() {
  if (!state.lines.length) {
    toast("Добавь позиции");
    return;
  }
  const client = state.clients.find((row) => row.id === $("orderClient").value);
  if (!client) {
    toast("Выбери клиента");
    return;
  }
  const employee = state.employees.find((row) => row.id === $("orderEmployee").value);
  const orderID = crypto.randomUUID();
  const order = {
    id: orderID,
    number: $("orderNumber").value.trim(),
    date: toISO($("orderDate").value),
    client_id: client.id,
    client_name: client.full_name,
    client_phone: client.phone || "",
    vehicle_make: $("orderVehicle").value.trim(),
    vehicle_vin: "",
    mileage: $("orderMileage").value.trim(),
    comment: $("orderComment").value.trim(),
    status: "accepted",
    employee_id: employee?.id || null,
    employee_name: employee?.name || ""
  };
  const lines = state.lines.map((line) => ({ ...line, order_id: orderID }));
  const { error: orderError } = await supabase.from("work_orders").insert(order);
  if (orderError) return toast(orderError.message);
  const { error: linesError } = await supabase.from("order_lines").insert(lines);
  if (linesError) return toast(linesError.message);
  await loadAll();
  newOrder();
  toast("Заказ создан");
}

async function saveClient(event) {
  event.preventDefault();
  const id = $("clientId").value.trim();
  if (!id || !$("clientName").value.trim()) return toast("Заполни клиента");
  const { error } = await supabase.from("clients").upsert({
    id,
    full_name: $("clientName").value.trim(),
    phone: $("clientPhone").value.trim()
  });
  if (error) return toast(error.message);
  if ($("vehicleMake").value.trim() || $("vehicleVin").value.trim()) {
    const { error: vehicleError } = await supabase.from("vehicles").insert({
      client_id: id,
      make: $("vehicleMake").value.trim(),
      vin: $("vehicleVin").value.trim()
    });
    if (vehicleError) return toast(vehicleError.message);
  }
  event.target.reset();
  await loadAll();
  toast("Клиент создан");
}

async function saveCatalogItem(event) {
  event.preventDefault();
  const category = $("catalogCategory").value;
  const id = crypto.randomUUID();
  const displayID = $("catalogDisplayId").value.trim() || nextDisplayID(category);
  const barcode = $("catalogBarcode").value.trim() || generatedBarcode(category, displayID);
  const { error } = await supabase.from("catalog_items").insert({
    id,
    category,
    display_id: category === "labor" ? "" : displayID,
    part_numbers: category === "labor" ? "" : $("catalogPartNumbers").value.trim(),
    barcode: category === "labor" ? "" : barcode,
    item_group: $("catalogGroup").value.trim() || categoryTitle(category),
    name: $("catalogName").value.trim(),
    price: numberValue($("catalogPrice").value),
    purchase_price: category === "labor" ? 0 : numberValue($("catalogPurchase").value),
    stock: category === "labor" ? 0 : numberValue($("catalogStock").value),
    min_stock: 0,
    details: "",
    photo_path: ""
  });
  if (error) return toast(error.message);
  event.target.reset();
  $("catalogStock").value = "1";
  await loadAll();
  toast("Позиция создана");
}

function renderClients() {
  $("clientsList").innerHTML = "";
  state.clients.slice(0, 40).forEach((client) => {
    const vehicle = state.vehicles.find((row) => row.client_id === client.id);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<strong>${client.id} · ${escapeHTML(client.full_name)}</strong><div class="meta">${escapeHTML(client.phone || "")}${vehicle ? ` · ${escapeHTML(vehicle.make || "")}` : ""}</div>`;
    $("clientsList").append(row);
  });
}

function renderOrders() {
  $("ordersList").innerHTML = "";
  state.orders.slice(0, 60).forEach((order) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<strong>№ ${escapeHTML(order.number)} · ${escapeHTML(order.client_name)}</strong><div class="meta">${new Date(order.date).toLocaleDateString("ru-RU")} · ${statusTitle(order.status)} · ${escapeHTML(order.vehicle_make || "")}</div>`;
    $("ordersList").append(row);
  });
}

function nextDisplayID(category) {
  const max = Math.max(0, ...state.catalog.filter((item) => item.category === category).map((item) => Number(item.display_id) || 0));
  return String(max + 1).padStart(4, "0");
}

function generatedBarcode(category, displayID) {
  const prefix = category === "consumables" ? "22" : "21";
  return prefix + String(Number(displayID) || 0).padStart(8, "0");
}

function categoryTitle(category) {
  return { parts: "Запчасти", labor: "Работы", consumables: "Расходники" }[category] || category;
}

function statusTitle(status) {
  return { accepted: "Принято", in_progress: "В работе", ready: "Готов", closed: "Закрыт" }[status] || status;
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 2400);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
