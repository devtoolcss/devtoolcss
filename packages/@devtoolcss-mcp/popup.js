// Load current settings
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    "host",
    "port",
    "pollingEnabled",
    "pollingInterval",
  ]);

  document.getElementById("host").value = settings.host || "127.0.0.1";
  document.getElementById("port").value = settings.port || 9333;
  document.getElementById("pollingInterval").value =
    settings.pollingInterval || 2000;
  document.getElementById("pollingEnabled").checked =
    settings.pollingEnabled !== false;
}

// Save settings
async function saveSettings() {
  const settings = {
    host: document.getElementById("host").value.trim() || "127.0.0.1",
    port: parseInt(document.getElementById("port").value) || 9333,
    pollingInterval:
      parseInt(document.getElementById("pollingInterval").value) || 2000,
    pollingEnabled: document.getElementById("pollingEnabled").checked,
  };

  await chrome.storage.sync.set(settings);

  // Show success message
  const status = document.getElementById("status");
  status.classList.add("success");
  setTimeout(() => {
    status.classList.remove("success");
  }, 2000);
}

// Event listeners
document.getElementById("save").addEventListener("click", saveSettings);

// Load settings on popup open
loadSettings();
