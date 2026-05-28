import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

let supabase;
let savingOrder = false;
let editingOrderID = null;
let openedOrder = null;
let openedCatalogItem = null;
let openedClient = null;
let scannerMode = "order";
let scannerStream = null;
let scannerTimer = null;
let toastTimer = null;

const state = {
  clients: [],
  vehicles: [],
  catalog: [],
  employees: [],
  orders: [],
  orderLines: [],
  payments: [],
  lines: []
};

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(Number(value) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const toISO = (dateValue) => new Date(`${dateValue}T12:00:00`).toISOString();
const numberValue = (value) => Number(String(value || "0").replace(",", ".")) || 0;

function groupBy(rows, keyProvider) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyProvider(row);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  });
  return map;
}

document.addEventListener("DOMContentLoaded", () => {
  restoreSettings();
  $("orderDate").value = today();
  bindEvents();
});

function bindEvents() {
  $("loginForm").addEventListener("submit", login);
  $("syncButton").addEventListener("click", loadAll);
  $("newOrderButton").addEventListener("click", newOrder);
  $("masterModeButton").addEventListener("click", toggleMasterMode);
  $("saveOrderButton").addEventListener("click", saveOrder);
  $("addLineButton").addEventListener("click", openLineDialog);
  $("scanToOrderButton").addEventListener("click", () => openScanner("order"));
  $("orderClient").addEventListener("change", fillOrderVehicleFromClient);
  $("confirmLineButton").addEventListener("click", addLineFromDialog);
  $("lineCategory").addEventListener("change", fillLineItems);
  $("lineSearch").addEventListener("input", fillLineItems);
  $("lineItem").addEventListener("change", fillLinePrice);
  $("scanLineButton").addEventListener("click", () => openScanner("line"));
  $("clientForm").addEventListener("submit", saveClient);
  $("catalogForm").addEventListener("submit", saveCatalogItem);
  $("scanCatalogButton").addEventListener("click", () => openScanner("catalogCreate"));
  $("clientSearch").addEventListener("input", renderClients);
  $("catalogSearch").addEventListener("input", renderCatalog);
  $("orderSearch").addEventListener("input", renderOrders);
  $("orderStatusFilter").addEventListener("change", renderOrders);
  $("closeOrderDialog").addEventListener("click", () => $("orderDialog").close());
  $("editOrderButton").addEventListener("click", editOpenedOrder);
  $("payOrderButton").addEventListener("click", () => openPaymentDialog(openedOrder));
  $("deleteOrderButton").addEventListener("click", deleteOpenedOrder);
  $("confirmPaymentButton").addEventListener("click", addPayment);
  $("saveCatalogEditButton").addEventListener("click", saveCatalogEdit);
  $("scanCatalogEditButton").addEventListener("click", () => openScanner("catalogEdit"));
  $("receiptButton").addEventListener("click", addReceipt);
  $("closeClientDialog").addEventListener("click", () => $("clientDialog").close());
  $("closeClientDialogBottom").addEventListener("click", () => $("clientDialog").close());
  $("newClientOrderButton").addEventListener("click", createOrderForOpenedClient);
  $("closeScannerButton").addEventListener("click", closeScanner);
  $("stopScannerButton").addEventListener("click", closeScanner);
  $("manualBarcodeButton").addEventListener("click", () => handleScannedBarcode($("manualBarcode").value.trim()));
  document.querySelectorAll(".tabbar button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
}

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
  toast("Вход выполнен", "success");
}

async function loadAll() {
  try {
    const [clients, vehicles, catalog, employees, orders, orderLines, payments] = await Promise.all([
      query("clients", "id,full_name,phone"),
      query("vehicles", "*"),
      query("catalog_items", "*"),
      query("employees", "*"),
      query("work_orders", "*"),
      query("order_lines", "*"),
      query("payments", "*")
    ]);
    state.clients = clients.sort((a, b) => a.id.localeCompare(b.id));
    state.vehicles = vehicles;
    state.catalog = catalog.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    state.employees = employees.filter((employee) => employee.is_active).sort((a, b) => a.name.localeCompare(b.name));
    state.orderLines = orderLines;
    const linesByOrder = Map.groupBy ? Map.groupBy(orderLines, (line) => line.order_id) : groupBy(orderLines, (line) => line.order_id);
    state.orders = orders
      .map((order) => ({ ...order, lines: linesByOrder.get(order.id) || [] }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    state.payments = payments.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    fillSelectors();
    renderClients();
    renderCatalog();
    renderOrders();
    renderLines();
    toast("Синхронизировано", "success");
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
  if (!$("orderVehicle").value) fillOrderVehicleFromClient();
  if (!$("orderNumber").value) $("orderNumber").value = nextOrderNumber();
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
  $("viewTitle").textContent = { orderView: "Заказ", clientsView: "Клиенты", catalogView: "Товары", savedView: "Заказы" }[viewID];
}

function newOrder() {
  editingOrderID = null;
  state.lines = [];
  $("orderDate").value = today();
  $("orderVehicle").value = "";
  $("orderMileage").value = "";
  $("orderComment").value = "";
  $("orderEmployee").value = "";
  $("orderStatus").value = "accepted";
  $("orderNumber").value = nextOrderNumber();
  fillOrderVehicleFromClient();
  renderLines();
  $("saveOrderButton").textContent = "Сохранить";
}

function nextOrderNumber() {
  const maxNumber = Math.max(0, ...state.orders.map((order) => Number(order.number) || 0));
  return String(maxNumber + 1).padStart(4, "0");
}

function toggleMasterMode() {
  $("orderView").classList.toggle("master-mode");
}

function fillOrderVehicleFromClient() {
  const vehicle = state.vehicles.find((row) => row.client_id === $("orderClient").value);
  $("orderVehicle").value = vehicle ? [vehicle.make, vehicle.vin].filter(Boolean).join(" / VIN ") : "";
  if (vehicle?.mileage) $("orderMileage").value = vehicle.mileage;
}

function openLineDialog() {
  $("lineSearch").value = "";
  $("lineQuantity").value = "1";
  fillLineItems();
  $("lineDialog").showModal();
}

function fillLineItems() {
  const category = $("lineCategory").value;
  const search = $("lineSearch").value.trim().toLowerCase();
  const rows = state.catalog.filter((item) => item.category === category && catalogMatches(item, search));
  fillSelect($("lineItem"), rows, catalogOptionTitle, (item) => item.id);
  fillLinePrice();
}

function fillLinePrice() {
  const item = state.catalog.find((row) => row.id === $("lineItem").value);
  $("linePrice").value = item ? Number(item.price || 0).toFixed(2) : "0";
}

function addLineFromDialog(event) {
  event.preventDefault();
  const item = state.catalog.find((row) => row.id === $("lineItem").value);
  if (!item) return;
  addCatalogItemToOrder(item, numberValue($("lineQuantity").value), numberValue($("linePrice").value));
  $("lineDialog").close();
}

function addCatalogItemToOrder(item, quantity = 1, price = Number(item.price || 0)) {
  state.lines.push({
    id: crypto.randomUUID(),
    category: item.category,
    item_id: item.id,
    name: item.name,
    quantity,
    price,
    discount: 0,
    purchase_price: Number(item.purchase_price || 0)
  });
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
  if (savingOrder) return;
  if (!state.lines.length) return toast("Добавь позиции");
  const client = state.clients.find((row) => row.id === $("orderClient").value);
  if (!client) return toast("Выбери клиента");
  const number = $("orderNumber").value.trim();
  if (!number) return toast("Заполни номер");
  if (state.orders.some((order) => order.number === number && order.id !== editingOrderID)) {
    toast(`Заказ №${number} уже есть`);
    return;
  }
  const employee = state.employees.find((row) => row.id === $("orderEmployee").value);
  const orderID = editingOrderID || crypto.randomUUID();
  const order = {
    id: orderID,
    number,
    date: toISO($("orderDate").value),
    client_id: client.id,
    client_name: client.full_name,
    client_phone: client.phone || "",
    vehicle_make: $("orderVehicle").value.trim(),
    vehicle_vin: vehicleVINFromText($("orderVehicle").value),
    mileage: $("orderMileage").value.trim(),
    comment: $("orderComment").value.trim(),
    status: $("orderStatus").value || "accepted",
    employee_id: employee?.id || null,
    employee_name: employee?.name || ""
  };
  const lines = state.lines.map((line) => ({ ...line, id: crypto.randomUUID(), order_id: orderID }));
  savingOrder = true;
  $("saveOrderButton").disabled = true;
  $("saveOrderButton").textContent = "Сохраняю";
  try {
    if (editingOrderID) {
      const { error: orderError } = await supabase.from("work_orders").update(order).eq("id", orderID);
      if (orderError) return toast(orderError.message);
      const { error: deleteLinesError } = await supabase.from("order_lines").delete().eq("order_id", orderID);
      if (deleteLinesError) return toast(deleteLinesError.message);
    } else {
      const { error: orderError } = await supabase.from("work_orders").insert(order);
      if (orderError) return toast(orderError.message);
    }
    const { error: linesError } = await supabase.from("order_lines").insert(lines);
    if (linesError) {
      if (!editingOrderID) await supabase.from("work_orders").delete().eq("id", orderID);
      return toast(linesError.message);
    }
    await loadAll();
    newOrder();
    showView("savedView");
    toast(`Заказ №${order.number} сохранен`, "success");
  } finally {
    savingOrder = false;
    $("saveOrderButton").disabled = false;
    $("saveOrderButton").textContent = editingOrderID ? "Обновить" : "Сохранить";
  }
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
      id: crypto.randomUUID(),
      client_id: id,
      make: $("vehicleMake").value.trim(),
      vin: $("vehicleVin").value.trim()
    });
    if (vehicleError) return toast(vehicleError.message);
  }
  event.target.reset();
  await loadAll();
  toast("Клиент создан", "success");
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
  toast("Позиция создана", "success");
}

function renderClients() {
  $("clientsList").innerHTML = "";
  const search = $("clientSearch").value.trim().toLowerCase();
  state.clients.filter((client) => clientMatches(client, search)).slice(0, 100).forEach((client) => {
    const vehicles = state.vehicles.filter((row) => row.client_id === client.id);
    const vehicleText = vehicles.map((vehicle) => [vehicle.make, vehicle.vin].filter(Boolean).join(" / ")).filter(Boolean).join(" · ");
    const row = document.createElement("button");
    row.className = "item clickable item-button";
    row.type = "button";
    row.innerHTML = `<strong>${client.id} · ${escapeHTML(client.full_name)}</strong><div class="meta">${escapeHTML(client.phone || "")}${vehicleText ? ` · ${escapeHTML(vehicleText)}` : ""}</div>`;
    row.addEventListener("click", () => openClientCard(client));
    $("clientsList").append(row);
  });
}

function renderCatalog() {
  $("catalogList").innerHTML = "";
  const search = $("catalogSearch").value.trim().toLowerCase();
  state.catalog.filter((item) => catalogMatches(item, search)).slice(0, 150).forEach((item) => {
    const row = document.createElement("button");
    row.className = "item clickable item-button";
    row.type = "button";
    row.innerHTML = `
      <strong>${escapeHTML(item.name || "")}</strong>
      <div class="meta">${categoryTitle(item.category)} · ID ${escapeHTML(item.display_id || "-")} · ${money(item.price)} · Остаток ${Number(item.stock || 0)}</div>
      <div class="meta">${escapeHTML([item.part_numbers, item.barcode].filter(Boolean).join(" · "))}</div>
    `;
    row.addEventListener("click", () => openCatalogCard(item));
    $("catalogList").append(row);
  });
}

function renderOrders() {
  $("ordersList").innerHTML = "";
  const search = $("orderSearch").value.trim().toLowerCase();
  const status = $("orderStatusFilter").value;
  state.orders.filter((order) => orderMatches(order, search, status)).slice(0, 120).forEach((order) => {
    const paid = paidTotal(order.id);
    const left = Math.max(0, orderTotal(order) - paid);
    const row = document.createElement("button");
    row.className = "item clickable item-button";
    row.type = "button";
    row.innerHTML = `
      <strong>№ ${escapeHTML(order.number)} · ${escapeHTML(order.client_name)}</strong>
      <div class="meta">${new Date(order.date).toLocaleDateString("ru-RU")} · ${statusTitle(order.status)} · ${escapeHTML(order.vehicle_make || "")}</div>
      <div class="meta">Итого ${money(orderTotal(order))} · оплачено ${money(paid)} · осталось ${money(left)}</div>
    `;
    row.addEventListener("click", () => openOrderDetails(order));
    $("ordersList").append(row);
  });
}

async function openOrderDetails(order) {
  openedOrder = order;
  const lines = await fetchOrderLines(order.id);
  openedOrder.lines = lines;
  $("orderDialogTitle").textContent = `Заказ №${order.number}`;
  $("orderDialogInfo").innerHTML = `
    <div><span>Дата</span><strong>${new Date(order.date).toLocaleDateString("ru-RU")}</strong></div>
    <div><span>Клиент</span><strong>${escapeHTML(order.client_name || "")}</strong></div>
    <div><span>Телефон</span><strong>${escapeHTML(order.client_phone || "")}</strong></div>
    <div><span>Техника</span><strong>${escapeHTML(order.vehicle_make || "")}</strong></div>
    <div><span>Пробег</span><strong>${escapeHTML(order.mileage || "")}</strong></div>
    <div><span>Статус</span><strong>${statusTitle(order.status)}</strong></div>
  `;
  $("orderDialogLines").innerHTML = "";
  lines.forEach((line) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<strong>${escapeHTML(line.name || "")}</strong><div class="meta">${categoryTitle(line.category)} · ${Number(line.quantity || 0)} × ${money(line.price)} · скидка ${Number(line.discount || 0)}% · ${money(lineTotal(line))}</div>`;
    $("orderDialogLines").append(row);
  });
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const paid = paidTotal(order.id);
  $("orderDialogTotal").textContent = money(total);
  $("orderDialogPayments").innerHTML = `
    <div><span>Оплачено</span><strong>${money(paid)}</strong></div>
    <div><span>Осталось</span><strong>${money(Math.max(0, total - paid))}</strong></div>
  `;
  $("orderDialog").showModal();
}

async function fetchOrderLines(orderID) {
  const { data, error } = await supabase.from("order_lines").select("*").eq("order_id", orderID).is("deleted_at", null).order("created_at", { ascending: true });
  if (error) {
    toast(error.message);
    return [];
  }
  return data || [];
}

function editOpenedOrder() {
  if (!openedOrder) return;
  editingOrderID = openedOrder.id;
  state.lines = (openedOrder.lines || []).map((line) => ({ ...line }));
  $("orderNumber").value = openedOrder.number || "";
  $("orderDate").value = String(openedOrder.date || "").slice(0, 10) || today();
  $("orderClient").value = openedOrder.client_id || "";
  $("orderVehicle").value = openedOrder.vehicle_make || "";
  $("orderMileage").value = openedOrder.mileage || "";
  $("orderComment").value = openedOrder.comment || "";
  $("orderEmployee").value = openedOrder.employee_id || "";
  $("orderStatus").value = openedOrder.status || "accepted";
  $("saveOrderButton").textContent = "Обновить";
  renderLines();
  $("orderDialog").close();
  showView("orderView");
}

async function deleteOpenedOrder() {
  if (!openedOrder) return;
  if (!confirm(`Удалить заказ №${openedOrder.number}?`)) return;
  const deletedAt = new Date().toISOString();
  const { error } = await supabase.from("work_orders").update({ deleted_at: deletedAt }).eq("id", openedOrder.id);
  if (error) return toast(error.message);
  await supabase.from("order_lines").update({ deleted_at: deletedAt }).eq("order_id", openedOrder.id);
  $("orderDialog").close();
  await loadAll();
  toast("Заказ удален", "success");
}

function openPaymentDialog(order) {
  if (!order) return;
  const total = order.lines ? order.lines.reduce((sum, line) => sum + lineTotal(line), 0) : orderTotal(order);
  $("paymentTitle").textContent = `Оплата №${order.number}`;
  $("paymentAmount").value = Math.max(0, total - paidTotal(order.id)).toFixed(0);
  $("paymentComment").value = "";
  $("paymentDialog").showModal();
}

async function addPayment(event) {
  event.preventDefault();
  if (!openedOrder) return;
  const amount = numberValue($("paymentAmount").value);
  if (amount <= 0) return toast("Введите сумму оплаты");
  const { error } = await supabase.from("payments").insert({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    order_id: openedOrder.id,
    order_number: openedOrder.number,
    client_id: openedOrder.client_id,
    client_name: openedOrder.client_name,
    amount,
    comment: $("paymentComment").value.trim()
  });
  if (error) return toast(error.message);
  $("paymentDialog").close();
  await loadAll();
  toast("Оплата добавлена", "success");
}

function openCatalogCard(item) {
  openedCatalogItem = item;
  $("catalogDialogTitle").textContent = item.name || "Товар";
  $("editCatalogName").value = item.name || "";
  $("editCatalogPrice").value = Number(item.price || 0).toFixed(2);
  $("editCatalogPurchase").value = Number(item.purchase_price || 0).toFixed(2);
  $("editCatalogStock").value = Number(item.stock || 0);
  $("editCatalogMinStock").value = Number(item.min_stock || 0);
  $("editCatalogBarcode").value = item.barcode || "";
  $("editCatalogGroup").value = item.item_group || "";
  $("editCatalogPartNumbers").value = item.part_numbers || "";
  $("editCatalogPhoto").value = item.photo_path || "";
  $("receiptQuantity").value = "";
  $("receiptPurchase").value = Number(item.purchase_price || 0).toFixed(2);
  $("catalogDialog").showModal();
}

async function saveCatalogEdit(event) {
  event.preventDefault();
  if (!openedCatalogItem) return;
  const patch = {
    name: $("editCatalogName").value.trim(),
    price: numberValue($("editCatalogPrice").value),
    purchase_price: numberValue($("editCatalogPurchase").value),
    stock: numberValue($("editCatalogStock").value),
    min_stock: numberValue($("editCatalogMinStock").value),
    barcode: $("editCatalogBarcode").value.trim(),
    item_group: $("editCatalogGroup").value.trim(),
    part_numbers: $("editCatalogPartNumbers").value.trim(),
    photo_path: $("editCatalogPhoto").value.trim()
  };
  const { error } = await supabase.from("catalog_items").update(patch).eq("id", openedCatalogItem.id);
  if (error) return toast(error.message);
  $("catalogDialog").close();
  await loadAll();
  toast("Товар сохранен", "success");
}

async function addReceipt() {
  if (!openedCatalogItem) return;
  const quantity = numberValue($("receiptQuantity").value);
  if (quantity <= 0) return toast("Введите количество прихода");
  const purchase = numberValue($("receiptPurchase").value);
  const stock = Number(openedCatalogItem.stock || 0) + quantity;
  const { error } = await supabase.from("catalog_items").update({ stock, purchase_price: purchase || openedCatalogItem.purchase_price || 0 }).eq("id", openedCatalogItem.id);
  if (error) return toast(error.message);
  await supabase.from("stock_movements").insert({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    item_id: openedCatalogItem.id,
    category: openedCatalogItem.category,
    item_name: openedCatalogItem.name,
    item_display_id: openedCatalogItem.display_id || "",
    barcode: openedCatalogItem.barcode || "",
    movement_type: "receipt",
    quantity,
    balance_after: stock,
    price: openedCatalogItem.price || 0,
    purchase_price: purchase,
    order_number: "",
    comment: "Приход с телефона"
  });
  $("catalogDialog").close();
  await loadAll();
  toast("Приход добавлен", "success");
}

function openClientCard(client) {
  openedClient = client;
  const vehicles = state.vehicles.filter((vehicle) => vehicle.client_id === client.id);
  const orders = state.orders.filter((order) => order.client_id === client.id);
  $("clientDialogTitle").textContent = `${client.id} · ${client.full_name}`;
  $("clientDialogInfo").innerHTML = `
    <div><span>Телефон</span><strong>${escapeHTML(client.phone || "")}</strong></div>
    <div><span>Долг</span><strong>${money(orders.reduce((sum, order) => sum + Math.max(0, orderTotal(order) - paidTotal(order.id)), 0))}</strong></div>
  `;
  $("clientDialogVehicles").innerHTML = "";
  vehicles.forEach((vehicle) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<strong>${escapeHTML(vehicle.make || "")}</strong><div class="meta">${escapeHTML([vehicle.vin, vehicle.plate, vehicle.mileage].filter(Boolean).join(" · "))}</div>`;
    $("clientDialogVehicles").append(row);
  });
  $("clientDialogOrders").innerHTML = "";
  orders.forEach((order) => {
    const row = document.createElement("button");
    row.className = "item clickable item-button";
    row.type = "button";
    row.innerHTML = `<strong>№ ${escapeHTML(order.number)}</strong><div class="meta">${new Date(order.date).toLocaleDateString("ru-RU")} · ${statusTitle(order.status)} · ${money(orderTotal(order))}</div>`;
    row.addEventListener("click", () => {
      $("clientDialog").close();
      openOrderDetails(order);
    });
    $("clientDialogOrders").append(row);
  });
  $("clientDialog").showModal();
}

function createOrderForOpenedClient() {
  if (!openedClient) return;
  $("clientDialog").close();
  newOrder();
  $("orderClient").value = openedClient.id;
  fillOrderVehicleFromClient();
  showView("orderView");
}

async function openScanner(mode) {
  scannerMode = mode;
  $("manualBarcode").value = "";
  $("scannerDialog").showModal();
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    toast("Камера недоступна, введи штрихкод вручную");
    return;
  }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    $("scannerVideo").srcObject = scannerStream;
    await $("scannerVideo").play();
    const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code"] });
    scannerTimer = setInterval(async () => {
      const codes = await detector.detect($("scannerVideo"));
      if (codes.length) handleScannedBarcode(codes[0].rawValue);
    }, 700);
  } catch {
    toast("Камера недоступна, введи штрихкод вручную");
  }
}

function closeScanner() {
  if (scannerTimer) clearInterval(scannerTimer);
  scannerTimer = null;
  if (scannerStream) scannerStream.getTracks().forEach((track) => track.stop());
  scannerStream = null;
  $("scannerDialog").close();
}

function handleScannedBarcode(code) {
  if (!code) return;
  const item = state.catalog.find((row) => String(row.barcode || "") === String(code));
  if (!item) {
    if (scannerMode === "catalogCreate") {
      $("catalogBarcode").value = code;
      closeScanner();
      toast("Штрихкод добавлен", "success");
      return;
    }
    if (scannerMode === "catalogEdit") {
      $("editCatalogBarcode").value = code;
      closeScanner();
      toast("Штрихкод добавлен", "success");
      return;
    }
    toast("Товар не найден");
    return;
  }
  closeScanner();
  if (scannerMode === "line") {
    $("lineSearch").value = code;
    fillLineItems();
  } else if (scannerMode === "catalogCreate") {
    $("catalogBarcode").value = code;
    $("catalogName").value = $("catalogName").value || item.name || "";
    toast("Товар найден, штрихкод добавлен", "success");
  } else if (scannerMode === "catalogEdit") {
    $("editCatalogBarcode").value = code;
    toast("Штрихкод добавлен", "success");
  } else {
    addCatalogItemToOrder(item);
    toast("Товар добавлен", "success");
  }
}

function nextDisplayID(category) {
  const max = Math.max(0, ...state.catalog.filter((item) => item.category === category).map((item) => Number(item.display_id) || 0));
  return String(max + 1).padStart(4, "0");
}

function generatedBarcode(category, displayID) {
  const prefix = category === "consumables" ? "22" : "21";
  return prefix + String(Number(displayID) || 0).padStart(8, "0");
}

function catalogMatches(item, search) {
  if (!search) return true;
  return [item.name, item.display_id, item.part_numbers, item.barcode, item.item_group, categoryTitle(item.category)].some((value) => String(value || "").toLowerCase().includes(search));
}

function catalogOptionTitle(item) {
  const code = item.barcode || item.part_numbers || item.display_id || "";
  return [item.name, code].filter(Boolean).join(" · ");
}

function clientMatches(client, search) {
  if (!search) return true;
  const vehicles = state.vehicles.filter((vehicle) => vehicle.client_id === client.id);
  return [client.id, client.full_name, client.phone, ...vehicles.flatMap((vehicle) => [vehicle.make, vehicle.vin, vehicle.plate])].some((value) => String(value || "").toLowerCase().includes(search));
}

function orderMatches(order, search, status) {
  if (status === "not_paid" && paidTotal(order.id) >= orderTotal(order)) return false;
  if (status && status !== "not_paid" && order.status !== status) return false;
  if (!search) return true;
  return [order.number, order.client_name, order.client_phone, order.vehicle_make, order.mileage].some((value) => String(value || "").toLowerCase().includes(search));
}

function orderTotal(order) {
  return (order.lines || []).reduce((sum, line) => sum + lineTotal(line), 0);
}

function paidTotal(orderID) {
  return state.payments.filter((payment) => payment.order_id === orderID).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function vehicleVINFromText(text) {
  const match = String(text || "").match(/VIN\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function categoryTitle(category) {
  return { parts: "Запчасти", labor: "Работы", consumables: "Расходники" }[category] || category;
}

function statusTitle(status) {
  return { accepted: "Принято", in_progress: "В работе", ready: "Готов", closed: "Закрыт" }[status] || status;
}

function toast(message, type = "") {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = `toast ${type}`.trim();
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 3800);
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
