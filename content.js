// Function to initialize the UI
function initCoveoExporter() {
  // 1. Inject the UI Panel
  const panel = document.createElement('div');
  panel.id = 'coveo-debug-panel';
  panel.innerHTML = `
  <h4>Coveo Exporter</h4>
  <label style="font-size:12px;">Records to Fetch:</label>
  <input type="number" id="coveo-export-count" value="500" />
  <button id="coveo-export-btn">Export to CSV</button>
  <div id="coveo-export-status" class="status">Waiting for search...</div>
  `;

  document.body.appendChild(panel);

  // 2. Select elements safely using the panel reference
  const btn = panel.querySelector('#coveo-export-btn');
  const input = panel.querySelector('#coveo-export-count');
  const statusDiv = panel.querySelector('#coveo-export-status');

  // 3. Handle Button Click
  btn.addEventListener('click', () => {
    const count = input.value || 500;
    statusDiv.textContent = 'Requesting data...';

    // Send command to injected script
    window.postMessage({
      type: "COVEO_EXPORT_TRIGGER",
      count: count
    }, "*");
  });

  // 4. Inject the main logic script (injected.js)
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = function() { this.remove(); };
  (document.head || document.documentElement).appendChild(s);

  // 5. Listen for Status Updates from Injected Script
  window.addEventListener('message', (event) => {
    if (event.data.type === 'COVEO_EXPORT_STATUS') {
      if (!statusDiv) return; // safety check

      statusDiv.textContent = event.data.message;
      if (event.data.status === 'success') {
        statusDiv.style.color = 'green';
      } else if (event.data.status === 'error') {
        statusDiv.style.color = 'red';
      } else {
        statusDiv.style.color = '#666';
      }
    }
  });
}

// WAIT for the DOM to be ready before running
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCoveoExporter);
} else {
  initCoveoExporter();
}
