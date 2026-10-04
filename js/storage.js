// This tool needs to save progress whether it's opened inside Claude (which provides
// window.storage) or as a plain downloaded .html file in a normal browser (which doesn't).
// hasClaudeStorage detects which environment we're in, once, at load time.
const hasClaudeStorage = (typeof window.storage !== 'undefined' && typeof window.storage.get === 'function');

async function storageGet(key){
  if(hasClaudeStorage) return window.storage.get(key, false);
  const raw = localStorage.getItem(key);
  return raw ? {value: raw} : null;
}
async function storageSet(key, value){
  if(hasClaudeStorage) return window.storage.set(key, value, false);
  localStorage.setItem(key, value);
  return true;
}

function setSaveIndicator(mode){
  const el = document.getElementById('saveIndicator');
  if(!el) return;
  if(mode==='saved'){ el.textContent = '✓ Saved on this device'; el.className = 'save-indicator ok'; }
  else if(mode==='saving'){ el.textContent = 'Saving…'; el.className = 'save-indicator'; }
  else if(mode==='error'){ el.textContent = '⚠ Could not save — your changes may be lost if you close this tab. Export your progress as a backup.'; el.className = 'save-indicator err'; }
}
