import type { Context } from "hono";

// Inline admin UI - no external dependencies
const adminHTML = (baseUrl: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OptKit Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e5e5e5; padding: 2rem; min-height: 100vh;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; color: #fff; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .stat { background: #171717; border: 1px solid #262626; border-radius: 8px; padding: 1rem 1.5rem; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #22c55e; }
    .stat-label { font-size: 0.75rem; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; }
    .controls { display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
    input, select, button { 
      background: #171717; border: 1px solid #262626; border-radius: 6px; 
      padding: 0.5rem 0.75rem; color: #e5e5e5; font-size: 0.875rem;
    }
    input:focus, select:focus { outline: none; border-color: #22c55e; }
    input { width: 200px; }
    button { cursor: pointer; transition: background 0.15s; }
    button:hover { background: #262626; }
    .btn-danger { color: #ef4444; }
    .btn-danger:hover { background: #7f1d1d; }
    table { width: 100%; border-collapse: collapse; background: #171717; border-radius: 8px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #262626; }
    th { background: #0a0a0a; font-weight: 500; font-size: 0.75rem; text-transform: uppercase; color: #737373; }
    tr:hover { background: #1f1f1f; }
    .status { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
    .status-active { background: #14532d; color: #22c55e; }
    .status-unsubscribed { background: #7f1d1d; color: #fca5a5; }
    .pagination { display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: center; }
    .pagination button { min-width: 2.5rem; }
    .pagination button.active { background: #22c55e; color: #000; border-color: #22c55e; }
    .empty { text-align: center; padding: 3rem; color: #737373; }
    .loading { opacity: 0.5; pointer-events: none; }
    .btn-primary { 
      background: #22c55e; 
      color: #000; 
      font-weight: 600; 
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .btn-primary:hover { background: #16a34a; }
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; }
    .modal.active { display: flex; }
    .modal-content { background: #171717; border: 1px solid #262626; border-radius: 8px; padding: 2rem; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .modal-title { font-size: 1.25rem; font-weight: 600; color: #fff; }
    .modal-close { background: none; border: none; color: #737373; font-size: 1.5rem; cursor: pointer; padding: 0; width: 2rem; height: 2rem; }
    .modal-close:hover { color: #fff; }
    .form-group { margin-bottom: 1rem; }
    .form-label { display: block; margin-bottom: 0.5rem; color: #e5e5e5; font-size: 0.875rem; }
    textarea { width: 100%; min-height: 150px; background: #0a0a0a; border: 1px solid #262626; border-radius: 6px; padding: 0.75rem; color: #e5e5e5; font-family: monospace; font-size: 0.875rem; }
    textarea:focus { outline: none; border-color: #22c55e; }
    .file-input-wrapper { position: relative; }
    .file-input { position: absolute; opacity: 0; width: 0; height: 0; }
    .file-label { display: inline-block; padding: 0.5rem 1rem; background: #171717; border: 1px solid #262626; border-radius: 6px; cursor: pointer; }
    .file-label:hover { background: #262626; }
    .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .alert-success { background: #14532d; color: #22c55e; }
    .alert-error { background: #7f1d1d; color: #fca5a5; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h1>OptKit Admin</h1>
      <button class="btn-primary" onclick="openAddModal()">+ Add Subscribers</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-value" id="active">-</div><div class="stat-label">Active</div></div>
      <div class="stat"><div class="stat-value" id="total">-</div><div class="stat-label">Total</div></div>
    </div>
    <div class="controls">
      <input type="text" id="search" placeholder="Search email...">
      <select id="status">
        <option value="">All</option>
        <option value="active">Active</option>
        <option value="unsubscribed">Unsubscribed</option>
      </select>
      <select id="sort">
        <option value="created">Created</option>
        <option value="updated">Updated</option>
        <option value="email">Email</option>
      </select>
      <select id="order">
        <option value="desc">Newest</option>
        <option value="asc">Oldest</option>
      </select>
    </div>
    <table>
      <thead><tr><th>Email</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody id="subscribers"></tbody>
    </table>
    <div class="pagination" id="pagination"></div>
  </div>

  <!-- Add Subscribers Modal -->
  <div class="modal" id="addModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Add Subscribers</h2>
        <button class="modal-close" onclick="closeAddModal()">&times;</button>
      </div>
      <div id="modalAlert"></div>
      
      <!-- Tab buttons -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid #262626;">
        <button id="tab-single" onclick="switchTab('single')" style="padding: 0.5rem 1rem; background: #22c55e; color: #000; border: none; border-radius: 6px 6px 0 0; cursor: pointer; font-weight: 600;">Single</button>
        <button id="tab-json" onclick="switchTab('json')" style="padding: 0.5rem 1rem; background: #171717; color: #737373; border: none; border-radius: 6px 6px 0 0; cursor: pointer;">JSON Paste</button>
        <button id="tab-file" onclick="switchTab('file')" style="padding: 0.5rem 1rem; background: #171717; color: #737373; border: none; border-radius: 6px 6px 0 0; cursor: pointer;">File Upload</button>
      </div>

      <!-- Single email -->
      <div id="panel-single">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="singleEmail" placeholder="user@example.com" style="width: 100%; padding: 0.5rem; background: #0a0a0a; border: 1px solid #262626; border-radius: 6px; color: #e5e5e5;">
        </div>
        <div class="modal-actions">
          <button onclick="addSingle()" class="btn-primary">Add</button>
        </div>
      </div>

      <!-- JSON paste -->
      <div id="panel-json" style="display: none;">
        <div class="form-group">
          <label class="form-label">Paste JSON array of emails or subscriber objects</label>
          <textarea id="jsonInput" placeholder='["email1@example.com", "email2@example.com"]&#10;or&#10;[{"email": "email1@example.com", "status": "active"}, ...]'></textarea>
        </div>
        <div class="modal-actions">
          <button onclick="importJSON()" class="btn-primary">Import</button>
        </div>
      </div>

      <!-- File upload -->
      <div id="panel-file" style="display: none;">
        <div class="form-group">
          <label class="form-label">Upload JSON file</label>
          <div class="file-input-wrapper">
            <input type="file" id="fileInput" class="file-input" accept=".json" onchange="handleFileSelect(event)">
            <label for="fileInput" class="file-label">Choose File</label>
            <span id="fileName" style="margin-left: 1rem; color: #737373;"></span>
          </div>
        </div>
        <div class="modal-actions">
          <button onclick="importFile()" class="btn-primary" id="importFileBtn" disabled>Import</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const BASE = '${baseUrl}';
    let page = 1, limit = 25;
    
    async function load() {
      const search = document.getElementById('search').value;
      const status = document.getElementById('status').value;
      const sort = document.getElementById('sort').value;
      const order = document.getElementById('order').value;
      
      const params = new URLSearchParams({ page, limit, sort, order });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      
      document.body.classList.add('loading');
      const res = await fetch(BASE + '/subscribers?' + params, { credentials: 'include' });
      const data = await res.json();
      document.body.classList.remove('loading');
      
      document.getElementById('active').textContent = data.active || 0;
      document.getElementById('total').textContent = data.total || 0;
      
      const tbody = document.getElementById('subscribers');
      if (!data.subscribers?.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty">No subscribers</td></tr>';
        return;
      }
      
      tbody.innerHTML = data.subscribers.map(s => \`
        <tr>
          <td>\${s.email}</td>
          <td><span class="status status-\${s.status}">\${s.status}</span></td>
          <td>\${new Date(s.createdAt).toLocaleDateString()}</td>
          <td><button class="btn-danger" onclick="remove('\${s.email}')">Remove</button></td>
        </tr>
      \`).join('');
      
      const pages = Math.ceil(data.total / limit);
      document.getElementById('pagination').innerHTML = Array.from({ length: Math.min(pages, 10) }, (_, i) => 
        \`<button class="\${i + 1 === page ? 'active' : ''}" onclick="goTo(\${i + 1})">\${i + 1}</button>\`
      ).join('');
    }
    
    async function remove(email) {
      if (!confirm('Remove ' + email + '?')) return;
      await fetch(BASE + '/subscribers/' + encodeURIComponent(email), { method: 'DELETE', credentials: 'include' });
      load();
    }
    
    function goTo(p) { page = p; load(); }
    
    document.getElementById('search').addEventListener('input', () => { page = 1; load(); });
    document.getElementById('status').addEventListener('change', () => { page = 1; load(); });
    document.getElementById('sort').addEventListener('change', load);
    document.getElementById('order').addEventListener('change', load);
    
    // Modal functions
    function openAddModal() {
      document.getElementById('addModal').classList.add('active');
      switchTab('single');
    }
    
    function closeAddModal() {
      document.getElementById('addModal').classList.remove('active');
      document.getElementById('modalAlert').innerHTML = '';
      document.getElementById('singleEmail').value = '';
      document.getElementById('jsonInput').value = '';
      document.getElementById('fileInput').value = '';
      document.getElementById('fileName').textContent = '';
      document.getElementById('importFileBtn').disabled = true;
    }
    
    function switchTab(tab) {
      ['single', 'json', 'file'].forEach(t => {
        document.getElementById('panel-' + t).style.display = t === tab ? 'block' : 'none';
        const btn = document.getElementById('tab-' + t);
        btn.style.background = t === tab ? '#22c55e' : '#171717';
        btn.style.color = t === tab ? '#000' : '#737373';
      });
    }
    
    function showAlert(message, type) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-' + type;
      alert.textContent = message;
      document.getElementById('modalAlert').innerHTML = '';
      document.getElementById('modalAlert').appendChild(alert);
      setTimeout(() => alert.remove(), 5000);
    }
    
    async function addSingle() {
      const email = document.getElementById('singleEmail').value.trim();
      if (!email) {
        showAlert('Email required', 'error');
        return;
      }
      try {
        const res = await fetch(BASE + '/opt-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
          credentials: 'include'
        });
        if (res.ok) {
          showAlert('Subscriber added!', 'success');
          setTimeout(() => { closeAddModal(); load(); }, 1000);
        } else {
          const text = await res.text();
          showAlert('Error: ' + text, 'error');
        }
      } catch (e) {
        showAlert('Error: ' + e.message, 'error');
      }
    }
    
    async function importJSON() {
      const text = document.getElementById('jsonInput').value.trim();
      if (!text) {
        showAlert('JSON required', 'error');
        return;
      }
      try {
        const data = JSON.parse(text);
        const emails = Array.isArray(data) ? data.map(item => 
          typeof item === 'string' ? item : item.email
        ) : [];
        
        if (emails.length === 0) {
          showAlert('No valid emails found', 'error');
          return;
        }
        
        let success = 0, failed = 0;
        for (const email of emails) {
          if (!email) continue;
          try {
            const res = await fetch(BASE + '/opt-in', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email }),
              credentials: 'include'
            });
            if (res.ok) success++;
            else failed++;
          } catch (e) {
            failed++;
          }
        }
        showAlert(\`Imported \${success} subscribers\${failed > 0 ? ', ' + failed + ' failed' : ''}\`, success > 0 ? 'success' : 'error');
        if (success > 0) {
          setTimeout(() => { closeAddModal(); load(); }, 2000);
        }
      } catch (e) {
        showAlert('Invalid JSON: ' + e.message, 'error');
      }
    }
    
    let selectedFile = null;
    
    function handleFileSelect(e) {
      const file = e.target.files[0];
      if (file) {
        selectedFile = file;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('importFileBtn').disabled = false;
      }
    }
    
    async function importFile() {
      if (!selectedFile) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const emails = Array.isArray(data) ? data.map(item => 
            typeof item === 'string' ? item : item.email
          ) : [];
          
          if (emails.length === 0) {
            showAlert('No valid emails found', 'error');
            return;
          }
          
          let success = 0, failed = 0;
          for (const email of emails) {
            if (!email) continue;
            try {
              const res = await fetch(BASE + '/opt-in', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
                credentials: 'include'
              });
              if (res.ok) success++;
              else failed++;
            } catch (e) {
              failed++;
            }
          }
          showAlert(\`Imported \${success} subscribers\${failed > 0 ? ', ' + failed + ' failed' : ''}\`, success > 0 ? 'success' : 'error');
          if (success > 0) {
            setTimeout(() => { closeAddModal(); load(); }, 2000);
          }
        } catch (e) {
          showAlert('Invalid JSON: ' + e.message, 'error');
        }
      };
      reader.readAsText(selectedFile);
    }
    
    load();
  </script>
</body>
</html>`;

export function adminUI(c: Context) {
  // Get the base URL for API calls (same origin, no /admin path)
  const url = new URL(c.req.url);
  const baseUrl = url.origin;
  
  return c.html(adminHTML(baseUrl));
}

