const SUPABASE_URL = 'https://lxahbpayfiigjlkuylit.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YWhicGF5ZmlpZ2psa3V5bGl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDkxNjQsImV4cCI6MjA5MTIyNTE2NH0.MaPL7BcnOdb2yengUk1hQ0oe9U7Y7d7SJNY4BEspPo4';

function sbHeaders(extra) {
  return Object.assign({
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json'
  }, extra || {});
}

async function dbGet(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query || ''}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbUpdate(table, body, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Prefer': 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbUpsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function dbDelete(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!res.ok) throw new Error(await res.text());
}
