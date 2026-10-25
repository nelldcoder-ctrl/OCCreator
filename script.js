const STORAGE_KEY = 'fable.characters.v1';
const DRAFT_KEY = 'fable.draft.v1';
const STORIES_STORAGE_KEY = 'fable.stories.v1';
const STORY_DRAFTS_KEY = 'fable.story-drafts.v1';
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_UPLOAD_BYTES * 4 / 3) + 1000;
const MAX_GALLERY_VALUE_LENGTH = 20_000_000;
const FOLDER_DB_NAME = 'fable.character-data';
const FOLDER_STORE = 'settings';
const FOLDER_HANDLE_KEY = 'directory-handle';
const DEFAULT_STORY_BACKGROUND = '#fbfdff';
const form = document.querySelector('#character-form');
const characterGrid = document.querySelector('#character-grid');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');
const imagePreview = document.querySelector('#portrait-image');
const placeholder = document.querySelector('#portrait-placeholder');
const coverPreview = document.querySelector('#cover-preview');
const previewAvatarPlaceholder = document.querySelector('#preview-avatar-placeholder');
const characterDialog = document.querySelector('#character-dialog');
const aboutDialog = document.querySelector('#about-dialog');
const deleteDialog = document.querySelector('#delete-dialog');
const imageCropDialog = document.querySelector('#image-crop-dialog');
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
let aboutCloseTimer = null;
let aboutReturnFocus = null;
let pendingDeleteId = '';
let pendingDeleteKind = '';
let activeProfile = null;
let profileGalleryRendered = false;
let draftSaveWarningShown = false;
let characterFormHasChanges = false;
let imageCropState = {
  avatar: { zoom: 1, x: 0, y: 0 },
  cover: { zoom: 1, x: 0, y: 0 },
};
let pendingImageCrop = null;
let imageCropRequestId = 0;
const imageCandidateDirtyBefore = { avatar: null, cover: null };
let dataDirectory = null;
let folderWritePending = Promise.resolve();
const STORY_FONTS = {
  playfair: "'Playfair Display', Georgia, serif",
  'dm-sans': "'DM Sans', sans-serif",
  'roboto-slab': "'Roboto Slab', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  cormorant: "'Cormorant Garamond', Georgia, serif",
  'libre-baskerville': "'Libre Baskerville', Georgia, serif",
  lato: "'Lato', sans-serif",
  'nunito-sans': "'Nunito Sans', sans-serif",
  caveat: "'Caveat', cursive",
  'roboto-mono': "'Roboto Mono', monospace",
  georgia: 'Georgia, serif',
  courier: "'Courier New', monospace",
};
const storedStories = readStorage(STORIES_STORAGE_KEY, null);
let savedStories = normalizeStories(storedStories);
const storyDrafts = normalizeStoryDrafts(readStorage(STORY_DRAFTS_KEY, {}));
let activeStoryId = '';
let storyReturnFocus = null;
let previewStoryId = '';
let previewFromEditor = false;
if (!Array.isArray(storedStories)) {
  const migratedStories = migrateLegacyLore(readStorage('fable.lore.v1', null));
  if (migratedStories.length) {
    savedStories = migratedStories;
    writeStorage(STORIES_STORAGE_KEY, savedStories);
  }
}

const modalDialogs = [
  characterDialog,
  aboutDialog,
  deleteDialog,
  imageCropDialog,
  document.querySelector('#story-dialog'),
];
let lockedScrollY = null;
let bodyScrollStyles = null;

function syncModalScrollLock() {
  const isModalOpen = modalDialogs.some((dialog) => dialog.open);
  if (isModalOpen && lockedScrollY === null) {
    lockedScrollY = window.scrollY;
    bodyScrollStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  document.documentElement.classList.toggle('modal-open', isModalOpen);
  document.body.classList.toggle('modal-open', isModalOpen);
  syncToastLayer();
  if (!isModalOpen && lockedScrollY !== null) {
    const scrollY = lockedScrollY;
    const scrollBehavior = document.documentElement.style.scrollBehavior;
    Object.entries(bodyScrollStyles).forEach(([property, value]) => {
      document.body.style[property] = value;
    });
    lockedScrollY = null;
    bodyScrollStyles = null;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, scrollY);
    document.documentElement.style.scrollBehavior = scrollBehavior;
  }
}

function hasWorkInProgress() {
  const characterDraft = readStorage(DRAFT_KEY, null);
  const hasCharacterDraft = characterDraft && typeof characterDraft === 'object'
    && Object.values(characterDraft).some((value) => (typeof value === 'string' && value.trim()) || (Array.isArray(value) && value.length));
  const storyDialog = document.querySelector('#story-dialog');
  const hasOpenStoryDraft = storyDialog.open && activeStoryId && storyDrafts[activeStoryId]
    && (storyDrafts[activeStoryId].title || storyDrafts[activeStoryId].text.trim() || storyDrafts[activeStoryId].image);
  return Boolean(hasCharacterDraft || characterFormHasChanges || hasOpenStoryDraft);
}

window.addEventListener('beforeunload', (event) => {
  if (!hasWorkInProgress()) return;
  event.preventDefault();
  event.returnValue = 'You have work in progress. Reloading may discard your latest changes.';
});

modalDialogs.forEach((dialog) => dialog.addEventListener('close', syncModalScrollLock));

function normalizeImageCrop(value) {
  const parts = typeof value === 'string' ? value.split(',') : [];
  const zoom = typeof value === 'object' && value ? Number(value.zoom) : Number(parts[0]);
  const x = typeof value === 'object' && value ? Number(value.x) : Number(parts[1]);
  const y = typeof value === 'object' && value ? Number(value.y) : Number(parts[2]);
  const safeZoom = Number.isFinite(zoom) ? Math.min(3, Math.max(1, zoom)) : 1;
  const maxPan = (safeZoom - 1) * 50;
  return {
    zoom: safeZoom,
    x: Number.isFinite(x) ? Math.min(maxPan, Math.max(-maxPan, x)) : 0,
    y: Number.isFinite(y) ? Math.min(maxPan, Math.max(-maxPan, y)) : 0,
  };
}

function serializeImageCrop(crop) {
  return [crop.zoom, crop.x, crop.y].map((value) => Number(value.toFixed(2))).join(',');
}

function applyImageCrop(image, cropValue) {
  const crop = normalizeImageCrop(cropValue);
  image.style.setProperty('--image-zoom', crop.zoom);
  image.style.setProperty('--image-x', `${crop.x}%`);
  image.style.setProperty('--image-y', `${crop.y}%`);
}

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
    avatarCrop: serializeImageCrop(imageCropState.avatar),
    coverCrop: serializeImageCrop(imageCropState.cover),
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

function normalizeStoryBackground(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : DEFAULT_STORY_BACKGROUND;
}

function storyTextPalette(backgroundColor) {
  const channels = backgroundColor.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const luminance = channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  return luminance > 0.42
    ? { heading: '#294d65', body: '#405d70', muted: '#6c8798' }
    : { heading: '#f4f8fc', body: '#e7eff8', muted: '#c5d7e6' };
}

function normalizeStories(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((story) => story && typeof story === 'object' && typeof story.id === 'string')
    .map((story) => ({
      id: story.id,
      title: typeof story.title === 'string' ? story.title : '',
      text: typeof story.text === 'string' ? story.text : '',
      titleFont: STORY_FONTS[story.titleFont] ? story.titleFont : 'playfair',
      bodyFont: STORY_FONTS[story.bodyFont] ? story.bodyFont : 'dm-sans',
      backgroundColor: normalizeStoryBackground(story.backgroundColor),
      image: typeof story.image === 'string' ? story.image : '',
      updatedAt: typeof story.updatedAt === 'string' ? story.updatedAt : '',
    }));
}

function normalizeStoryDrafts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, story]) => id && story && typeof story === 'object')
    .map(([id, story]) => [id, {
      id,
      title: typeof story.title === 'string' ? story.title : '',
      text: typeof story.text === 'string' ? story.text : '',
      titleFont: STORY_FONTS[story.titleFont] ? story.titleFont : 'playfair',
      bodyFont: STORY_FONTS[story.bodyFont] ? story.bodyFont : 'dm-sans',
      backgroundColor: normalizeStoryBackground(story.backgroundColor),
      image: typeof story.image === 'string' ? story.image : '',
      updatedAt: typeof story.updatedAt === 'string' ? story.updatedAt : '',
    }]));
}

function migrateLegacyLore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const sections = [];
  if (typeof value.setting === 'string' && value.setting.trim()) sections.push(`Setting\n${value.setting.trim()}`);
  if (typeof value.premise === 'string' && value.premise.trim()) sections.push(`Story idea\n${value.premise.trim()}`);
  if (typeof value.conflict === 'string' && value.conflict.trim()) sections.push(`Main problem\n${value.conflict.trim()}`);
  if (Array.isArray(value.plotPoints) && value.plotPoints.length) {
    sections.push(`Story events\n${value.plotPoints.map((point) => [point.title, point.description].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')}`);
  }
  if (!sections.length && typeof value.name !== 'string') return [];
  return [{
    id: createId(),
    title: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'My story',
    text: sections.join('\n\n'),
    titleFont: 'playfair',
    bodyFont: 'dm-sans',
    backgroundColor: DEFAULT_STORY_BACKGROUND,
    image: '',
    updatedAt: new Date().toISOString(),
  }];
}

function currentStoryDraft() {
  return {
    id: activeStoryId,
    title: document.querySelector('#story-title').value.trim(),
    text: document.querySelector('#story-text').value,
    titleFont: STORY_FONTS[document.querySelector('#story-title-font').value] ? document.querySelector('#story-title-font').value : 'playfair',
    bodyFont: STORY_FONTS[document.querySelector('#story-body-font').value] ? document.querySelector('#story-body-font').value : 'dm-sans',
    backgroundColor: normalizeStoryBackground(document.querySelector('#story-background').value),
    image: document.querySelector('#story-image-url').value.trim(),
    updatedAt: new Date().toISOString(),
  };
}

function updateStoryPreview(story) {
  const hasContent = Boolean(story && (story.title || story.text || story.image));
  const titleFont = STORY_FONTS[story?.titleFont] || STORY_FONTS.playfair;
  const bodyFont = STORY_FONTS[story?.bodyFont] || STORY_FONTS['dm-sans'];
  const backgroundColor = normalizeStoryBackground(story?.backgroundColor);
  const textPalette = storyTextPalette(backgroundColor);
  const imageSource = story?.image?.trim() || '';
  document.querySelector('#story-preview-open').disabled = !hasContent;
  document.querySelector('#story-editor-preview').disabled = !hasContent;
  const readingTitle = document.querySelector('#story-reading-title');
  const readingText = document.querySelector('#story-reading-text');
  const readingCoverWrap = document.querySelector('#story-reading-cover-wrap');
  const readingCover = document.querySelector('#story-reading-cover');
  readingTitle.textContent = story?.title || 'Your story title';
  readingText.textContent = story?.text || '';
  readingTitle.style.fontFamily = titleFont;
  readingText.style.fontFamily = bodyFont;
  [document.querySelector('#story-reading-view'), document.querySelector('#story-form')].forEach((element) => {
    element.style.setProperty('--story-background', backgroundColor);
    element.style.setProperty('--story-heading-color', textPalette.heading);
    element.style.setProperty('--story-body-color', textPalette.body);
    element.style.setProperty('--story-muted-color', textPalette.muted);
  });
  document.querySelector('#story-title-font').style.fontFamily = titleFont;
  document.querySelector('#story-body-font').style.fontFamily = bodyFont;
  document.querySelector('#story-editor-title').style.fontFamily = titleFont;
  document.querySelector('#story-title').style.fontFamily = titleFont;
  document.querySelector('#story-text').style.fontFamily = bodyFont;
  document.querySelector('#story-reading-view').classList.toggle('has-cover', Boolean(imageSource && validImageSource(imageSource)));
  if (imageSource && validImageSource(imageSource)) {
    readingCover.alt = story?.title ? `${story.title} cover` : 'Story cover';
    readingCoverWrap.classList.remove('hidden');
    if (readingCover.dataset.imageSource !== imageSource) {
      setImageSource(readingCover, imageSource, () => readingCoverWrap.classList.add('hidden'));
    }
  } else {
    readingCover.removeAttribute('src');
    readingCover.dataset.imageSource = '';
    readingCoverWrap.classList.add('hidden');
  }
}

function setStoryDialogMode(mode) {
  const isPreview = mode === 'preview';
  const dialog = document.querySelector('#story-dialog');
  document.querySelector('#story-form').classList.toggle('hidden', isPreview);
  document.querySelector('#story-reading-view').classList.toggle('hidden', !isPreview);
  document.querySelector('#story-back-to-draft').classList.toggle('hidden', !isPreview || !previewFromEditor);
  dialog.setAttribute('aria-labelledby', isPreview ? 'story-reading-title' : 'story-editor-title');
}

function openStoryPreview() {
  const dialog = document.querySelector('#story-dialog');
  const editorIsOpen = dialog.open && !document.querySelector('#story-form').classList.contains('hidden');
  if (editorIsOpen) {
    handleStoryEditorInput();
    previewStoryId = activeStoryId;
  }
  previewFromEditor = editorIsOpen;
  const story = editorIsOpen
    ? storyDrafts[activeStoryId] || savedStories.find((item) => item.id === activeStoryId)
    : Object.values(storyDrafts).find((item) => item.id === previewStoryId)
      || savedStories.find((item) => item.id === previewStoryId);
  if (!story) {
    showToast('Write a story first to open its preview.');
    return;
  }
  activeStoryId = story.id;
  updateStoryPreview(story);
  setStoryDialogMode('preview');
  document.querySelector('#story-save-status').textContent = storyDrafts[story.id] ? 'Draft preview' : 'Saved story';
  if (!dialog.open) {
    storyReturnFocus = document.activeElement;
    dialog.showModal();
    syncModalScrollLock();
  }
  document.querySelector('#story-preview-edit').focus();
  updateBackToTopVisibility();
}

function handleStoryEditorInput() {
  const draft = currentStoryDraft();
  updateStoryPreview(draft);
  saveStoryDraft();
}

function handleStoryImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose a valid image that is 5 MB or smaller. You can also paste an image link.');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    document.querySelector('#story-image-url').value = String(reader.result);
    handleStoryEditorInput();
  });
  reader.addEventListener('error', () => showToast('Could not read that image. Try another file or paste an image link.'));
  reader.readAsDataURL(file);
}

function renderStories() {
  const library = document.querySelector('#story-library');
  library.replaceChildren();
  const savedById = new Map(savedStories.map((story) => [story.id, story]));
  const items = [...savedStories];
  Object.values(storyDrafts).forEach((draft) => {
    const saved = savedById.get(draft.id);
    const item = { ...draft, isDraft: true };
    if (saved) items[items.findIndex((story) => story.id === draft.id)] = item;
    else items.unshift(item);
  });
  items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  items.forEach((story) => {
    const item = document.createElement('div');
    item.className = 'story-card-item';
    const card = document.createElement('button');
    card.className = 'story-card';
    card.type = 'button';
    card.setAttribute('aria-label', `${story.isDraft ? 'Continue draft' : 'Open story'}: ${story.title || 'Untitled story'}`);
    const header = document.createElement('span');
    header.className = 'story-card-header';
    const label = document.createElement('span');
    label.className = 'story-card-label';
    label.textContent = story.isDraft ? 'DRAFT' : 'STORY';
    const date = document.createElement('span');
    date.className = 'story-card-date';
    date.textContent = story.updatedAt
      ? new Date(story.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    header.append(label, date);
    const title = document.createElement('strong');
    title.textContent = story.title || 'Untitled story';
    title.style.fontFamily = STORY_FONTS[story.titleFont] || STORY_FONTS.playfair;
    const excerpt = document.createElement('span');
    excerpt.className = 'story-card-excerpt';
    excerpt.textContent = story.text.trim() || 'Nothing written yet. Open this story to keep going.';
    const action = document.createElement('span');
    action.className = 'story-card-action';
    action.textContent = story.isDraft ? 'Continue writing →' : 'Open story →';
    date.style.marginRight = '30px';
    if (story.image && validImageSource(story.image)) {
      const cover = document.createElement('img');
      cover.className = 'story-card-cover';
      cover.alt = '';
      setImageSource(cover, story.image, () => cover.classList.add('hidden'));
      card.append(cover);
    }
    card.append(header, title, excerpt, action);
    card.addEventListener('click', () => {
      previewStoryId = story.id;
      updateStoryPreview(story);
      openStoryEditor(story.id, card);
    });
    const remove = document.createElement('button');
    remove.className = 'card-delete-button story-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${story.isDraft ? 'draft' : 'story'}: ${story.title || 'Untitled story'}`);
    remove.title = `Delete ${story.isDraft ? 'draft' : 'story'}`;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(story.id, 'story', story, remove);
    });
    item.append(card, remove);
    library.append(item);
  });
  library.classList.toggle('is-horizontal', items.length >= 4);
  if (items.length >= 4) {
    library.tabIndex = 0;
    library.setAttribute('aria-label', 'Stories. Scroll horizontally to see more.');
  } else {
    library.removeAttribute('tabindex');
    library.removeAttribute('aria-label');
  }
  document.querySelector('#story-sidebar-count').textContent = String(items.length);
  document.querySelector('#lore-count').textContent = `(${items.length})`;
  document.querySelector('#story-empty').classList.toggle('hidden', items.length > 0);
  library.classList.toggle('hidden', items.length === 0);
  const previewStory = items.find((story) => story.id === previewStoryId) || items[0];
  if (previewStory) {
    previewStoryId = previewStory.id;
    updateStoryPreview(previewStory);
  } else {
    previewStoryId = '';
    updateStoryPreview(null);
  }
}

function openStoryEditor(storyId = '', returnFocus = document.activeElement) {
  activeStoryId = storyId || createId();
  storyReturnFocus = returnFocus;
  const saved = savedStories.find((story) => story.id === activeStoryId);
  const draft = storyDrafts[activeStoryId];
  const story = draft || saved || {
    id: activeStoryId, title: '', text: '', titleFont: 'playfair', bodyFont: 'dm-sans',
    backgroundColor: DEFAULT_STORY_BACKGROUND, image: '',
  };
  document.querySelector('#story-title').value = story.title;
  document.querySelector('#story-text').value = story.text;
  document.querySelector('#story-title-font').value = story.titleFont || 'playfair';
  document.querySelector('#story-body-font').value = story.bodyFont || 'dm-sans';
  document.querySelector('#story-background').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-background-hex').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-image-url').value = story.image;
  document.querySelector('#story-editor-title').textContent = story.title || 'Write a story';
  document.querySelector('#story-save-status').textContent = draft
    ? 'Draft saved on this device'
    : saved ? 'Story saved on this device' : 'Draft autosaves here';
  setStoryDialogMode('edit');
  const dialog = document.querySelector('#story-dialog');
  if (!dialog.open) dialog.showModal();
  document.querySelector('#story-style-settings').open = Boolean(story.image
    || story.titleFont !== 'playfair' || story.bodyFont !== 'dm-sans'
    || story.backgroundColor !== DEFAULT_STORY_BACKGROUND);
  updateStoryPreview(story);
  syncModalScrollLock();
  updateBackToTopVisibility();
  document.querySelector('#story-title').focus();
}

function saveCurrentStory() {
  const story = currentStoryDraft();
  if (!story.title) {
    showToast('Add a title so you can find this story later.');
    document.querySelector('#story-title').focus();
    return;
  }
  if (story.image && !validImageSource(story.image)) {
    showToast('Add a direct http(s) image link or upload an image file.');
    document.querySelector('#story-image-url').focus();
    return;
  }
  const nextStories = [...savedStories];
  const existingIndex = nextStories.findIndex((item) => item.id === story.id);
  if (existingIndex >= 0) nextStories[existingIndex] = story;
  else nextStories.unshift(story);
  if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) {
    showToast('Could not save this story. Your browser storage may be full.');
    return;
  }
  savedStories.splice(0, savedStories.length, ...nextStories);
  delete storyDrafts[story.id];
  if (!writeStorage(STORY_DRAFTS_KEY, storyDrafts)) {
    showToast('Story saved, but its temporary draft could not be cleared.');
  }
  document.querySelector('#story-save-status').textContent = 'Story saved on this device';
  document.querySelector('#story-editor-title').textContent = story.title;
  renderStories();
}

function saveStoryDraft() {
  const draft = currentStoryDraft();
  const saved = savedStories.find((story) => story.id === draft.id);
  const unchanged = saved && saved.title === draft.title && saved.text === draft.text
    && saved.titleFont === draft.titleFont && saved.bodyFont === draft.bodyFont
    && saved.backgroundColor === draft.backgroundColor && saved.image === draft.image;
  if (unchanged) {
    delete storyDrafts[draft.id];
    writeStorage(STORY_DRAFTS_KEY, storyDrafts);
    document.querySelector('#story-save-status').textContent = 'Story saved on this device';
    return;
  }
  storyDrafts[draft.id] = draft;
  if (!writeStorage(STORY_DRAFTS_KEY, storyDrafts)) {
    document.querySelector('#story-save-status').textContent = 'Draft not saved';
    showToast('Could not autosave this draft. Save the story before closing.');
    return;
  }
  document.querySelector('#story-save-status').textContent = 'Draft saved on this device';
  document.querySelector('#story-editor-title').textContent = draft.title || 'Write a story';
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

function validImageSource(value) {
  const source = value.trim();
  return source.startsWith('data:image/') || validWebUrl(source);
}

function setImageSource(image, value, onError = () => {}) {
  const source = (value || '').trim();
  image.dataset.imageSource = '';
  image.onerror = null;
  image.onload = null;
  if (!source || !validImageSource(source)) {
    image.removeAttribute('src');
    image.classList.add('hidden');
    return false;
  }
  image.dataset.imageSource = source;
  image.onload = () => {
    if (image.dataset.imageSource === source) image.classList.remove('hidden');
  };
  image.onerror = () => {
    if (image.dataset.imageSource !== source) return;
    image.classList.add('hidden');
    onError();
  };
  image.src = source;
  image.classList.remove('hidden');
  return true;
}

function updatePreview() {
  const profile = currentProfile();
  const position = characters.findIndex((character) => character.id === profile.id);
  const profileBackground = profile.accent || '#4385e8';
  document.querySelector('#profile-preview').style.setProperty('--card-accent', profileBackground);
  document.querySelector('#profile-preview').style.setProperty('--profile-background', profileBackground);
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

  const hasCover = setImageSource(coverPreview, profile.cover, () => {
    document.querySelector('#preview-art').classList.remove('has-cover');
    placeholder.classList.remove('hidden');
    showToast('Could not load the cover image. Use a direct image URL or upload an image file.');
  });
  applyImageCrop(coverPreview, profile.coverCrop);
  if (setImageSource(imagePreview, profile.avatar, () => {
    previewAvatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    previewAvatarPlaceholder.classList.remove('hidden');
    showToast('Could not load the profile picture. Use a direct image URL or upload an image file.');
  })) {
    previewAvatarPlaceholder.classList.add('hidden');
  } else {
    previewAvatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    previewAvatarPlaceholder.classList.remove('hidden');
  }
  applyImageCrop(imagePreview, profile.avatarCrop);
  placeholder.classList.toggle('hidden', hasCover);
  if (hasCover) {
    document.querySelector('#preview-art').classList.add('has-cover');
  } else {
    document.querySelector('#preview-art').classList.remove('has-cover');
  }
}

function renderCharacters() {
  const query = document.querySelector('#search-characters').value.trim().toLowerCase();
  const filtered = characters.filter((character) => [
    character.name,
    character.role,
    character.species,
    character.description,
    ...(character.traits || []),
  ].join(' ').toLowerCase().includes(query));
  characterGrid.replaceChildren();
  filtered.forEach((character) => {
    const item = document.createElement('div');
    item.className = 'character-card-item';
    const card = document.createElement('button');
    card.className = 'cast-card';
    card.type = 'button';
    card.style.setProperty('--thumb-accent', character.accent || '#4385e8');
    card.setAttribute('aria-label', `View profile for ${character.name}${character.role ? `, ${character.role}` : ''}`);
    card.title = [character.name, character.role, character.description].filter(Boolean).join(' — ');

    const thumb = document.createElement('span');
    thumb.className = 'cast-thumb';
    const initial = document.createElement('span');
    initial.className = 'cast-initial';
    initial.textContent = (character.name || '?').slice(0, 1).toUpperCase();
    thumb.append(initial);
    if (character.avatar) {
      const image = document.createElement('img');
      image.src = character.avatar;
      image.alt = '';
      image.loading = 'lazy';
      applyImageCrop(image, character.avatarCrop);
      image.addEventListener('error', () => {
        image.remove();
        thumb.classList.add('has-failed-image');
      }, { once: true });
      thumb.append(image);
    }

    const info = document.createElement('span');
    info.className = 'cast-info';
    const name = document.createElement('h3');
    name.textContent = character.name;
    const heading = document.createElement('span');
    heading.className = 'cast-role';
    heading.textContent = character.role || character.species || 'A character in your story';
    const description = document.createElement('span');
    description.className = 'cast-description';
    description.textContent = character.description || 'Their story is just beginning.';
    const traits = document.createElement('span');
    traits.className = 'cast-traits';
    const visibleTraits = (character.traits || []).slice(0, 3);
    if (visibleTraits.length) {
      visibleTraits.forEach((trait) => {
        const chip = document.createElement('span');
        chip.textContent = trait;
        traits.append(chip);
      });
    }
    const viewProfile = document.createElement('span');
    viewProfile.className = 'cast-view-profile';
    viewProfile.textContent = 'View profile';
    const arrow = document.createElement('span');
    arrow.className = 'cast-arrow';
    arrow.textContent = '↗';
    info.append(name, heading, description);
    if (visibleTraits.length) info.append(traits);
    info.append(viewProfile);
    card.append(thumb, info, arrow);
    card.addEventListener('click', () => openCharacterProfile(character, card));
    const remove = document.createElement('button');
    remove.className = 'card-delete-button character-delete-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete character: ${character.name}`);
    remove.title = `Delete ${character.name}`;
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      requestDeleteItem(character.id, 'character', character, remove);
    });
    item.append(card, remove);
    characterGrid.append(item);
  });

  characterGrid.classList.toggle('is-horizontal', filtered.length >= 4);
  if (filtered.length >= 4) {
    characterGrid.tabIndex = 0;
    characterGrid.setAttribute('aria-label', 'Character cards. Scroll horizontally to see more.');
  } else {
    characterGrid.removeAttribute('tabindex');
    characterGrid.removeAttribute('aria-label');
  }
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
    emptyState.querySelector('p').textContent = 'Create a character to see their card and profile details here.';
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
  characterDialog.style.setProperty('--profile-background', accent);
  document.querySelector('#profile-name').dataset.characterId = profile.id;
  setProfileText('#profile-name', profile.name, 'Your character');
  setProfileText('#profile-role', profile.role);
  setProfileText('#profile-quote', profile.description ? `“${profile.description}”` : '');
  setProfileText('#profile-about', profile.description, 'This character has no introduction yet.');

  const cover = document.querySelector('#profile-cover-image');
  const avatar = document.querySelector('#profile-avatar');
  const avatarPlaceholder = document.querySelector('#profile-avatar-placeholder');
  const coverImage = profile.cover || profile.avatar;
  const hasAvatar = setImageSource(avatar, profile.avatar, () => {
    avatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    avatarPlaceholder.classList.remove('hidden');
    showToast('Could not load the profile picture. Use a direct image URL or upload an image file.');
  });
  if (hasAvatar) {
    avatar.alt = `${profile.name || 'Character'} portrait`;
    avatar.decoding = 'async';
    applyImageCrop(avatar, profile.avatarCrop);
    avatarPlaceholder.classList.add('hidden');
  } else {
    avatarPlaceholder.textContent = (profile.name || '?').slice(0, 1).toUpperCase();
    avatarPlaceholder.classList.remove('hidden');
  }
  if (setImageSource(cover, coverImage, () => {
    showToast('Could not load the cover image. Use a direct image URL or upload an image file.');
  })) {
    cover.decoding = 'async';
    applyImageCrop(cover, profile.cover ? profile.coverCrop : profile.avatarCrop);
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
  syncModalScrollLock();
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
  imageCropState = {
    avatar: normalizeImageCrop(character.avatarCrop),
    cover: normalizeImageCrop(character.coverCrop),
  };
  rememberImageSources();
  document.querySelector('#accent-hex').value = document.querySelector('#accent').value;
  document.querySelector('#save-label').textContent = 'Update character';
  document.querySelector('#delete-character').classList.remove('hidden');
  localStorage.removeItem(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Editing saved character';
  characterFormHasChanges = false;
  updatePreview();
  document.querySelector('#studio').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  form.reset();
  document.querySelector('#character-id').value = '';
  document.querySelector('#accent').value = '#4385e8';
  document.querySelector('#accent-hex').value = '#4385e8';
  imageCropState = {
    avatar: { zoom: 1, x: 0, y: 0 },
    cover: { zoom: 1, x: 0, y: 0 },
  };
  rememberImageSources();
  activeId = '';
  document.querySelector('#save-label').textContent = 'Save character';
  document.querySelector('#delete-character').classList.add('hidden');
  document.querySelector('#appearance-details').open = false;
  document.querySelector('#profile-extras').open = false;
  localStorage.removeItem(DRAFT_KEY);
  characterFormHasChanges = false;
  document.querySelector('#autosave-status').textContent = 'Draft autosaves here';
  updatePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelector('#name').focus({ preventScroll: true });
}

function showToast(message) {
  toast.textContent = message;
  syncToastLayer();
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function syncToastLayer() {
  const activeDialog = modalDialogs.find((dialog) => dialog.open);
  const modalWindow = activeDialog?.querySelector('.profile-window');
  if (modalWindow) {
    if (toast.parentElement !== modalWindow) modalWindow.append(toast);
    toast.classList.add('toast-in-modal');
  } else {
    if (toast.parentElement !== document.body) document.body.append(toast);
    toast.classList.remove('toast-in-modal');
  }
}

function updateBackToTopVisibility() {
  const button = document.querySelector('#back-to-top');
  button.classList.toggle('is-visible', window.scrollY > 360 && !characterDialog.open && !aboutDialog.open && !document.querySelector('#story-dialog').open);
}

document.querySelector('#back-to-top').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });

form.addEventListener('input', (event) => {
  if (event.target.id === 'avatar' || event.target.id === 'cover') return;
  characterFormHasChanges = true;
  updatePreview();
  saveDraft();
});

document.querySelector('#accent-hex').addEventListener('input', (event) => {
  const hex = event.currentTarget.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    document.querySelector('#accent').value = hex;
  }
});

document.querySelector('#accent').addEventListener('input', (event) => {
  document.querySelector('#accent-hex').value = event.currentTarget.value;
});

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    showToast('Choose an image that is 5 MB or smaller.');
    event.target.value = '';
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Choose a valid image file.');
    event.target.value = '';
    return;
  }
  const kind = event.target.id === 'cover-file' ? 'cover' : 'avatar';
  if (imageCandidateDirtyBefore[kind] === null) imageCandidateDirtyBefore[kind] = characterFormHasChanges;
  characterFormHasChanges = true;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    openImageCropDialog(kind, String(reader.result), imageField(kind).dataset.confirmedSource || '', {
      zoom: 1, x: 0, y: 0,
    }, event.target);
  });
  reader.addEventListener('error', () => {
    characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
    imageCandidateDirtyBefore[kind] = null;
    showToast('Could not read this image file. Try another image or paste an image URL.');
  });
  reader.readAsDataURL(file);
}

function imageField(kind) {
  return document.querySelector(`#${kind}`);
}

function rememberImageSources() {
  ['avatar', 'cover'].forEach((kind) => {
    imageField(kind).dataset.confirmedSource = imageField(kind).value.trim();
    imageCandidateDirtyBefore[kind] = null;
  });
}

function setCropPreview(crop) {
  const preview = document.querySelector('#image-crop-preview');
  applyImageCrop(preview, serializeImageCrop(crop));
  const maxPan = (crop.zoom - 1) * 50;
  ['x', 'y'].forEach((axis) => {
    const control = document.querySelector(`#image-crop-${axis}`);
    control.min = String(-maxPan);
    control.max = String(maxPan);
    control.value = String(crop[axis]);
    control.disabled = maxPan === 0;
  });
  document.querySelector('#image-crop-zoom').value = String(crop.zoom);
  document.querySelector('#image-crop-zoom-value').textContent = `${crop.zoom.toFixed(1)}×`;
}

function openImageCropDialog(kind, source, previousSource, crop, returnFocus = imageField(kind)) {
  if (imageCropDialog.open) return;
  const cleanSource = source.trim();
  if (!cleanSource || !validImageSource(cleanSource)) {
    showToast('Add a direct image URL or upload an image before editing it.');
    return;
  }
  const requestId = ++imageCropRequestId;
  const image = new Image();
  image.onload = () => {
    if (requestId !== imageCropRequestId || imageCropDialog.open) return;
    pendingImageCrop = {
      kind,
      source: cleanSource,
      previousSource,
      crop: normalizeImageCrop(serializeImageCrop(crop)),
      returnFocus,
      dirtyBefore: imageCandidateDirtyBefore[kind] ?? characterFormHasChanges,
    };
    const preview = document.querySelector('#image-crop-preview');
    preview.src = cleanSource;
    const frame = document.querySelector('#image-crop-frame');
    frame.classList.toggle('is-avatar', kind === 'avatar');
    frame.classList.toggle('is-cover', kind === 'cover');
    setCropPreview(pendingImageCrop.crop);
    imageCropDialog.showModal();
    syncModalScrollLock();
    document.querySelector('#image-crop-zoom').focus();
  };
  image.onerror = () => {
    if (requestId !== imageCropRequestId) return;
    imageField(kind).value = previousSource;
    imageField(kind).dataset.confirmedSource = previousSource;
    characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
    imageCandidateDirtyBefore[kind] = null;
    updatePreview();
    showToast('Could not load this image. Use a direct image URL or choose another file.');
  };
  image.src = cleanSource;
}

function cancelImageCrop() {
  if (!imageCropDialog.open) return;
  closeImageCrop(false);
}

function closeImageCrop(confirmed) {
  imageCropRequestId += 1;
  const pending = pendingImageCrop;
  pendingImageCrop = null;
  if (pending && !confirmed) {
    imageField(pending.kind).value = pending.previousSource;
    imageField(pending.kind).dataset.confirmedSource = pending.previousSource;
    characterFormHasChanges = pending.dirtyBefore;
  } else if (pending) {
    characterFormHasChanges = true;
  }
  if (pending) imageCandidateDirtyBefore[pending.kind] = null;
  document.querySelector('#image-crop-preview').removeAttribute('src');
  if (imageCropDialog.open) imageCropDialog.close();
  syncModalScrollLock();
  if (pending?.returnFocus instanceof HTMLElement && pending.returnFocus.isConnected) pending.returnFocus.focus();
}

['avatar', 'cover'].forEach((kind) => {
  const field = imageField(kind);
  field.addEventListener('input', () => {
    if (field.value.trim()) {
      if (field.value.trim() !== field.dataset.confirmedSource) {
        if (imageCandidateDirtyBefore[kind] === null) imageCandidateDirtyBefore[kind] = characterFormHasChanges;
        characterFormHasChanges = true;
      }
      return;
    }
    imageCandidateDirtyBefore[kind] = null;
    imageCropState[kind] = { zoom: 1, x: 0, y: 0 };
    field.dataset.confirmedSource = '';
    characterFormHasChanges = true;
    updatePreview();
    saveDraft();
  });
  field.addEventListener('change', () => {
    const source = field.value.trim();
    const previousSource = field.dataset.confirmedSource || '';
    if (!source) return;
    if (source === previousSource) {
      if (imageCandidateDirtyBefore[kind] !== null) {
        characterFormHasChanges = imageCandidateDirtyBefore[kind];
        imageCandidateDirtyBefore[kind] = null;
      }
      return;
    }
    if (!validImageSource(source)) {
      field.value = previousSource;
      characterFormHasChanges = imageCandidateDirtyBefore[kind] ?? characterFormHasChanges;
      imageCandidateDirtyBefore[kind] = null;
      showToast('Use a direct http(s) image URL, or upload an image file.');
      return;
    }
    openImageCropDialog(kind, source, previousSource, { zoom: 1, x: 0, y: 0 });
  });
  document.querySelector(`#edit-${kind}-crop`).addEventListener('click', (event) => {
    const source = field.value.trim();
    if (!source) {
      showToast(`Add a ${kind === 'avatar' ? 'profile picture' : 'cover image'} URL or upload an image first.`);
      return;
    }
    if (source !== field.dataset.confirmedSource) return;
    openImageCropDialog(kind, source, field.dataset.confirmedSource || source, imageCropState[kind], event.currentTarget);
  });
});

document.querySelector('#image-crop-zoom').addEventListener('input', (event) => {
  if (!pendingImageCrop) return;
  const zoom = Number(event.currentTarget.value);
  const maxPan = (zoom - 1) * 50;
  pendingImageCrop.crop.zoom = zoom;
  pendingImageCrop.crop.x = Math.min(maxPan, Math.max(-maxPan, pendingImageCrop.crop.x));
  pendingImageCrop.crop.y = Math.min(maxPan, Math.max(-maxPan, pendingImageCrop.crop.y));
  setCropPreview(pendingImageCrop.crop);
});

['x', 'y'].forEach((axis) => {
  document.querySelector(`#image-crop-${axis}`).addEventListener('input', (event) => {
    if (!pendingImageCrop) return;
    pendingImageCrop.crop[axis] = Number(event.currentTarget.value);
    setCropPreview(pendingImageCrop.crop);
  });
});

const cropFrame = document.querySelector('#image-crop-frame');
cropFrame.addEventListener('pointerdown', (event) => {
  if (!pendingImageCrop || pendingImageCrop.crop.zoom <= 1) return;
  cropFrame.setPointerCapture(event.pointerId);
  cropFrame.dataset.dragX = String(event.clientX);
  cropFrame.dataset.dragY = String(event.clientY);
  cropFrame.dataset.cropX = String(pendingImageCrop.crop.x);
  cropFrame.dataset.cropY = String(pendingImageCrop.crop.y);
  cropFrame.classList.add('is-dragging');
});
cropFrame.addEventListener('pointermove', (event) => {
  if (!pendingImageCrop || !cropFrame.hasPointerCapture(event.pointerId)) return;
  const zoom = pendingImageCrop.crop.zoom;
  const maxPan = (zoom - 1) * 50;
  const width = cropFrame.clientWidth;
  const height = cropFrame.clientHeight;
  pendingImageCrop.crop.x = Math.min(maxPan, Math.max(-maxPan,
    Number(cropFrame.dataset.cropX) + ((event.clientX - Number(cropFrame.dataset.dragX)) / width) * 100));
  pendingImageCrop.crop.y = Math.min(maxPan, Math.max(-maxPan,
    Number(cropFrame.dataset.cropY) + ((event.clientY - Number(cropFrame.dataset.dragY)) / height) * 100));
  setCropPreview(pendingImageCrop.crop);
});
cropFrame.addEventListener('pointerup', () => cropFrame.classList.remove('is-dragging'));
cropFrame.addEventListener('pointercancel', () => cropFrame.classList.remove('is-dragging'));

document.querySelector('#confirm-image-crop').addEventListener('click', () => {
  if (!pendingImageCrop) return;
  const { kind, source, crop } = pendingImageCrop;
  imageField(kind).value = source;
  imageField(kind).dataset.confirmedSource = source;
  imageCropState[kind] = normalizeImageCrop(serializeImageCrop(crop));
  characterFormHasChanges = true;
  updatePreview();
  saveDraft();
  closeImageCrop(true);
});
document.querySelectorAll('#cancel-image-crop, #cancel-image-crop-action').forEach((button) => {
  button.addEventListener('click', cancelImageCrop);
});
imageCropDialog.addEventListener('click', (event) => {
  if (event.target === imageCropDialog) cancelImageCrop();
});
imageCropDialog.addEventListener('close', () => {
  if (pendingImageCrop) closeImageCrop(false);
});
imageCropDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelImageCrop();
});

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}. Try another image.`)));
    reader.readAsDataURL(file);
  });
}

async function handleGalleryImageUpload(event) {
  const input = event.currentTarget;
  const files = [...(input.files || [])];
  if (!files.length) return;
  try {
    const urls = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a valid image.`);
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error(`${file.name} is larger than 5 MB.`);
      urls.push(await readImageFile(file));
    }
    const galleryInput = document.querySelector('#gallery');
    const current = galleryInput.value.trim();
    const nextValue = [current, ...urls].filter(Boolean).join('\n');
    if (nextValue.length > MAX_GALLERY_VALUE_LENGTH) {
      throw new Error('There is not enough room for these extra images. Upload fewer images or use direct image links.');
    }
    galleryInput.value = nextValue;
    galleryInput.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not upload these images.');
  } finally {
    input.value = '';
  }
}

document.querySelector('#avatar-file').addEventListener('change', handleImageUpload);
document.querySelector('#cover-file').addEventListener('change', handleImageUpload);
document.querySelector('#select-avatar-file').addEventListener('click', () => document.querySelector('#avatar-file').click());
document.querySelector('#select-cover-file').addEventListener('click', () => document.querySelector('#cover-file').click());
document.querySelector('#select-gallery-files').addEventListener('click', () => document.querySelector('#gallery-files').click());
document.querySelector('#gallery-files').addEventListener('change', handleGalleryImageUpload);

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

document.querySelector('#about-website').addEventListener('click', (event) => {
  aboutReturnFocus = event.currentTarget;
  aboutDialog.classList.remove('is-closing');
  aboutDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#about-close').focus();
});
function requestAboutClose() {
  if (!aboutDialog.open || aboutDialog.classList.contains('is-closing')) return;
  aboutDialog.classList.add('is-closing');
  const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  aboutCloseTimer = window.setTimeout(() => {
    aboutDialog.close();
    aboutCloseTimer = null;
  }, delay);
}
document.querySelector('#about-close').addEventListener('click', requestAboutClose);
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) requestAboutClose();
});
aboutDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestAboutClose();
});
aboutDialog.addEventListener('close', () => {
  if (aboutCloseTimer) {
    window.clearTimeout(aboutCloseTimer);
    aboutCloseTimer = null;
  }
  aboutDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (aboutReturnFocus instanceof HTMLElement && aboutReturnFocus.isConnected) aboutReturnFocus.focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (imageCropDialog.open) return;
  const unconfirmedImageKind = ['avatar', 'cover'].find((kind) => {
    const field = imageField(kind);
    return field.value.trim() && field.value.trim() !== field.dataset.confirmedSource;
  });
  if (unconfirmedImageKind) {
    const field = imageField(unconfirmedImageKind);
    openImageCropDialog(unconfirmedImageKind, field.value, field.dataset.confirmedSource || '', {
      zoom: 1, x: 0, y: 0,
    });
    return;
  }
  const profile = currentProfile();
  if (!profile.name) {
    document.querySelector('#name').focus();
    return;
  }
  const invalidImageField = ['avatar', 'cover'].find((field) => profile[field] && !validImageSource(profile[field]));
  if (invalidImageField) {
    showToast('Use a direct http(s) image URL, or upload an image file.');
    document.querySelector(`#${invalidImageField}`).focus();
    return;
  }
  profile.id = activeId || createId();
  const existingIndex = characters.findIndex((item) => item.id === profile.id);
  const nextCharacters = [...characters];
  if (existingIndex >= 0) nextCharacters[existingIndex] = profile;
  else nextCharacters.unshift(profile);
  let saved = writeStorage(STORAGE_KEY, nextCharacters);
  if (!saved) {
    try {
      localStorage.removeItem(DRAFT_KEY);
      saved = writeStorage(STORAGE_KEY, nextCharacters);
    } catch {
      saved = false;
    }
  }
  if (!saved) {
    showToast('Could not save. Your browser storage may be full.');
    return;
  }
  characters = nextCharacters;
  rememberImageSources();
  persistCharacterLibrary();
  activeId = profile.id;
  document.querySelector('#character-id').value = profile.id;
  localStorage.removeItem(DRAFT_KEY);
  characterFormHasChanges = false;
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
  ['avatarCrop', 'Portrait crop'], ['coverCrop', 'Cover crop'],
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

function yamlScalar(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => typeof item === 'string' ? JSON.stringify(item) : String(item)).join(', ')}]`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (value == null) return 'null';
  return String(value);
}

function toYaml(data) {
  return Object.entries(data).map(([key, value]) => {
    if (!Array.isArray(value)) return `${key}: ${yamlScalar(value)}`;
    if (!value.length) return `${key}: []`;
    return `${key}:\n${value.map((record) => {
      const entries = Object.entries(record);
      return entries.map(([field, fieldValue], index) => (
        `${index === 0 ? '  - ' : '    '}${field}: ${yamlScalar(fieldValue)}`
      )).join('\n');
    }).join('\n')}`;
  }).join('\n') + '\n';
}

function stripYamlComment(line) {
  let quoted = false;
  let singleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && !singleQuoted && line[index - 1] !== '\\') quoted = !quoted;
    else if (line[index] === "'" && !quoted) singleQuoted = !singleQuoted;
    else if (line[index] === '#' && !quoted && !singleQuoted && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseYamlScalar(value) {
  const scalar = value.trim();
  if (!scalar) return '';
  if (scalar.startsWith('"')) {
    try {
      return JSON.parse(scalar);
    } catch {
      throw new Error('YAML contains an invalid quoted value.');
    }
  }
  if (scalar.startsWith("'") && scalar.endsWith("'")) return scalar.slice(1, -1).replace(/''/g, "'");
  if (scalar.startsWith('[') && scalar.endsWith(']')) {
    const contents = scalar.slice(1, -1).trim();
    if (!contents) return [];
    return contents.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parseYamlScalar);
  }
  if (/^(null|~)$/i.test(scalar)) return '';
  if (/^(true|false)$/i.test(scalar)) return scalar.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(scalar)) return Number(scalar);
  return scalar;
}

function parseYaml(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const root = {};
  let collection = null;
  let record = null;
  let rootSequence = false;
  const parseEntry = (content) => {
    const separator = content.indexOf(':');
    if (separator < 1) throw new Error('YAML entries must use a key: value format.');
    return [content.slice(0, separator).trim(), content.slice(separator + 1).trim()];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = stripYamlComment(lines[index]);
    if (!raw.trim() || raw.trim() === '---' || raw.trim() === '...') continue;
    if (raw.includes('\t')) throw new Error('YAML indentation must use spaces, not tabs.');
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (indent === 0 && content.startsWith('- ')) {
      if (!rootSequence) {
        rootSequence = true;
        root.records = [];
      }
      record = {};
      root.records.push(record);
      const [key, value] = parseEntry(content.slice(2));
      record[key] = parseYamlScalar(value);
      collection = root.records;
      continue;
    }
    if (indent === 0) {
      record = null;
      const [key, value] = parseEntry(content);
      if (value) {
        root[key] = parseYamlScalar(value);
        collection = null;
      } else {
        root[key] = [];
        collection = root[key];
      }
      continue;
    }
    if (indent === 2 && content.startsWith('- ')) {
      if (!collection) throw new Error('YAML story or character lists must be under a named section.');
      record = {};
      collection.push(record);
      const [key, value] = parseEntry(content.slice(2));
      record[key] = parseYamlScalar(value);
      continue;
    }
    if (indent >= 4 && record) {
      const [key, value] = parseEntry(content);
      if (/^[|>][+-]?$/.test(value)) {
        const blockIndent = indent;
        const blockLines = [];
        while (index + 1 < lines.length) {
          const next = lines[index + 1];
          if (!next.trim()) {
            blockLines.push('');
            index += 1;
            continue;
          }
          const nextIndent = next.length - next.trimStart().length;
          if (nextIndent <= blockIndent) break;
          blockLines.push(next.slice(Math.min(nextIndent, blockIndent + 2)));
          index += 1;
        }
        record[key] = value.startsWith('>') ? blockLines.join(' ').trim() : blockLines.join('\n').replace(/\n+$/, '');
      } else {
        record[key] = parseYamlScalar(value);
      }
      continue;
    }
    throw new Error('Could not read the YAML structure. Use a list of records under stories: or characters:.');
  }
  return rootSequence ? root.records : root;
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
    avatar: toString(get('avatar', 'portrait', 'image', 'image url'), MAX_IMAGE_DATA_URL_LENGTH),
    cover: toString(get('cover', 'cover image', 'banner', 'banner image'), MAX_IMAGE_DATA_URL_LENGTH),
    avatarCrop: serializeImageCrop(normalizeImageCrop(get('avatarCrop', 'portrait crop'))),
    coverCrop: serializeImageCrop(normalizeImageCrop(get('coverCrop'))),
    accent,
    story: toString(get('story', 'backstory', 'background'), 700),
    gallery: toString(get('gallery', 'images', 'image urls'), MAX_GALLERY_VALUE_LENGTH),
    relations: toString(get('relations', 'relationships'), 700),
    links: toString(get('links', 'url', 'website'), 700),
    worlds: toString(get('worlds', 'world', 'setting'), 700),
    stats: toString(get('stats', 'extra stats'), 700),
  };
}

function parseImportFile(text, filename) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  const extension = filename.split('.').pop().toLowerCase();
  if (extension === 'csv' || (!['yaml', 'yml'].includes(extension) && !['{', '['].includes(cleanText[0]) && cleanText.includes(','))) {
    return parseCsv(cleanText);
  }
  if (extension === 'yaml' || extension === 'yml') {
    const parsedYaml = parseYaml(cleanText);
    if (Array.isArray(parsedYaml)) return parsedYaml;
    if (Array.isArray(parsedYaml.characters)) return parsedYaml.characters;
    if (Array.isArray(parsedYaml.data)) return parsedYaml.data;
    if (parsedYaml.character && typeof parsedYaml.character === 'object') return [parsedYaml.character];
    return [parsedYaml];
  }
  let parsed;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    throw new Error('Could not read the file. Choose a valid JSON, YAML, or CSV backup.');
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

function normalizeImportedStory(record, forceDraft = false) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const story = {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 100) : createId(),
    title: typeof record.title === 'string' ? record.title.trim().slice(0, 100) : '',
    text: typeof record.text === 'string' ? record.text.slice(0, 30000) : '',
    titleFont: STORY_FONTS[record.titleFont] ? record.titleFont : 'playfair',
    bodyFont: STORY_FONTS[record.bodyFont] ? record.bodyFont : 'dm-sans',
    backgroundColor: normalizeStoryBackground(record.backgroundColor),
    image: typeof record.image === 'string' ? record.image.slice(0, MAX_IMAGE_DATA_URL_LENGTH) : '',
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : new Date().toISOString(),
  };
  if (!story.title && !story.text.trim() && !story.image) return null;
  return { ...story, isDraft: forceDraft || record.status === 'draft' || !story.title };
}

function storyRecordsFromImport(parsed) {
  if (Array.isArray(parsed)) return parsed.map((story) => ({ story, draft: story?.status === 'draft' }));
  if (!parsed || typeof parsed !== 'object') return [];
  const records = [];
  if (Array.isArray(parsed.stories)) records.push(...parsed.stories.map((story) => ({ story, draft: false })));
  if (Array.isArray(parsed.drafts)) records.push(...parsed.drafts.map((story) => ({ story, draft: true })));
  if (!records.length && parsed.story && typeof parsed.story === 'object') records.push({ story: parsed.story, draft: false });
  if (!records.length && (typeof parsed.title === 'string' || typeof parsed.text === 'string')) {
    records.push({ story: parsed, draft: parsed.status === 'draft' });
  }
  return records;
}

async function importStories(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 15 * 1024 * 1024) throw new Error('Choose an import file smaller than 15 MB.');
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['json', 'yaml', 'yml'].includes(extension)) throw new Error('Choose a JSON or YAML story backup.');
    const contents = await file.text();
    const parsed = extension === 'yaml' || extension === 'yml'
      ? parseYaml(contents)
      : JSON.parse(contents.replace(/^\uFEFF/, ''));
    const entries = storyRecordsFromImport(parsed);
    const imported = entries.map(({ story, draft }) => normalizeImportedStory(story, draft)).filter(Boolean);
    if (!imported.length) throw new Error('No stories or unfinished drafts were found in that file.');

    const nextStories = [...savedStories];
    const nextDrafts = { ...storyDrafts };
    imported.forEach((story) => {
      if (story.isDraft) {
        const { isDraft, ...draft } = story;
        nextDrafts[draft.id] = draft;
      } else {
        const { isDraft, ...saved } = story;
        const existingIndex = nextStories.findIndex((item) => item.id === saved.id);
        if (existingIndex >= 0) nextStories[existingIndex] = saved;
        else nextStories.unshift(saved);
        delete nextDrafts[saved.id];
      }
    });

    const previousStories = localStorage.getItem(STORIES_STORAGE_KEY);
    if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) throw new Error('Could not import. Your browser storage may be full.');
    if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
      if (previousStories === null) localStorage.removeItem(STORIES_STORAGE_KEY);
      else localStorage.setItem(STORIES_STORAGE_KEY, previousStories);
      throw new Error('Could not import drafts. Your browser storage may be full.');
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    Object.keys(storyDrafts).forEach((id) => delete storyDrafts[id]);
    Object.assign(storyDrafts, nextDrafts);
    renderStories();
    const draftCount = imported.filter((story) => story.isDraft).length;
    const savedCount = imported.length - draftCount;
    showToast(`Imported ${savedCount} stor${savedCount === 1 ? 'y' : 'ies'} and ${draftCount} draft${draftCount === 1 ? '' : 's'}.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Import failed. Check that the file is valid JSON or YAML.');
  } finally {
    input.value = '';
  }
}

function exportStories() {
  const format = document.querySelector('#story-export-format').value;
  const drafts = { ...storyDrafts };
  const dialog = document.querySelector('#story-dialog');
  if (dialog.open && !document.querySelector('#story-form').classList.contains('hidden')) {
    const currentDraft = currentStoryDraft();
    if (currentDraft.title || currentDraft.text.trim() || currentDraft.image) drafts[currentDraft.id] = currentDraft;
  }
  const data = {
    format: 'fable-story-library',
    version: 1,
    stories: savedStories,
    drafts: Object.values(drafts),
  };
  if (!data.stories.length && !data.drafts.length) {
    showToast('There are no stories or drafts to export yet.');
    return;
  }
  try {
    const extension = format === 'yaml' ? 'yaml' : 'json';
    const content = format === 'yaml' ? toYaml(data) : JSON.stringify(data, null, 2);
    const mimeType = format === 'yaml' ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8';
    downloadFile(`fable-story-library.${extension}`, content, mimeType);
    showToast(`Story library and drafts exported as ${extension.toUpperCase()}.`);
  } catch {
    showToast('Story export failed. Check browser download permissions.');
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
    } else if (format === 'yaml') {
      const data = library
        ? { format: 'fable-character-library', version: 1, characters: profiles }
        : { characters: profiles };
      downloadFile(`${filename}.yaml`, toYaml(data), 'text/yaml;charset=utf-8');
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
document.querySelector('#story-export').addEventListener('click', exportStories);
document.querySelector('#story-import').addEventListener('click', () => document.querySelector('#story-import-file').click());
document.querySelector('#story-import-file').addEventListener('change', importStories);
document.querySelector('#story-print').addEventListener('click', () => window.print());
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
function requestDeleteItem(id, kind, item, returnFocus = document.activeElement) {
  pendingDeleteId = id;
  pendingDeleteKind = kind;
  pendingDeleteFocus = returnFocus;
  const isDraft = kind === 'story' && item.isDraft;
  const itemType = kind === 'character' ? 'character' : isDraft ? 'draft' : 'story';
  document.querySelector('#delete-dialog-title').textContent =
    `Delete ${itemType}?`;
  document.querySelector('#delete-dialog-message').textContent =
    isDraft && savedStories.some((story) => story.id === id)
      ? `Delete the unfinished draft of ${item.title || 'Untitled story'}? The saved story will remain.`
      : `Delete ${item.name || item.title || 'Untitled story'}? This cannot be undone.`;
  document.querySelector('#cancel-delete').textContent = 'Cancel';
  document.querySelector('#confirm-delete').textContent = `Delete ${itemType}`;
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

let pendingDeleteFocus = null;

document.querySelector('#delete-character').addEventListener('click', () => {
  const profile = characters.find((character) => character.id === activeId);
  if (!profile) return;
  requestDeleteItem(profile.id, 'character', profile, document.querySelector('#delete-character'));
});
document.querySelector('#cancel-delete').addEventListener('click', () => {
  pendingDeleteId = '';
  pendingDeleteKind = '';
  deleteDialog.close();
});
deleteDialog.addEventListener('click', (event) => {
  if (event.target === deleteDialog) {
    pendingDeleteId = '';
    pendingDeleteKind = '';
    deleteDialog.close();
  }
});
deleteDialog.addEventListener('close', () => {
  pendingDeleteId = '';
  pendingDeleteKind = '';
  if (pendingDeleteFocus instanceof HTMLElement && pendingDeleteFocus.isConnected) pendingDeleteFocus.focus();
  pendingDeleteFocus = null;
});
document.querySelector('#confirm-delete').addEventListener('click', () => {
  const characterId = pendingDeleteId;
  const kind = pendingDeleteKind;
  if (!characterId || !kind) return;
  if (kind === 'story') {
    const draft = storyDrafts[characterId];
    if (draft) {
      const nextDrafts = { ...storyDrafts };
      delete nextDrafts[characterId];
      if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
        showToast('Could not delete this draft. Your browser storage may be unavailable.');
        return;
      }
      delete storyDrafts[characterId];
      renderStories();
      deleteDialog.close();
      showToast('Story draft deleted.');
      return;
    }
    const nextStories = savedStories.filter((story) => story.id !== characterId);
    if (!writeStorage(STORIES_STORAGE_KEY, nextStories)) {
      showToast('Could not delete this story. Your browser storage may be unavailable.');
      return;
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    renderStories();
    deleteDialog.close();
    showToast('Story deleted.');
    return;
  }
  const nextCharacters = characters.filter((character) => character.id !== characterId);
  if (!writeStorage(STORAGE_KEY, nextCharacters)) {
    showToast('Could not delete. Your browser storage may be unavailable.');
    return;
  }
  characters = nextCharacters;
  persistCharacterLibrary();
  renderCharacters();
  deleteDialog.close();
  if (activeId === characterId) resetForm();
  showToast('Character removed from your cast.');
});

document.querySelector('#search-characters').addEventListener('input', renderCharacters);
['new-character', 'sidebar-new', 'empty-create'].forEach((id) => document.getElementById(id).addEventListener('click', resetForm));

document.querySelector('#new-story').addEventListener('click', (event) => openStoryEditor('', event.currentTarget));
document.querySelector('#story-empty-create').addEventListener('click', (event) => openStoryEditor('', event.currentTarget));
document.querySelector('#story-preview-open').addEventListener('click', openStoryPreview);
document.querySelector('#story-preview-edit').addEventListener('click', () => {
  const story = Object.values(storyDrafts).find((item) => item.id === activeStoryId)
    || savedStories.find((item) => item.id === activeStoryId);
  if (!story) return;
  openStoryEditor(story.id, storyReturnFocus || document.querySelector('#story-preview-open'));
});
document.querySelector('#story-back-to-draft').addEventListener('click', () => {
  const dialog = document.querySelector('#story-dialog');
  if (!dialog.open || !previewFromEditor) return;
  previewFromEditor = false;
  setStoryDialogMode('edit');
  document.querySelector('#story-text').focus();
});
document.querySelector('#story-editor-preview').addEventListener('click', openStoryPreview);
document.querySelector('#story-form').addEventListener('input', handleStoryEditorInput);
document.querySelector('#story-background-hex').addEventListener('input', (event) => {
  const color = event.currentTarget.value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) document.querySelector('#story-background').value = color;
});
document.querySelector('#story-background').addEventListener('input', (event) => {
  document.querySelector('#story-background-hex').value = event.currentTarget.value;
});
document.querySelector('#story-image-upload-button').addEventListener('click', () => document.querySelector('#story-image-file').click());
document.querySelector('#story-image-file').addEventListener('change', handleStoryImageUpload);
document.querySelector('#story-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveCurrentStory();
});
document.querySelector('#story-close').addEventListener('click', () => document.querySelector('#story-dialog').close());
document.querySelector('#story-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector('#story-dialog').addEventListener('close', () => {
  renderStories();
  updateBackToTopVisibility();
  if (storyReturnFocus instanceof HTMLElement && storyReturnFocus.isConnected) storyReturnFocus.focus();
});

const navLinks = [...document.querySelectorAll('.nav-link')];
const navSections = ['studio', 'cast', 'lore'].map((id) => document.getElementById(id));
let scrollSpyFrame = 0;

function setActiveNavigation(sectionId) {
  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${sectionId}`;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function syncNavigationToScroll() {
  scrollSpyFrame = 0;
  const header = document.querySelector('.sidebar');
  const sectionThreshold = Math.max(
    (header?.getBoundingClientRect().bottom || 0) + Math.min(120, window.innerHeight * 0.2),
    window.innerHeight * 0.55,
  );
  const activeSection = navSections.filter((section) => section.getBoundingClientRect().top <= sectionThreshold).at(-1);
  setActiveNavigation(activeSection?.id || 'studio');
}

function scheduleNavigationSync() {
  if (scrollSpyFrame) return;
  scrollSpyFrame = window.requestAnimationFrame(syncNavigationToScroll);
}

navLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  setActiveNavigation(target.id);
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
window.addEventListener('scroll', scheduleNavigationSync, { passive: true });
window.addEventListener('resize', scheduleNavigationSync);
syncNavigationToScroll();

const savedDraft = readStorage(DRAFT_KEY, null);
if (savedDraft) {
  characterFormHasChanges = true;
  Object.entries({
    name: savedDraft.name, role: savedDraft.role, pronouns: savedDraft.pronouns, age: savedDraft.age,
    species: savedDraft.species, description: savedDraft.description, traits: traitsValue(savedDraft.traits),
    avatar: savedDraft.avatar, cover: savedDraft.cover, accent: savedDraft.accent, story: savedDraft.story,
    gallery: savedDraft.gallery, relations: savedDraft.relations, links: savedDraft.links,
    worlds: savedDraft.worlds, stats: savedDraft.stats,
  }).forEach(([id, value]) => { document.getElementById(id).value = value || ''; });
  imageCropState = {
    avatar: normalizeImageCrop(savedDraft.avatarCrop),
    cover: normalizeImageCrop(savedDraft.coverCrop),
  };
  document.querySelector('#accent-hex').value = document.querySelector('#accent').value;
  document.querySelector('#autosave-status').textContent = 'Draft restored';
  if (savedDraft.id && characters.some((character) => character.id === savedDraft.id)) {
    activeId = savedDraft.id;
    document.querySelector('#character-id').value = savedDraft.id;
    document.querySelector('#save-label').textContent = 'Update character';
    document.querySelector('#delete-character').classList.remove('hidden');
  }
}
rememberImageSources();
renderCharacters();
renderStories();
updatePreview();
initializeDataFolder();
