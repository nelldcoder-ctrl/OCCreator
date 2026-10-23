const STORAGE_KEY = 'fable.characters.v1';
const DRAFT_KEY = 'fable.draft.v1';
const FOLDER_DB_NAME = 'fable.character-data';
const FOLDER_STORE = 'settings';
const FOLDER_HANDLE_KEY = 'directory-handle';
const form = document.querySelector('#character-form');
const characterGrid = document.querySelector('#character-grid');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const imagePreview = document.querySelector('#portrait-image');
const placeholder = document.querySelector('#portrait-placeholder');
const coverPreview = document.querySelector('#cover-preview');
const previewAvatarPlaceholder = document.querySelector('#preview-avatar-placeholder');
const characterDialog = document.querySelector('#character-dialog');
const deleteDialog = document.querySelector('#delete-dialog');
let printSectionState = null;
const storedCharacters = readStorage(STORAGE_KEY, []);
let characters = Array.isArray(storedCharacters)
  ? storedCharacters.filter((character) => character && typeof character === 'object' && typeof character.name === 'string')
  : [];
let activeId = '';
let toastTimer;
let profileReturnFocus = null;
let profileCloseTimer = null;
let profileAfterClose = null;
let pendingDeleteId = '';
let activeProfile = null;
let profileGalleryRendered = false;
let draftSaveWarningShown = false;
let dataDirectory = null;
let folderWritePending = Promise.resolve();

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function currentProfile() {
  return {
    id: document.querySelector('#character-id').value || activeId || '',
    name: document.querySelector('#name').value.trim(),
    role: document.querySelector('#role').value.trim(),
    pronouns: document.querySelector('#pronouns').value.trim(),
    age: document.querySelector('#age').value.trim(),
    species: document.querySelector('#species').value.trim(),
    description: document.querySelector('#description').value.trim(),
    traits: document.querySelector('#traits').value.split(',').map((trait) => trait.trim()).filter(Boolean),
    avatar: document.querySelector('#avatar').value.trim(),
    cover: document.querySelector('#cover').value.trim(),
    accent: document.querySelector('#accent').value,
    story: document.querySelector('#story').value.trim(),
    gallery: document.querySelector('#gallery').value.trim(),
    relations: document.querySelector('#relations').value.trim(),
    links: document.querySelector('#links').value.trim(),
    worlds: document.querySelector('#worlds').value.trim(),
    stats: document.querySelector('#stats').value.trim(),
  };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `character-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveDraft() {
  const saved = writeStorage(DRAFT_KEY, currentProfile());
  document.querySelector('#autosave-status').textContent = saved ? 'Draft saved' : 'Draft not saved';
  if (!saved && !draftSaveWarningShown) {
    showToast('Draft could not be saved. Export a backup or use Import JSON/CSV to restore it later.');
  }
  draftSaveWarningShown = !saved;
  return saved;
}

function traitsValue(traits) {
  return Array.isArray(traits) ? traits.join(', ') : String(traits || '');
}

function openFolderDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FOLDER_DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(FOLDER_STORE);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

async function folderDatabaseRequest(mode, action) {
  const database = await openFolderDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FOLDER_STORE, mode);
    const store = transaction.objectStore(FOLDER_STORE);
    const request = action(store);
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
    transaction.addEventListener('complete', () => database.close());
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
}

async function rememberDataDirectory(handle) {
  await folderDatabaseRequest('readwrite', (store) => store.put(handle, FOLDER_HANDLE_KEY));
}

function setFolderStatus(message) {
  document.querySelector('#data-folder-status').textContent = message;
}

function persistCharacterLibrary() {
  if (!dataDirectory) return;
  folderWritePending = folderWritePending.then(async () => {
    try {
      const permission = await dataDirectory.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setFolderStatus('Folder permission needed — choose it again');
        return;
      }
      const file = await dataDirectory.getFileHandle('fable-character-library.json', { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify({
        format: 'fable-character-library',
        version: 1,
        updatedAt: new Date().toISOString(),
        characters,
      }, null, 2));
      await writable.close();
      setFolderStatus(`Backup updated in ${dataDirectory.name}`);
    } catch {
      setFolderStatus('Folder backup failed — export a backup instead');
      showToast('Could not update the folder backup. Your browser copy is still saved; export a backup to keep another copy.');
    }
  });
  return folderWritePending;
}

async function initializeDataFolder() {
  const button = document.querySelector('#connect-data-folder');
  if (!window.showDirectoryPicker || !window.indexedDB) {
    button.disabled = true;
    button.title = 'Folder access is unavailable in this browser. Use Export all to save a backup.';
    setFolderStatus('Folder access unavailable — use Export all');
    return;
  }
  try {
    const handle = await folderDatabaseRequest('readonly', (store) => store.get(FOLDER_HANDLE_KEY));
    if (!handle) return;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    dataDirectory = handle;
    button.textContent = 'Change data folder';
    setFolderStatus(permission === 'granted'
      ? `Folder connected: ${handle.name}`
      : `Folder remembered: ${handle.name} (reconnect to allow access)`);
    if (permission === 'granted') await persistCharacterLibrary();
  } catch {
    setFolderStatus('Could not restore folder access — choose it again');
  }
}

document.querySelector('#connect-data-folder').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: 'fable-character-data', mode: 'readwrite' });
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      setFolderStatus('Permission not granted — using browser autosave');
      return;
    }
    dataDirectory = handle;
    await rememberDataDirectory(handle);
    document.querySelector('#connect-data-folder').textContent = 'Change data folder';
    setFolderStatus(`Folder connected: ${handle.name}`);
    await persistCharacterLibrary();
    showToast(`Character backups will be saved in ${handle.name}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setFolderStatus('Could not connect folder — use Export all');
    showToast('Could not connect that folder. Browser autosave and manual exports are still available.');
  }
});

function setText(selector, value, fallback) {
  document.querySelector(selector).textContent = value || fallback;
}

function updatePreview() {
  const profile = currentProfile();
  const position = characters.findIndex((character) => character.id === profile.id);
  document.querySelector('#profile-preview').style.setProperty('--card-accent', profile.accent || '#4385e8');
  setText('#preview-name', profile.name, 'Your character');
  setText('#preview-role', profile.role, 'A story waiting to happen');
  setText('#preview-pronouns', profile.pronouns, 'pronouns');
  setText('#preview-age', profile.age ? `${profile.age} years` : '', 'age');
  setText('#preview-species', profile.species, 'species');
  setText('#preview-description', profile.description, 'Give them a name and a few details. Their profile will come together right here.');
  setText('#preview-index', String(position >= 0 ? position + 1 : characters.length + 1).padStart(2, '0'));
  document.querySelector('#description-count').textContent = String(profile.description.length);

  const traitsContainer = document.querySelector('#preview-traits');
  traitsContainer.replaceChildren();
  if (profile.traits.length) {
    profile.traits.slice(0, 5).forEach((trait) => {
      const chip = document.createElement('span');
      chip.textContent = trait;
      traitsContainer.append(chip);
    });
  } else {
    const hint = document.createElement('span');
    hint.className = 'trait-placeholder';
    hint.textContent = 'YOUR TRAITS';
    traitsContainer.append(hint);
  }

  const coverUrl = profile.cover;
  if (coverUrl) {
    coverPreview.src = coverUrl;
    coverPreview.classList.remove('hidden');
  } else {
    coverPreview.removeAttribute('src');
    coverPreview.classList.add('hidden');
  }

  if (profile.avatar) {
    imagePreview.src = profile.avatar;
    imagePreview.classList.remove('hidden');
    previewAvatarPlaceholder.classList.add('hidden');
  } else {
    imagePreview.removeAttribute('src');
    imagePreview.classList.add('hidden');
    previewAvatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    previewAvatarPlaceholder.classList.remove('hidden');
  }
  placeholder.classList.toggle('hidden', Boolean(coverUrl));
  if (coverUrl) {
    document.querySelector('#preview-art').classList.add('has-cover');
  } else {
    document.querySelector('#preview-art').classList.remove('has-cover');
  }
}

function renderCharacters() {
  const query = document.querySelector('#search-characters').value.trim().toLowerCase();
  const filtered = characters.filter((character) => [character.name, character.role, ...(character.traits || [])].join(' ').toLowerCase().includes(query));
  characterGrid.replaceChildren();
  filtered.forEach((character) => {
    const card = document.createElement('button');
    card.className = 'cast-card';
    card.type = 'button';
    card.style.setProperty('--thumb-accent', character.accent || '#4385e8');
    card.setAttribute('aria-label', `View profile for ${character.name}`);
    card.title = [character.name, character.role, character.description].filter(Boolean).join(' — ');

    const thumb = document.createElement('span');
    thumb.className = 'cast-thumb';
    if (character.avatar) {
      const image = document.createElement('img');
      image.src = character.avatar;
      image.alt = '';
      thumb.append(image);
    } else {
      thumb.textContent = (character.name || '?').slice(0, 1).toUpperCase();
    }

    const info = document.createElement('span');
    info.className = 'cast-info';
    const name = document.createElement('h3');
    name.textContent = character.name;
    const heading = document.createElement('p');
    heading.textContent = character.role || character.species || 'A character in your story';
    const traits = document.createElement('span');
    traits.className = 'cast-traits';
    traits.textContent = (character.traits || []).slice(0, 2).join('  ·  ');
    info.append(name, heading, traits);
    const arrow = document.createElement('span');
    arrow.className = 'cast-arrow';
    arrow.textContent = '↗';
    card.append(thumb, info, arrow);
    card.addEventListener('click', () => openCharacterProfile(character, card));
    characterGrid.append(card);
  });

  document.querySelector('#sidebar-count').textContent = String(characters.length);
  document.querySelector('#cast-total').textContent = `(${characters.length})`;
  emptyState.classList.toggle('hidden', characters.length > 0);
  if (characters.length > 0 && filtered.length === 0) {
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = 'No characters found.';
    emptyState.querySelector('p').textContent = 'Try another name or trait in your search.';
    emptyState.querySelector('button').classList.add('hidden');
  } else {
    emptyState.querySelector('h3').textContent = 'Your story is a blank page.';
    emptyState.querySelector('p').textContent = 'Make your first character and start filling it with possibility.';
    emptyState.querySelector('button').classList.remove('hidden');
  }
}

function validWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function setProfileText(selector, value, fallback = '') {
  const element = document.querySelector(selector);
  element.textContent = value || fallback;
  element.classList.toggle('hidden', !value && !fallback);
}

function openCharacterProfile(character, returnFocus = document.activeElement) {
  profileReturnFocus = returnFocus;
  const profile = { ...character, traits: character.traits || [] };
  activeProfile = profile;
  profileGalleryRendered = false;
  const accent = profile.accent || '#4385e8';
  characterDialog.style.setProperty('--profile-accent', accent);
  document.querySelector('#profile-name').dataset.characterId = profile.id;
  setProfileText('#profile-name', profile.name, 'Your character');
  setProfileText('#profile-role', profile.role);
  setProfileText('#profile-quote', profile.description ? `“${profile.description}”` : '');
  setProfileText('#profile-about', profile.description, 'This character has no introduction yet.');

  const cover = document.querySelector('#profile-cover-image');
  const avatar = document.querySelector('#profile-avatar');
  const avatarPlaceholder = document.querySelector('#profile-avatar-placeholder');
  const coverImage = profile.cover || profile.avatar;
  if (profile.avatar) {
    avatar.src = profile.avatar;
    avatar.alt = `${profile.name || 'Character'} portrait`;
    avatar.decoding = 'async';
    avatar.classList.remove('hidden');
    avatarPlaceholder.classList.add('hidden');
  } else {
    avatar.removeAttribute('src');
    avatar.classList.add('hidden');
    avatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    avatarPlaceholder.classList.remove('hidden');
  }
  if (coverImage) {
    cover.src = coverImage;
    cover.decoding = 'async';
    cover.classList.remove('hidden');
  } else {
    cover.removeAttribute('src');
    cover.classList.add('hidden');
  }

  const tags = document.querySelector('#profile-tags');
  tags.replaceChildren();
  [...profile.traits, profile.pronouns, profile.age, profile.species].filter(Boolean).forEach((item) => {
    const tag = document.createElement('span');
    tag.className = 'profile-tag';
    tag.textContent = item;
    tag.title = item;
    tags.append(tag);
  });

  const storyBlock = document.querySelector('#profile-story-block');
  storyBlock.classList.toggle('hidden', !profile.story);
  document.querySelector('#profile-story').textContent = profile.story || '';

  const stats = document.querySelector('#profile-stats');
  stats.replaceChildren();
  [
    ['Role', profile.role],
    ['Pronouns', profile.pronouns],
    ['Age', profile.age],
    ['Species', profile.species],
    ...(profile.stats || '').split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      return separator > -1 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : ['', line.trim()];
    }),
  ].filter(([, value]) => value).forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'profile-stat';
    const term = document.createElement('span');
    term.textContent = label || 'Detail';
    const description = document.createElement('strong');
    description.textContent = value;
    item.title = `${label || 'Detail'}: ${value}`;
    item.append(term, description);
    stats.append(item);
  });
  if (!stats.childElementCount) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'Add age, species, or extra stats in the editor.';
    stats.append(hint);
  }

  setProfileText('#profile-relations', profile.relations, 'No relationships added yet.');
  setProfileText('#profile-worlds', profile.worlds, 'No world or setting added yet.');
  const links = document.querySelector('#profile-links');
  links.replaceChildren();
  (profile.links || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const parts = line.split('|').map((part) => part.trim());
    const url = parts.length > 1 ? parts.pop() : parts[0];
    if (!validWebUrl(url)) return;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = parts.length ? parts.join(' | ') : url;
    link.title = url;
    links.append(link);
  });
  if (!links.childElementCount) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'No links added yet.';
    links.append(hint);
  }

  document.querySelectorAll('.profile-section').forEach((section, index) => { section.open = index === 0; });
  document.querySelector('#profile-gallery').replaceChildren();
  document.querySelector('#profile-gallery-empty').classList.add('hidden');
  characterDialog.classList.remove('is-closing');
  characterDialog.showModal();
  updateBackToTopVisibility();
  document.querySelector('#profile-close').focus();
}

function renderProfileGallery() {
  if (!activeProfile || profileGalleryRendered) return;
  const gallery = document.querySelector('#profile-gallery');
  const images = [activeProfile.cover, activeProfile.avatar, ...(activeProfile.gallery || '').split(/\r?\n/)]
    .map((url) => (url || '').trim())
    .filter((url, index, all) => url && all.indexOf(url) === index && (url.startsWith('data:image/') || validWebUrl(url)));
  images.forEach((url, index) => {
    const image = document.createElement('img');
    image.src = url;
    image.alt = `${activeProfile.name || 'Character'} image ${index + 1}`;
    image.loading = 'lazy';
    image.decoding = 'async';
    gallery.append(image);
  });
  document.querySelector('#profile-gallery-empty').classList.toggle('hidden', images.length > 0);
  profileGalleryRendered = true;
}

document.querySelector('#profile-gallery').closest('.profile-section').addEventListener('toggle', (event) => {
  if (event.currentTarget.open) renderProfileGallery();
});

function loadCharacter(id) {
  const character = characters.find((item) => item.id === id);
  if (!character) return;
  activeId = character.id;
  Object.entries({
    'character-id': character.id,
    name: character.name,
    role: character.role,
    pronouns: character.pronouns,
    age: character.age,
    species: character.species,
    cover: character.cover || character.avatar,
    description: character.description,
    traits: traitsValue(character.traits),
    avatar: character.avatar,
    cover: character.cover || character.avatar,
    accent: character.accent || '#4385e8',
    story: character.story,
    gallery: character.gallery,
    relations: character.relations,
    links: character.links,
    worlds: character.worlds,
    stats: character.stats,
  }).forEach(([idName, value]) => { document.getElementById(idName).value = value || ''; });
  document.querySelector('#save-label').textContent = 'Update character';
  document.querySelector('#delete-character').classList.remove('hidden');
  localStorage.removeItem(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Editing saved character';
  updatePreview();
  document.querySelector('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  form.reset();
  document.querySelector('#character-id').value = '';
  document.querySelector('#accent').value = '#4385e8';
  activeId = '';
  document.querySelector('#save-label').textContent = 'Save character';
  document.querySelector('#delete-character').classList.add('hidden');
  document.querySelector('#appearance-details').open = false;
  document.querySelector('#profile-extras').open = false;
  localStorage.removeItem(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Draft autosaves here';
  updatePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelector('#name').focus({ preventScroll: true });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function updateBackToTopVisibility() {
  const button = document.querySelector('#back-to-top');
  button.classList.toggle('is-visible', window.scrollY > 360 && !characterDialog.open);
}

document.querySelector('#back-to-top').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });

form.addEventListener('input', () => {
  updatePreview();
  saveDraft();
});

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Choose an image smaller than 2 MB. Use an image URL for larger files.');
    event.target.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Choose a valid image file.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const field = event.target.id === 'cover-file' ? '#cover' : '#avatar';
    document.querySelector(field).value = String(reader.result);
    updatePreview();
    saveDraft();
  });
  reader.addEventListener('error', () => showToast('Could not read this image file. Try another image or paste an image URL.'));
  reader.readAsDataURL(file);
}

document.querySelector('#avatar-file').addEventListener('change', handleImageUpload);
document.querySelector('#cover-file').addEventListener('change', handleImageUpload);

function requestProfileClose(afterClose = null) {
  if (!characterDialog.open || characterDialog.classList.contains('is-closing')) return;
  profileAfterClose = typeof afterClose === 'function' ? afterClose : null;
  characterDialog.classList.add('is-closing');
  const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  profileCloseTimer = window.setTimeout(() => {
    characterDialog.close();
    profileCloseTimer = null;
  }, delay);
}

document.querySelector('#profile-close').addEventListener('click', requestProfileClose);
document.querySelector('#profile-back').addEventListener('click', requestProfileClose);
characterDialog.addEventListener('click', (event) => {
  if (event.target === characterDialog) requestProfileClose();
});
characterDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestProfileClose();
});
characterDialog.addEventListener('close', () => {
  if (profileCloseTimer) {
    window.clearTimeout(profileCloseTimer);
    profileCloseTimer = null;
  }
  characterDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (profileReturnFocus instanceof HTMLElement && profileReturnFocus.isConnected) profileReturnFocus.focus();
  const afterClose = profileAfterClose;
  profileAfterClose = null;
  if (typeof afterClose === 'function') afterClose();
});
document.querySelector('#profile-edit').addEventListener('click', () => {
  const id = document.querySelector('#profile-name').dataset.characterId;
  if (!id) return;
  requestProfileClose(() => loadCharacter(id));
});

imagePreview.addEventListener('error', () => {
  imagePreview.classList.add('hidden');
  previewAvatarPlaceholder.textContent = (document.querySelector('#name').value || '?').slice(0, 1).toUpperCase();
  previewAvatarPlaceholder.classList.remove('hidden');
});
coverPreview.addEventListener('error', () => {
  coverPreview.classList.add('hidden');
  document.querySelector('#preview-art').classList.remove('has-cover');
  placeholder.classList.remove('hidden');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = currentProfile();
  if (!profile.name) {
    document.querySelector('#name').focus();
    return;
  }
  profile.id = activeId || createId();
  const existingIndex = characters.findIndex((item) => item.id === profile.id);
  const nextCharacters = [...characters];
  if (existingIndex >= 0) nextCharacters[existingIndex] = profile;
  else nextCharacters.unshift(profile);
  if (!writeStorage(STORAGE_KEY, nextCharacters)) {
    showToast('Could not save. Your browser storage may be full.');
    return;
  }
  characters = nextCharacters;
  persistCharacterLibrary();
  activeId = profile.id;
  document.querySelector('#character-id').value = profile.id;
  localStorage.removeItem(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Character saved';
  document.querySelector('#save-label').textContent = 'Update character';
  document.querySelector('#delete-character').classList.remove('hidden');
  renderCharacters();
  updatePreview();
  showToast(`${profile.name} is saved to your cast.`);
});

const exportFields = [
  ['id', 'ID'], ['name', 'Name'], ['role', 'Role'], ['pronouns', 'Pronouns'],
  ['age', 'Age'], ['species', 'Species'], ['description', 'Description'],
  ['traits', 'Traits'], ['story', 'Backstory'], ['avatar', 'Portrait'], ['cover', 'Cover'],
  ['accent', 'Accent'], ['gallery', 'Gallery'], ['relations', 'Relations'],
  ['links', 'Links'], ['worlds', 'Worlds'], ['stats', 'Stats'],
];

function safeFilename(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(profiles) {
  const header = exportFields.map(([, label]) => csvCell(label)).join(',');
  const rows = profiles.map((profile) => exportFields.map(([key]) => csvCell(profile[key])).join(','));
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

function toText(profiles) {
  return profiles.map((profile) => exportFields
    .filter(([key]) => key !== 'id' && profile[key] !== '' && profile[key] != null && (!Array.isArray(profile[key]) || profile[key].length > 0))
    .map(([key, label]) => `${label}: ${Array.isArray(profile[key]) ? profile[key].join(', ') : profile[key]}`)
    .join('\n')).join('\n\n--------------------\n\n');
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unfinished quoted value.');
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one character.');

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  if (!headers.some((header) => ['name', 'character name', 'display name'].includes(header.toLowerCase()))) {
    throw new Error('CSV is missing a Name or Character Name column.');
  }
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || '']),
  ));
}

function normalizeCharacter(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const fields = Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/g, ''),
    value,
  ]));
  const get = (...keys) => {
    for (const key of keys) {
      const value = fields[key.replace(/[^a-z0-9]/gi, '').toLowerCase()];
      if (value !== undefined && value !== null) return value;
    }
    return '';
  };
  const toString = (value, limit) => String(value ?? '').trim().slice(0, limit);
  const name = toString(get('name', 'character name', 'display name', 'title'), 48);
  if (!name) return null;
  const rawTraits = get('traits', 'personality', 'tags');
  const traits = Array.isArray(rawTraits)
    ? rawTraits.map((trait) => toString(trait, 40)).filter(Boolean)
    : toString(rawTraits, 160).split(/[|,]/).map((trait) => trait.trim()).filter(Boolean);
  const rawAccent = toString(get('accent', 'color', 'card color'), 7);
  const accent = /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#4385e8';
  return {
    id: toString(get('id', 'uuid'), 100) || createId(),
    name,
    role: toString(get('role', 'type', 'occupation'), 60),
    pronouns: toString(get('pronouns'), 30),
    age: toString(get('age'), 24),
    species: toString(get('species', 'race'), 36),
    description: toString(get('description', 'about', 'summary', 'quote'), 360),
    traits: traits.slice(0, 20),
    avatar: toString(get('avatar', 'portrait', 'image', 'image url'), 4_000_000),
    cover: toString(get('cover', 'cover image', 'banner', 'banner image'), 4_000_000),
    accent,
    story: toString(get('story', 'backstory', 'background'), 700),
    gallery: toString(get('gallery', 'images', 'image urls'), 1000),
    relations: toString(get('relations', 'relationships'), 700),
    links: toString(get('links', 'url', 'website'), 700),
    worlds: toString(get('worlds', 'world', 'setting'), 700),
    stats: toString(get('stats', 'extra stats'), 700),
  };
}

function parseImportFile(text, filename) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const extension = filename.split('.').pop().toLowerCase();
  if (extension === 'csv' || (!['{', '['].includes(cleanText[0]) && cleanText.includes(','))) {
    return parseCsv(cleanText);
  }
  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    throw new Error('Could not read JSON. Choose a valid JSON backup or CSV file.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON must contain a character or character library.');
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.characters)) return parsed.characters;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (parsed.character && typeof parsed.character === 'object') return [parsed.character];
  if (parsed.profile && typeof parsed.profile === 'object') return [parsed.profile];
  return [parsed];
}

async function importCharacters(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('Choose an import file smaller than 15 MB.');
    const records = parseImportFile(await file.text(), file.name);
    const imported = records.map(normalizeCharacter).filter(Boolean);
    if (!imported.length) throw new Error('No characters with a name were found in that file.');

    const nextCharacters = [...characters];
    imported.forEach((character) => {
      const existingIndex = nextCharacters.findIndex((item) => item.id === character.id);
      if (existingIndex >= 0) nextCharacters[existingIndex] = character;
      else nextCharacters.unshift(character);
    });
    if (!writeStorage(STORAGE_KEY, nextCharacters)) {
      throw new Error('Could not import. Your browser storage may be full.');
    }
    characters = nextCharacters;
    renderCharacters();
    persistCharacterLibrary();
    const skipped = records.length - imported.length;
    showToast(`Imported ${imported.length} character${imported.length === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'}` : ''}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Import failed. Check that the file is valid JSON or CSV.');
  } finally {
    input.value = '';
  }
}

function exportProfiles(profiles, format, library = false) {
  if (!profiles.length) {
    showToast(library ? 'There are no saved characters to export.' : 'Add a character name before exporting.');
    return;
  }
  try {
    const filename = library ? 'fable-character-library' : safeFilename(profiles[0].name);
    if (format === 'csv') {
      downloadFile(`${filename}.csv`, toCsv(profiles), 'text/csv;charset=utf-8');
    } else if (format === 'txt') {
      downloadFile(`${filename}.txt`, toText(profiles), 'text/plain;charset=utf-8');
    } else {
      const data = library
        ? { format: 'fable-character-library', version: 1, characters: profiles }
        : profiles[0];
      downloadFile(`${filename}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    }
    showToast(`${library ? 'Character library' : profiles[0].name} exported as ${format.toUpperCase()}.`);
  } catch {
    showToast('Export failed. Try another format or check browser download permissions.');
  }
}

document.querySelector('#export-character').addEventListener('click', () => {
  const profile = currentProfile();
  if (!profile.name) {
    showToast('Add a character name before exporting.');
    document.querySelector('#name').focus();
    return;
  }
  exportProfiles([profile], document.querySelector('#export-format').value);
});
document.querySelector('#export-library').addEventListener('click', () => {
  exportProfiles(characters, document.querySelector('#export-format').value, true);
});
document.querySelector('#import-library').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', importCharacters);
document.querySelector('#profile-print').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => {
  if (!characterDialog.open || printSectionState) return;
  renderProfileGallery();
  const sections = [...document.querySelectorAll('.profile-section')];
  printSectionState = sections.map((section) => section.open);
  sections.forEach((section) => { section.open = true; });
});
window.addEventListener('afterprint', () => {
  if (!printSectionState) return;
  document.querySelectorAll('.profile-section').forEach((section, index) => {
    section.open = printSectionState[index] ?? false;
  });
  printSectionState = null;
});
document.querySelector('#delete-character').addEventListener('click', () => {
  const profile = characters.find((character) => character.id === activeId);
  if (!profile) return;
  pendingDeleteId = profile.id;
  document.querySelector('#delete-dialog-message').textContent =
    `Delete ${profile.name} from your cast? This cannot be undone.`;
  deleteDialog.showModal();
  document.querySelector('#cancel-delete').focus();
});
document.querySelector('#cancel-delete').addEventListener('click', () => {
  pendingDeleteId = '';
  deleteDialog.close();
  document.querySelector('#delete-character').focus();
});
deleteDialog.addEventListener('click', (event) => {
  if (event.target === deleteDialog) {
    pendingDeleteId = '';
    deleteDialog.close();
    document.querySelector('#delete-character').focus();
  }
});
deleteDialog.addEventListener('close', () => {
  pendingDeleteId = '';
});
document.querySelector('#confirm-delete').addEventListener('click', () => {
  const characterId = pendingDeleteId;
  if (!characterId) return;
  const nextCharacters = characters.filter((character) => character.id !== characterId);
  if (!writeStorage(STORAGE_KEY, nextCharacters)) {
    showToast('Could not delete. Your browser storage may be unavailable.');
    return;
  }
  characters = nextCharacters;
  persistCharacterLibrary();
  renderCharacters();
  deleteDialog.close();
  resetForm();
  showToast('Character removed from your cast.');
});

document.querySelector('#search-characters').addEventListener('input', renderCharacters);
['new-character', 'sidebar-new', 'empty-create'].forEach((id) => document.getElementById(id).addEventListener('click', resetForm));

document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
  link.classList.add('active');
  document.querySelector(link.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

const savedDraft = readStorage(DRAFT_KEY, null);
if (savedDraft) {
  Object.entries({
    name: savedDraft.name, role: savedDraft.role, pronouns: savedDraft.pronouns, age: savedDraft.age,
    species: savedDraft.species, description: savedDraft.description, traits: traitsValue(savedDraft.traits),
    avatar: savedDraft.avatar, cover: savedDraft.cover, accent: savedDraft.accent, story: savedDraft.story,
    gallery: savedDraft.gallery, relations: savedDraft.relations, links: savedDraft.links,
    worlds: savedDraft.worlds, stats: savedDraft.stats,
  }).forEach(([id, value]) => { document.getElementById(id).value = value || ''; });
  document.querySelector('#autosave-status').textContent = 'Draft restored';
  if (savedDraft.id && characters.some((character) => character.id === savedDraft.id)) {
    activeId = savedDraft.id;
    document.querySelector('#character-id').value = savedDraft.id;
    document.querySelector('#save-label').textContent = 'Update character';
    document.querySelector('#delete-character').classList.remove('hidden');
  }
}
renderCharacters();
updatePreview();
initializeDataFolder();
