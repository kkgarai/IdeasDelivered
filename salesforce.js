const API = "v67.0";
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isSalesforcePage(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host.endsWith(".lightning.force.com") ||
      host.endsWith(".my.salesforce.com") ||
      host.endsWith(".vf.force.com") ||
      host.endsWith(".cloudforce.com") ||
      host.endsWith(".my.salesforce-setup.com")
    );
  } catch {
    return false;
  }
}

export function pageContext(url) {
  const match = String(url || "").match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15,18})(?:\/|$)/);
  if (!match) return null;
  const page = new URL(url);
  const apiHost = page.hostname.includes(".lightning.force.com")
    ? page.hostname.replace(".lightning.force.com", ".my.salesforce.com")
    : page.hostname;
  return {
    objectApiName: match[1],
    recordId: match[2],
    apiBase: `https://${apiHost}`,
    pageUrl: url
  };
}

async function sessionId(pageUrl, apiBase) {
  const candidates = [`${apiBase}/`, pageUrl];
  for (const url of candidates) {
    const cookie = await chrome.cookies.get({ url, name: "sid" });
    if (cookie?.value) return cookie.value;
  }
  const all = await chrome.cookies.getAll({ name: "sid" });
  const org = new URL(apiBase).hostname.split(".")[0];
  const found = all.find((cookie) => cookie.domain.includes(org));
  return found?.value || "";
}

async function sf(ctx, path, options = {}) {
  const sid = await sessionId(ctx.pageUrl, ctx.apiBase);
  if (!sid) throw new Error("Salesforce session was not found. Reload the record page while you are signed in.");
  const response = await fetch(`${ctx.apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${sid}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = Array.isArray(body) ? body.map((row) => row.message).filter(Boolean).join(" ") : body?.message;
    throw new Error(message || `Salesforce returned ${response.status}`);
  }
  return body;
}

function ident(value, label) {
  if (!IDENT.test(value || "")) throw new Error(`${label} is not a field name.`);
  return value;
}

function soqlValue(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export async function currentUser(ctx) {
  const body = await sf(ctx, "/services/oauth2/userinfo");
  return body.user_id;
}

export async function relatedLists(ctx) {
  const body = await sf(ctx, `/services/data/${API}/ui-api/related-list-info/${ctx.objectApiName}`);
  return (body.relatedLists || [])
    .filter((list) => list.objectApiName && list.fieldApiName && IDENT.test(list.objectApiName) && IDENT.test(list.fieldApiName))
    .map((list) => ({
      id: list.relatedListId,
      label: list.label || list.entityLabelPlural || list.objectApiName,
      objectApiName: list.objectApiName,
      fieldApiName: list.fieldApiName
    }));
}

const describes = new Map();

async function describe(ctx, objectApiName) {
  ident(objectApiName, "Object");
  if (!describes.has(objectApiName)) {
    describes.set(objectApiName, sf(ctx, `/services/data/${API}/sobjects/${objectApiName}/describe`));
  }
  return describes.get(objectApiName);
}

export async function columnsFor(ctx, objectApiName, includeParent, wide) {
  const body = await describe(ctx, objectApiName);
  const usable = (body.fields || []).filter((field) => field.name !== "Id" && IDENT.test(field.name) && !field.deprecatedAndHidden);
  const name = usable.find((field) => field.nameField) || usable.find((field) => field.name === "Name");
  const rest = usable.filter((field) => field !== name);
  const limit = wide ? 12 : 6;
  const chosen = [];
  if (name) chosen.push(name);
  for (const field of rest) {
    if (chosen.length >= limit) break;
    chosen.push(field);
  }
  const columns = chosen.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    updateable: field.updateable === true && field.type !== "address" && field.type !== "location"
  }));
  if (includeParent) {
    const lookup = usable.find((field) => field.type === "reference" && field.relationshipName && IDENT.test(field.relationshipName));
    if (lookup) {
      columns.push({
        name: `${lookup.relationshipName}.Name`,
        label: `${lookup.label} name`,
        type: "string",
        updateable: false
      });
    }
  }
  return columns;
}

function cell(record, path) {
  const parts = path.split(".");
  let value = record;
  for (const part of parts) value = value == null ? null : value[part];
  if (value == null) return "";
  if (typeof value === "object") return value.Name || "";
  return value;
}

export async function loadList(ctx, request) {
  const child = ident(request.objectApiName, "Object");
  const parentField = ident(request.fieldApiName, "Lookup");
  const fields = ["Id", ...request.columns.map((column) => column.name)];
  const unique = [...new Set(fields)];
  let soql = `SELECT ${unique.join(", ")} FROM ${child} WHERE ${parentField} = '${ctx.recordId}'`;
  if (request.ownerId && request.mine) soql += ` AND OwnerId = '${request.ownerId}'`;
  if (request.serverFilter?.field && request.serverFilter.value != null && request.serverFilter.value !== "") {
    const field = ident(request.serverFilter.field, "Filter");
    soql += ` AND ${field} = ${soqlValue(request.serverFilter.value)}`;
  }
  if (request.followingIds?.length) {
    const ids = request.followingIds.filter((id) => /^[a-zA-Z0-9]{15,18}$/.test(id));
    if (!ids.length) return { rows: [], count: 0, totals: {} };
    soql += ` AND Id IN (${ids.map((id) => `'${id}'`).join(",")})`;
  }
  const sortField = request.sortField && unique.includes(request.sortField) ? request.sortField : unique[1] || "Id";
  const sortDir = request.sortDir === "DESC" ? "DESC" : "ASC";
  const limit = Math.min(Math.max(Number(request.limit) || 25, 1), 2000);
  const listed = await sf(ctx, `/services/data/${API}/query?q=${encodeURIComponent(`${soql} ORDER BY ${sortField} ${sortDir} LIMIT ${limit}`)}`);
  const counted = await sf(ctx, `/services/data/${API}/query?q=${encodeURIComponent(soql.replace(/^SELECT .+ FROM/, "SELECT COUNT() FROM"))}`);
  const totals = {};
  for (const column of request.totalFields || []) {
    const field = ident(column, "Total");
    const summed = await sf(
      ctx,
      `/services/data/${API}/query?q=${encodeURIComponent(soql.replace(/^SELECT .+ FROM/, `SELECT SUM(${field}) total FROM`))}`
    );
    totals[field] = summed.records?.[0]?.total ?? 0;
  }
  return {
    rows: (listed.records || []).map((record) => {
      const values = {};
      for (const name of unique) values[name] = cell(record, name);
      values.Id = record.Id;
      return values;
    }),
    count: counted.totalSize ?? 0,
    totals
  };
}

export async function followingIds(ctx, userId, objectApiName) {
  ident(objectApiName, "Object");
  const soql = `SELECT ParentId FROM EntitySubscription WHERE SubscriberId = '${userId}' AND Parent.Type = '${objectApiName}' LIMIT 200`;
  const body = await sf(ctx, `/services/data/${API}/query?q=${encodeURIComponent(soql)}`);
  return (body.records || []).map((row) => row.ParentId).filter(Boolean);
}

export async function saveField(ctx, objectApiName, recordId, field, value) {
  ident(objectApiName, "Object");
  ident(field, "Field");
  if (!/^[a-zA-Z0-9]{15,18}$/.test(recordId)) throw new Error("That record id is not valid.");
  await sf(ctx, `/services/data/${API}/sobjects/${objectApiName}/${recordId}`, {
    method: "PATCH",
    body: { [field]: value }
  });
}

export async function removeRecords(ctx, objectApiName, ids) {
  ident(objectApiName, "Object");
  for (const id of ids) {
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) continue;
    await sf(ctx, `/services/data/${API}/sobjects/${objectApiName}/${id}`, { method: "DELETE" });
  }
}

export async function changeOwner(ctx, objectApiName, ids, ownerId) {
  ident(objectApiName, "Object");
  if (!/^[a-zA-Z0-9]{15,18}$/.test(ownerId)) throw new Error("Enter a user id.");
  for (const id of ids) {
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) continue;
    await sf(ctx, `/services/data/${API}/sobjects/${objectApiName}/${id}`, {
      method: "PATCH",
      body: { OwnerId: ownerId }
    });
  }
}
