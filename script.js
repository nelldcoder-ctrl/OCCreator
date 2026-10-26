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
const changelogDialog = document.querySelector('#changelog-dialog');
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
let changelogCloseTimer = null;
let changelogReturnFocus = null;

// Add new releases at the top, using the same fields: version, date, notes.
const CHANGELOG = [
  {
    version: '0.2.5',
    date: '2026/10/26',
    notes: [
      'Lore & Story: link stories to your characters, and see every story a character appears in on their profile.',
      'Lore & Story: added type, progress, a one-line summary, setting and tags to each story, plus a live word count and reading time.',
      'Lore & Story: split long stories into chapters with a chapters panel (jump and reorder), and format text with bold, italic, quotes and scene breaks. The reader shows it all, with a contents list.',
      'Lore & Story: added version history, undo and redo, Discard changes, Save & close, and starter prompts for scenes, world notes and plot outlines.',
      'Lore & Story: search, filter and sort your story library, export stories as Markdown or plain text, and cover images are now resized on upload to save browser storage.',
      'Characters: link characters to each other with Connections, shown on both profiles.',
      'Characters: added a Go deeper section (goal, fear, secret, flaw, voice, appearance) and a life timeline.',
      'Characters: added groups or factions with cast filtering and sorting, a Duplicate button, a profile completeness bar, and “Need a nudge?” writing prompts.',
      'Characters: added version history with Restore, and raised the backstory limit to 4,000 characters with a counter.',
      'Characters: starting a new character now asks before discarding unsaved changes.',
      'Images: uploaded profile pictures, covers, story covers and extra images now show as thumbnails with a Remove button, instead of a block of raw text. Extra images can also be added by link.',
      'Fixed: deleting a story now removes it completely in one step, instead of leaving a leftover card.',
      'Fixed: editing a character with a portrait but no cover no longer copies the portrait into the cover.',
      'About the Website: rewrote the guide in simpler words, removed the side menu, and restyled it to match the rest of the site.',
      'Added this changelog.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-25',
    notes: [
      'Added Lore&Story (Simple Story writing)',
      'Create a story with customized and personalized draft craft. NOTE! The style is limited.',
      'Changed functionality of some features',
      'Changed UI layout of Character Creation',
      'Changed how Profile colors functioned',
      'Fixed some details that were difficult to read and redefined them.',
      'Other new features to be added in future updates.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-24',
    notes: [
      'Redesigned the whole page into simplicity',
      'Added Landing page - divided into Character Studio and Character Cards',
      'Changed the UI of “Created Characters”',
    ],
  },
];
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
const STORY_KINDS = { story: 'Story', scene: 'Scene', world: 'World note', lore: 'Lore entry' };
const STORY_PROGRESS = { idea: 'Idea', drafting: 'Drafting', finished: 'Finished' };
const STORY_STARTERS = {
  scene: 'Where are we?\n\nWho is here, and what do they want right now?\n\nWhat goes wrong, or changes?\n\n',
  world: 'What is this place, power, or custom called?\n\nWhat makes it different from the ordinary world?\n\nWho benefits from it, and who pays for it?\n\nHow does it show up in everyday life?\n\n',
  outline: 'Opening — how does the story begin?\n\nThe spark — what disturbs the status quo?\n\nRising trouble — what gets harder?\n\nTurning point — what changes everything?\n\nAftermath — how do things end up?\n\n',
};

function parseStoryList(value, max, itemMax) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list.map((item) => String(item).trim().slice(0, itemMax)).filter(Boolean))].slice(0, max);
}

function normalizeStoryMeta(record = {}) {
  return {
    kind: STORY_KINDS[record.kind] ? record.kind : 'story',
    progress: STORY_PROGRESS[record.progress] ? record.progress : 'drafting',
    summary: typeof record.summary === 'string' ? record.summary.trim().slice(0, 240) : '',
    setting: typeof record.setting === 'string' ? record.setting.trim().slice(0, 160) : '',
    tags: parseStoryList(record.tags, 12, 24),
    characterIds: parseStoryList(record.characterIds, 40, 100),
  };
}

function storyMetaEqual(a, b) {
  const sorted = (list) => JSON.stringify([...(list || [])].sort());
  return a.kind === b.kind && a.progress === b.progress && a.summary === b.summary
    && a.setting === b.setting && sorted(a.tags) === sorted(b.tags)
    && sorted(a.characterIds) === sorted(b.characterIds);
}

function storyCharacterNames(story) {
  return (story?.characterIds || [])
    .map((id) => characters.find((character) => character.id === id)?.name)
    .filter(Boolean);
}

const STORY_VERSIONS_KEY = 'fable.story-versions.v1';
const MAX_STORY_VERSIONS = 10;
const CHAPTER_PATTERN = /^#{1,2}[ \t]+\S/;

function normalizeStoryVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([id, list]) => {
    if (!id || !Array.isArray(list)) return;
    const versions = list
      .filter((item) => item && typeof item === 'object' && typeof item.text === 'string')
      .map((item) => ({
        at: typeof item.at === 'string' ? item.at : '',
        title: typeof item.title === 'string' ? item.title.slice(0, 100) : '',
        text: item.text.slice(0, 30000),
        label: typeof item.label === 'string' ? item.label.slice(0, 40) : '',
      }))
      .slice(0, MAX_STORY_VERSIONS);
    if (versions.length) result[id] = versions;
  });
  return result;
}

function countWords(text) {
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function parseStoryChapters(text) {
  const chapters = [];
  let offset = 0;
  text.split('\n').forEach((line) => {
    if (CHAPTER_PATTERN.test(line)) {
      chapters.push({ title: line.replace(/^#{1,2}[ \t]+/, '').trim(), start: offset, headingLength: line.length });
    }
    offset += line.length + 1;
  });
  chapters.forEach((chapter, index) => {
    chapter.end = index + 1 < chapters.length ? chapters[index + 1].start : text.length;
    chapter.words = countWords(text.slice(chapter.start + chapter.headingLength, chapter.end));
  });
  return chapters;
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const token = match[0];
    const element = document.createElement(token.startsWith('**') ? 'strong' : 'em');
    element.textContent = token.replace(/^\*+|\*+$/g, '');
    parent.append(element);
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function renderStoryMarkdown(container, rawText) {
  container.replaceChildren();
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const chapterHeadings = [];
  let paragraph = [];
  let quote = [];
  let list = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const element = document.createElement('p');
    paragraph.forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      appendInlineMarkdown(element, line);
    });
    container.append(element);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const element = document.createElement('blockquote');
    quote.forEach((line, index) => {
      if (index) element.append(document.createElement('br'));
      appendInlineMarkdown(element, line);
    });
    container.append(element);
    quote = [];
  };
  const flushList = () => { list = null; };
  const flushAll = () => { flushParagraph(); flushQuote(); flushList(); };
  lines.forEach((line) => {
    const heading = line.match(/^(#{1,3})[ \t]+(\S.*)$/);
    if (!line.trim()) { flushAll(); return; }
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const element = document.createElement(level === 3 ? 'h3' : 'h2');
      appendInlineMarkdown(element, heading[2].trim());
      container.append(element);
      if (level < 3) chapterHeadings.push({ title: heading[2].trim(), element });
      return;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      flushAll();
      const rule = document.createElement('hr');
      rule.className = 'story-scene-break';
      container.append(rule);
      return;
    }
    const quoted = line.match(/^>[ \t]?(.*)$/);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); return; }
    const bullet = line.match(/^[-*][ \t]+(\S.*)$/);
    if (bullet) {
      flushParagraph(); flushQuote();
      if (!list) { list = document.createElement('ul'); container.append(list); }
      const item = document.createElement('li');
      appendInlineMarkdown(item, bullet[1]);
      list.append(item);
      return;
    }
    flushQuote(); flushList();
    paragraph.push(line);
  });
  flushAll();
  if (chapterHeadings.length >= 2) {
    const nav = document.createElement('nav');
    nav.className = 'story-toc';
    nav.setAttribute('aria-label', 'Chapters');
    const heading = document.createElement('p');
    heading.className = 'story-toc-title';
    heading.textContent = 'Chapters';
    const ol = document.createElement('ol');
    chapterHeadings.forEach(({ title, element }) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.addEventListener('click', () => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      });
      li.append(button);
      ol.append(li);
    });
    nav.append(heading, ol);
    container.prepend(nav);
  }
}

const storedStories = readStorage(STORIES_STORAGE_KEY, null);
let savedStories = normalizeStories(storedStories);
const storyDrafts = normalizeStoryDrafts(readStorage(STORY_DRAFTS_KEY, {}));
const storyVersions = normalizeStoryVersions(readStorage(STORY_VERSIONS_KEY, {}));

const CHARACTER_VERSIONS_KEY = 'fable.character-versions.v1';
const CHARACTER_SNAPSHOT_FIELDS = [
  'name', 'role', 'pronouns', 'age', 'species', 'description', 'traits', 'story', 'relations', 'links',
  'worlds', 'stats', 'groups', 'goal', 'fear', 'secret', 'flaw', 'voice', 'appearance', 'bonds', 'timeline',
];
const CHARACTER_PROMPTS = {
  goal: ['What does {name} want more than anything, and what would they give up to get it?', 'What is {name} working toward that nobody else knows about?', 'If {name} could change one thing about their life tomorrow, what would it be?'],
  fear: ['What is {name} most afraid of, and when did that fear begin?', 'What situation makes {name} go quiet or run?', 'What would {name} never admit scares them?'],
  secret: ['What is {name} hiding, and who would be hurt if it came out?', 'What did {name} do once that they have never told anyone?', 'Who does {name} pretend not to know?'],
  flaw: ['What habit keeps getting {name} into trouble?', 'Where does {name}’s greatest strength turn into a weakness?', 'What does {name} refuse to learn, no matter how many times life teaches it?'],
  story: ['Describe the moment that made {name} who they are today.', 'Where did {name} grow up, and what did they leave behind?', 'Who raised {name}, and what did that person get wrong?'],
  voice: ['What is something {name} says all the time, without noticing?', 'How does {name} sound when they are lying?', 'What would {name} say to a stranger in the first ten seconds?'],
  appearance: ['What is the first thing people notice about {name}, and what do they miss?', 'What does {name} always wear or carry, and why?', 'What scar, mark, or habit hints at {name}’s past?'],
  description: ['How would {name}’s best friend describe them in one sentence?', 'What impression does {name} give on first meeting, and how is it wrong?'],
};

function normalizeCharacterVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([id, list]) => {
    if (!id || !Array.isArray(list)) return;
    const versions = list.filter((item) => item && typeof item === 'object' && item.data && typeof item.data === 'object')
      .map((item) => {
        const data = {};
        CHARACTER_SNAPSHOT_FIELDS.forEach((key) => {
          const raw = item.data[key];
          data[key] = Array.isArray(raw)
            ? raw.map((entry) => String(entry).slice(0, 60)).slice(0, 30)
            : String(raw ?? '').slice(0, 6000);
        });
        return {
          at: typeof item.at === 'string' ? item.at : '',
          label: typeof item.label === 'string' ? item.label.slice(0, 40) : '',
          data,
        };
      }).slice(0, 10);
    if (versions.length) result[id] = versions;
  });
  return result;
}

const characterVersions = normalizeCharacterVersions(readStorage(CHARACTER_VERSIONS_KEY, {}));
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
  changelogDialog,
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

function parseTimeline(value) {
  return String(value || '').split(/\r?\n/).map((line) => {
    const index = line.indexOf('|');
    return {
      when: (index < 0 ? '' : line.slice(0, index)).trim().slice(0, 24),
      text: (index < 0 ? line : line.slice(index + 1)).trim().slice(0, 200),
    };
  }).filter((event) => event.text).slice(0, 40);
}

function serializeTimeline(list) {
  return list.map((event) => `${(event.when || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 24)}|${(event.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)}`).join('\n');
}

function setTimeline(list) {
  document.querySelector('#timeline').value = serializeTimeline(list);
  characterFormHasChanges = true;
  renderTimelineEditor();
  updatePreview();
  saveDraft();
}

function renderTimelineEditor() {
  const events = parseTimeline(document.querySelector('#timeline').value);
  const list = document.querySelector('#timeline-list');
  list.replaceChildren();
  events.forEach((event, index) => {
    const row = document.createElement('li');
    const when = document.createElement('strong');
    when.textContent = event.when || '—';
    const text = document.createElement('span');
    text.textContent = event.text;
    text.title = event.text;
    const makeButton = (label, aria, handler, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-label', aria);
      button.addEventListener('click', handler);
      return button;
    };
    const move = (direction) => {
      const next = [...events];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      setTimeline(next);
    };
    row.append(
      when, text,
      makeButton('↑', `Move “${event.text}” earlier`, () => move(-1), index === 0),
      makeButton('↓', `Move “${event.text}” later`, () => move(1), index === events.length - 1),
      makeButton('×', `Remove “${event.text}”`, () => setTimeline(events.filter((_, position) => position !== index))),
    );
    list.append(row);
  });
}

function addTimelineEvent() {
  const whenInput = document.querySelector('#timeline-when');
  const textInput = document.querySelector('#timeline-text');
  if (!textInput.value.trim()) {
    showToast('Describe what happened first.');
    textInput.focus();
    return;
  }
  const events = parseTimeline(document.querySelector('#timeline').value);
  if (events.length >= 40) {
    showToast('A timeline can hold up to 40 moments.');
    return;
  }
  events.push({ when: whenInput.value.trim(), text: textInput.value.trim() });
  whenInput.value = '';
  textInput.value = '';
  setTimeline(events);
  whenInput.focus();
}

function renderProfileTimeline(profile) {
  const list = document.querySelector('#profile-timeline');
  list.replaceChildren();
  const events = parseTimeline(profile.timeline);
  if (!events.length) {
    const hint = document.createElement('li');
    hint.className = 'profile-empty';
    hint.textContent = 'No timeline yet. Add key moments under “More profile sections” in the editor.';
    list.append(hint);
    return;
  }
  events.forEach((event) => {
    const item = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'profile-timeline-when';
    when.textContent = event.when || '·';
    const text = document.createElement('p');
    text.textContent = event.text;
    item.append(when, text);
    list.append(item);
  });
}

function characterSnapshot(profile) {
  const snapshot = {};
  CHARACTER_SNAPSHOT_FIELDS.forEach((key) => {
    const value = profile[key];
    snapshot[key] = Array.isArray(value) ? [...value] : (value ?? '');
  });
  return snapshot;
}

function recordCharacterVersion(profile, label = '') {
  if (!profile?.id) return;
  const snapshot = characterSnapshot(profile);
  const list = characterVersions[profile.id] || [];
  if (list[0] && JSON.stringify(list[0].data) === JSON.stringify(snapshot)) return;
  const entry = { at: profile.updatedAt || new Date().toISOString(), label, data: snapshot };
  characterVersions[profile.id] = [entry, ...list].slice(0, 10);
  if (!writeStorage(CHARACTER_VERSIONS_KEY, characterVersions)) {
    characterVersions[profile.id] = characterVersions[profile.id].slice(0, 3);
    if (!writeStorage(CHARACTER_VERSIONS_KEY, characterVersions)) {
      characterVersions[profile.id] = list;
      showToast('Saved, but version history is full. Older snapshots were kept as they were.');
    }
  }
}

function renderCharacterHistory() {
  const versions = (activeId && characterVersions[activeId]) || [];
  const list = document.querySelector('#character-history-list');
  list.replaceChildren();
  document.querySelector('#character-history-count').textContent = versions.length ? `${versions.length} saved` : 'None yet';
  versions.forEach((version, index) => {
    const row = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'story-history-info';
    const when = document.createElement('strong');
    when.textContent = version.at
      ? new Date(version.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Earlier version';
    const detail = document.createElement('span');
    detail.textContent = [version.data.name, version.label || (index === 0 ? 'Latest save' : '')].filter(Boolean).join(' · ');
    info.append(when, detail);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet story-history-restore';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreCharacterVersion(index));
    row.append(info, restore);
    list.append(row);
  });
}

function restoreCharacterVersion(index) {
  const version = ((activeId && characterVersions[activeId]) || [])[index];
  if (!version) return;
  const current = currentProfile();
  if (JSON.stringify(characterSnapshot(current)) === JSON.stringify(version.data)) {
    showToast('The form already has that version.');
    return;
  }
  recordCharacterVersion({ ...current, id: activeId }, 'Before restore');
  Object.entries(version.data).forEach(([key, value]) => {
    const field = document.getElementById(key);
    if (field) field.value = Array.isArray(value) ? traitsValue(value) : value;
  });
  document.querySelector('#depth-details').open = Boolean(version.data.goal || version.data.fear || version.data.secret
    || version.data.flaw || version.data.voice || version.data.appearance);
  characterFormHasChanges = true;
  renderRelationEditors();
  updatePreview();
  saveDraft();
  showToast('Version restored in the form. Save to keep it. Portraits and images were not changed.');
}

let currentCharacterPrompt = null;
function nextCharacterPrompt() {
  const profile = currentProfile();
  const fields = Object.keys(CHARACTER_PROMPTS);
  const empty = fields.filter((key) => !profile[key]);
  const pool = empty.length ? empty : fields;
  const field = pool[Math.floor(Math.random() * pool.length)];
  const questions = CHARACTER_PROMPTS[field].filter((question) => question !== currentCharacterPrompt?.template);
  const template = questions[Math.floor(Math.random() * questions.length)] || CHARACTER_PROMPTS[field][0];
  currentCharacterPrompt = { field, template, text: template.replaceAll('{name}', profile.name || 'your character') };
  document.querySelector('#prompt-text').textContent = currentCharacterPrompt.text;
  document.querySelector('#prompt-card').classList.remove('hidden');
  document.querySelector('#prompt-spark').textContent = '✦ Another nudge';
}

function useCharacterPrompt() {
  if (!currentCharacterPrompt) return;
  const field = document.getElementById(currentCharacterPrompt.field);
  const section = field.closest('details');
  if (section) section.open = true;
  field.placeholder = currentCharacterPrompt.text;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field.focus({ preventScroll: true });
}

function renderRelationEditors() {
  renderBondsEditor();
  renderTimelineEditor();
  renderCharacterHistory();
}

function parseBonds(value) {
  return String(value || '').split(/\r?\n/).map((line) => {
    const index = line.indexOf('|');
    return {
      id: (index < 0 ? line : line.slice(0, index)).trim().slice(0, 100),
      label: (index < 0 ? '' : line.slice(index + 1)).trim().slice(0, 40),
    };
  }).filter((bond, position, list) => bond.id && list.findIndex((item) => item.id === bond.id) === position).slice(0, 30);
}

function serializeBonds(list) {
  return list.map((bond) => `${bond.id}|${(bond.label || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 40)}`).join('\n');
}

function characterBonds(character) {
  return parseBonds(character?.bonds).filter((bond) => bond.id !== character.id && characters.some((item) => item.id === bond.id));
}

function setBonds(list) {
  document.querySelector('#bonds').value = serializeBonds(list);
  characterFormHasChanges = true;
  renderRelationEditors();
  updatePreview();
  saveDraft();
}

function renderBondsEditor() {
  const select = document.querySelector('#bond-character');
  const addButton = document.querySelector('#bond-add');
  const list = document.querySelector('#bond-list');
  const bonds = parseBonds(document.querySelector('#bonds').value).filter((bond) => characters.some((item) => item.id === bond.id));
  const others = characters.filter((item) => item.id !== activeId);
  const available = others.filter((item) => !bonds.some((bond) => bond.id === item.id));
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = available.length ? 'Choose a character…'
    : others.length ? 'Everyone is already connected' : 'Save another character to connect them';
  select.append(placeholder);
  available.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.append(option);
  });
  select.disabled = !available.length;
  addButton.disabled = !available.length;
  list.replaceChildren();
  bonds.forEach((bond) => {
    const target = characters.find((item) => item.id === bond.id);
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = target.name;
    const label = document.createElement('span');
    label.textContent = bond.label || 'Connected';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove connection to ${target.name}`);
    remove.addEventListener('click', () => setBonds(bonds.filter((item) => item.id !== bond.id)));
    row.append(name, label, remove);
    list.append(row);
  });
}

function addBondFromEditor() {
  const select = document.querySelector('#bond-character');
  const labelInput = document.querySelector('#bond-label');
  if (!select.value) {
    showToast('Choose a character to connect first.');
    select.focus();
    return;
  }
  const bonds = parseBonds(document.querySelector('#bonds').value);
  bonds.push({ id: select.value, label: labelInput.value.trim() });
  labelInput.value = '';
  setBonds(bonds);
}

function renderProfileDepth(profile) {
  const box = document.querySelector('#profile-depth');
  box.replaceChildren();
  [['Goal', profile.goal], ['Fear', profile.fear], ['Secret', profile.secret], ['Flaw', profile.flaw],
    ['Voice', profile.voice], ['Appearance', profile.appearance]].filter(([, value]) => value).forEach(([label, value]) => {
    const wrap = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    wrap.append(term, detail);
    box.append(wrap);
  });
  if (!box.childElementCount) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'No goals, fears, or secrets yet. Add them under “Go deeper” in the editor.';
    box.append(hint);
  }
}

function renderProfileConnections(profile) {
  const box = document.querySelector('#profile-connections');
  box.replaceChildren();
  const rows = characterBonds(profile).map((bond) => ({
    other: characters.find((item) => item.id === bond.id), detail: bond.label || 'Connected',
  }));
  characters.forEach((other) => {
    if (other.id === profile.id || rows.some((row) => row.other.id === other.id)) return;
    const back = characterBonds(other).find((bond) => bond.id === profile.id);
    if (back) rows.push({ other, detail: `${back.label || 'Connected'} · added on ${other.name}’s profile` });
  });
  if (!rows.length) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'No connections yet. Link characters under “More profile sections” in the editor.';
    box.append(hint);
    return;
  }
  rows.forEach(({ other, detail }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-story-link';
    const name = document.createElement('strong');
    name.textContent = other.name;
    const label = document.createElement('span');
    label.textContent = detail;
    button.append(name, label);
    button.addEventListener('click', () => {
      requestProfileClose(() => openCharacterProfile(other, document.querySelector('#character-grid')));
    });
    box.append(button);
  });
}

function syncCharacterActions(editing) {
  document.querySelector('#delete-character').classList.toggle('hidden', !editing);
  document.querySelector('#duplicate-character').classList.toggle('hidden', !editing);
}

function duplicateCharacter() {
  const profile = currentProfile();
  if (!profile.name) return;
  activeId = '';
  document.querySelector('#character-id').value = '';
  document.querySelector('#name').value = `${profile.name} (copy)`.slice(0, 48);
  document.querySelector('#save-label').textContent = 'Save character';
  syncCharacterActions(false);
  characterFormHasChanges = true;
  document.querySelector('#autosave-status').textContent = 'Copy ready — save to add it';
  renderRelationEditors();
  updatePreview();
  saveDraft();
  showToast('Copy ready. Rename it and save to add it to your cast.');
  document.querySelector('#name').focus();
  document.querySelector('#name').select();
}

function requestNewCharacter(returnFocus = document.activeElement) {
  if (!characterFormHasChanges) {
    resetForm();
    return;
  }
  pendingDeleteId = 'new-character';
  pendingDeleteKind = 'discard-character';
  pendingDeleteFocus = returnFocus;
  document.querySelector('#delete-dialog-title').textContent = 'Start a new character?';
  document.querySelector('#delete-dialog-message').textContent = 'You have unsaved changes. Starting a new character will discard them.';
  document.querySelector('#cancel-delete').textContent = 'Keep editing';
  document.querySelector('#confirm-delete').textContent = 'Discard & start new';
  deleteDialog.showModal();
  syncModalScrollLock();
  document.querySelector('#cancel-delete').focus();
}

function updateProfileMeter(profile) {
  const checks = [
    ['a role', profile.role], ['a quick description', profile.description], ['a few traits', profile.traits.length],
    ['a backstory', profile.story], ['a portrait', profile.avatar],
    ['a goal, fear, or secret', profile.goal || profile.fear || profile.secret],
    ['a connection to another character', parseBonds(profile.bonds).length],
  ];
  const done = checks.filter(([, value]) => value).length + (profile.name ? 1 : 0);
  const total = checks.length + 1;
  const percent = Math.round((done / total) * 100);
  const next = checks.find(([, value]) => !value);
  document.querySelector('#profile-meter-fill').style.width = `${percent}%`;
  document.querySelector('#profile-meter-text').textContent = !profile.name
    ? 'Start with a name'
    : `Profile ${percent}% complete${next ? ` · next, add ${next[0]}` : ' · fully fleshed out ✦'}`;
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
    groups: document.querySelector('#groups').value.split(',').map((group) => group.trim()).filter(Boolean).slice(0, 10),
    goal: document.querySelector('#goal').value.trim(),
    fear: document.querySelector('#fear').value.trim(),
    secret: document.querySelector('#secret').value.trim(),
    flaw: document.querySelector('#flaw').value.trim(),
    voice: document.querySelector('#voice').value.trim(),
    appearance: document.querySelector('#appearance').value.trim(),
    bonds: document.querySelector('#bonds').value.trim(),
    timeline: document.querySelector('#timeline').value.trim(),
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
      ...normalizeStoryMeta(story),
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
      ...normalizeStoryMeta(story),
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
    ...normalizeStoryMeta({}),
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
    ...normalizeStoryMeta({
      kind: document.querySelector('#story-kind').value,
      progress: document.querySelector('#story-progress').value,
      summary: document.querySelector('#story-summary').value,
      setting: document.querySelector('#story-setting').value,
      tags: document.querySelector('#story-tags').value,
      characterIds: [...document.querySelectorAll('#story-characters input:checked')].map((input) => input.value),
    }),
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
  renderStoryMarkdown(readingText, story?.text || '');
  const readingSummary = document.querySelector('#story-reading-summary');
  const readingMeta = document.querySelector('#story-reading-meta');
  const castNames = storyCharacterNames(story);
  const metaParts = story ? [
    STORY_KINDS[story.kind], STORY_PROGRESS[story.progress],
    story.setting && `Set in ${story.setting}`,
    castNames.length && `Featuring ${castNames.join(', ')}`,
    story.tags?.length && story.tags.map((tag) => `#${tag}`).join(' '),
  ].filter(Boolean) : [];
  readingSummary.textContent = story?.summary || '';
  readingSummary.classList.toggle('hidden', !story?.summary);
  readingMeta.textContent = metaParts.join('  ·  ');
  readingMeta.classList.toggle('hidden', !metaParts.length);
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

function replaceStoryTextRange(start, end, replacement, selectFrom = null, selectTo = null) {
  const textarea = document.querySelector('#story-text');
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let done = false;
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, replacement)
      && textarea.value.slice(start, start + replacement.length) === replacement;
  } catch { done = false; }
  if (!done) {
    textarea.setRangeText(replacement, start, end, 'end');
    handleStoryEditorInput();
  }
  const from = selectFrom ?? start + replacement.length;
  textarea.setSelectionRange(from, selectTo ?? from);
}

function applyStoryFormat(kind) {
  const textarea = document.querySelector('#story-text');
  if (kind === 'undo' || kind === 'redo') {
    textarea.focus();
    try { document.execCommand(kind); } catch { /* browser without execCommand */ }
    handleStoryEditorInput();
    return;
  }
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const selected = value.slice(start, end);
  if (kind === 'bold' || kind === 'italic') {
    const mark = kind === 'bold' ? '**' : '*';
    const inner = selected || (kind === 'bold' ? 'bold text' : 'italic text');
    replaceStoryTextRange(start, end, `${mark}${inner}${mark}`, start + mark.length, start + mark.length + inner.length);
  } else if (kind === 'quote') {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end) || 'A line worth remembering';
    replaceStoryTextRange(lineStart, end, block.split('\n').map((line) => (line.startsWith('> ') ? line : `> ${line}`)).join('\n'));
  } else if (kind === 'break') {
    const before = start === 0 ? '' : value.slice(0, start).endsWith('\n\n') ? '' : value.slice(0, start).endsWith('\n') ? '\n' : '\n\n';
    replaceStoryTextRange(start, end, `${before}---\n\n`);
  } else if (kind === 'chapter') {
    const number = parseStoryChapters(value).length + 1;
    const title = `Chapter ${number}`;
    const before = start === 0 ? '' : value.slice(0, start).endsWith('\n\n') ? '' : value.slice(0, start).endsWith('\n') ? '\n' : '\n\n';
    const heading = `${before}## ${title}\n\n`;
    const titleStart = start + before.length + 3;
    replaceStoryTextRange(start, end, heading, titleStart, titleStart + title.length);
  }
  handleStoryEditorInput();
}

function jumpToStoryPosition(position, length) {
  const textarea = document.querySelector('#story-text');
  const total = Math.max(1, textarea.value.length);
  textarea.scrollTop = Math.max(0, (position / total) * (textarea.scrollHeight - textarea.clientHeight) - 24);
  textarea.focus();
  textarea.setSelectionRange(position, position + length);
}

function moveStoryChapter(index, direction) {
  const textarea = document.querySelector('#story-text');
  const text = textarea.value;
  const chapters = parseStoryChapters(text);
  const target = index + direction;
  if (!chapters[index] || !chapters[target]) return;
  const preamble = text.slice(0, chapters[0].start).trim();
  const segments = chapters.map((chapter) => text.slice(chapter.start, chapter.end).trim());
  [segments[index], segments[target]] = [segments[target], segments[index]];
  const next = `${[preamble, ...segments].filter(Boolean).join('\n\n')}\n`;
  textarea.focus();
  textarea.setSelectionRange(0, text.length);
  let done = false;
  try { done = document.execCommand('insertText', false, next) && textarea.value === next; } catch { done = false; }
  if (!done) { textarea.value = next; }
  handleStoryEditorInput();
  const moved = parseStoryChapters(textarea.value)[target];
  if (moved) jumpToStoryPosition(moved.start, moved.headingLength);
}

function renderStoryChapters() {
  const text = document.querySelector('#story-text').value;
  const chapters = parseStoryChapters(text);
  const list = document.querySelector('#story-chapter-list');
  list.replaceChildren();
  document.querySelector('#story-chapter-count').textContent = chapters.length
    ? `${chapters.length} chapter${chapters.length === 1 ? '' : 's'}` : 'None yet';
  document.querySelector('#story-chapter-hint').classList.toggle('hidden', chapters.length > 0);
  chapters.forEach((chapter, index) => {
    const row = document.createElement('li');
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'story-chapter-jump';
    const name = document.createElement('strong');
    name.textContent = chapter.title;
    const meta = document.createElement('span');
    meta.textContent = `${chapter.words.toLocaleString()} word${chapter.words === 1 ? '' : 's'}`;
    jump.append(name, meta);
    jump.addEventListener('click', () => jumpToStoryPosition(chapter.start, chapter.headingLength));
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'story-chapter-move';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.setAttribute('aria-label', `Move ${chapter.title} up`);
    up.addEventListener('click', () => moveStoryChapter(index, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'story-chapter-move';
    down.textContent = '↓';
    down.disabled = index === chapters.length - 1;
    down.setAttribute('aria-label', `Move ${chapter.title} down`);
    down.addEventListener('click', () => moveStoryChapter(index, 1));
    row.append(jump, up, down);
    list.append(row);
  });
  if (chapters.length) document.querySelector('#story-chapters-panel').open = true;
}

function recordStoryVersion(story, label = '') {
  const list = storyVersions[story.id] || [];
  const latest = list[0];
  if (latest && latest.title === story.title && latest.text === story.text) return;
  const entry = { at: story.updatedAt || new Date().toISOString(), title: story.title, text: story.text, label };
  storyVersions[story.id] = [entry, ...list].slice(0, MAX_STORY_VERSIONS);
  if (!writeStorage(STORY_VERSIONS_KEY, storyVersions)) {
    storyVersions[story.id] = storyVersions[story.id].slice(0, 3);
    if (!writeStorage(STORY_VERSIONS_KEY, storyVersions)) {
      storyVersions[story.id] = list;
      showToast('Saved, but version history is full. Older snapshots were kept as they were.');
    }
  }
}

function renderStoryHistory() {
  const versions = storyVersions[activeStoryId] || [];
  const list = document.querySelector('#story-history-list');
  list.replaceChildren();
  document.querySelector('#story-history-count').textContent = versions.length
    ? `${versions.length} saved` : 'None yet';
  versions.forEach((version, index) => {
    const row = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'story-history-info';
    const when = document.createElement('strong');
    when.textContent = version.at
      ? new Date(version.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Earlier version';
    const detail = document.createElement('span');
    detail.textContent = [
      `${countWords(version.text).toLocaleString()} words`,
      version.label || (index === 0 ? 'Latest save' : ''),
    ].filter(Boolean).join(' · ');
    info.append(when, detail);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'button button-quiet story-history-restore';
    restore.textContent = 'Restore';
    restore.addEventListener('click', () => restoreStoryVersion(index));
    row.append(info, restore);
    list.append(row);
  });
}

function restoreStoryVersion(index) {
  const version = (storyVersions[activeStoryId] || [])[index];
  if (!version) return;
  const current = currentStoryDraft();
  if (current.title === version.title && current.text === version.text) {
    showToast('The editor already has that version.');
    return;
  }
  if (savedStories.some((story) => story.id === activeStoryId) && (current.text.trim() || current.title)) {
    recordStoryVersion(current, 'Before restore');
  }
  document.querySelector('#story-title').value = version.title;
  document.querySelector('#story-text').value = version.text;
  handleStoryEditorInput();
  renderStoryHistory();
  showToast('Version restored in the editor. Save to keep it, or Discard changes to go back.');
}

function updateStoryCounter(text = '') {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const minutes = words ? Math.max(1, Math.round(words / 220)) : 0;
  const counter = document.querySelector('#story-word-count');
  counter.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${minutes ? `${minutes} min read` : 'no reading time yet'} · ${text.length.toLocaleString()} / 30,000 characters`;
  counter.classList.toggle('is-near-limit', text.length >= 27000);
  document.querySelector('#story-starters').classList.toggle('hidden', Boolean(text.trim()));
}

function renderStoryCharacterPicker(selectedIds = []) {
  const picker = document.querySelector('#story-characters');
  picker.replaceChildren();
  if (!characters.length) {
    const hint = document.createElement('p');
    hint.className = 'story-picker-empty';
    hint.textContent = 'No characters yet. Create one in the Character Studio and they will appear here.';
    picker.append(hint);
    return;
  }
  characters.forEach((character) => {
    const chip = document.createElement('label');
    chip.className = 'story-character-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = character.id;
    input.checked = selectedIds.includes(character.id);
    const name = document.createElement('span');
    name.textContent = character.name;
    chip.append(input, name);
    picker.append(chip);
  });
}

function insertStoryStarter(key) {
  const textarea = document.querySelector('#story-text');
  if (!STORY_STARTERS[key] || textarea.value.trim()) return;
  textarea.value = STORY_STARTERS[key];
  handleStoryEditorInput();
  textarea.focus();
  textarea.setSelectionRange(0, 0);
}

let discardArmTimer = 0;
function disarmStoryDiscard() {
  window.clearTimeout(discardArmTimer);
  const button = document.querySelector('#story-discard');
  button.classList.remove('is-armed');
  const saved = savedStories.some((story) => story.id === activeStoryId);
  button.textContent = saved ? 'Discard changes' : 'Discard draft';
}

function discardStoryChanges() {
  const id = activeStoryId;
  const button = document.querySelector('#story-discard');
  const dialog = document.querySelector('#story-dialog');
  const saved = savedStories.some((story) => story.id === id);
  const current = currentStoryDraft();
  const hasDraft = Boolean(storyDrafts[id]);
  const hasContent = hasDraft || current.title || current.text.trim() || current.image;
  if (saved && !hasDraft) {
    showToast('No unsaved changes to discard.');
    return;
  }
  if (!saved && !hasContent) {
    dialog.close();
    return;
  }
  if (!button.classList.contains('is-armed')) {
    button.classList.add('is-armed');
    button.textContent = 'Click again to confirm';
    discardArmTimer = window.setTimeout(disarmStoryDiscard, 3500);
    return;
  }
  const nextDrafts = { ...storyDrafts };
  delete nextDrafts[id];
  if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
    showToast('Could not discard this draft. Your browser storage may be unavailable.');
    return;
  }
  delete storyDrafts[id];
  if (saved) {
    openStoryEditor(id, storyReturnFocus);
    showToast('Changes discarded. Showing your last saved version.');
  } else {
    dialog.close();
    showToast('Draft discarded.');
  }
}

function handleStoryEditorInput() {
  const draft = currentStoryDraft();
  updateStoryCounter(draft.text);
  renderStoryChapters();
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
  const input = event.target;
  resizeStoryImage(file).then((dataUrl) => {
    document.querySelector('#story-image-url').value = dataUrl;
    syncStoryImageChip();
    handleStoryEditorInput();
  }).catch(() => showToast('Could not read that image. Try another file or paste an image link.'))
    .finally(() => { input.value = ''; });
}

function resizeStoryImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      if (!image.naturalWidth || !image.naturalHeight) { reject(new Error('Unreadable image')); return; }
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    });
    image.addEventListener('error', () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); });
    image.src = url;
  });
}

function renderStories() {
  const library = document.querySelector('#story-library');
  library.replaceChildren();
  const savedById = new Map(savedStories.map((story) => [story.id, story]));
  const all = [...savedStories];
  Object.values(storyDrafts).forEach((draft) => {
    const saved = savedById.get(draft.id);
    const item = { ...draft, isDraft: true };
    if (saved) all[all.findIndex((story) => story.id === draft.id)] = item;
    else all.unshift(item);
  });
  const query = document.querySelector('#story-search').value.trim().toLowerCase();
  const kindFilter = document.querySelector('#story-filter-kind').value;
  const progressFilter = document.querySelector('#story-filter-progress').value;
  const sortMode = document.querySelector('#story-sort').value;
  const items = all.filter((story) => {
    if (kindFilter && story.kind !== kindFilter) return false;
    if (progressFilter && story.progress !== progressFilter) return false;
    if (!query) return true;
    return [
      story.title, story.text, story.summary, story.setting, STORY_KINDS[story.kind],
      ...(story.tags || []), ...storyCharacterNames(story),
    ].join(' ').toLowerCase().includes(query);
  });
  items.sort((a, b) => {
    if (sortMode === 'title') return (a.title || 'Untitled story').localeCompare(b.title || 'Untitled story');
    const order = (a.updatedAt || '').localeCompare(b.updatedAt || '');
    return sortMode === 'oldest' ? order : -order;
  });
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
    label.textContent = story.isDraft ? `DRAFT · ${(STORY_KINDS[story.kind] || 'Story').toUpperCase()}` : (STORY_KINDS[story.kind] || 'Story').toUpperCase();
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
    excerpt.textContent = story.summary || story.text.trim() || 'Nothing written yet. Open this story to keep going.';
    const chips = document.createElement('span');
    chips.className = 'story-card-chips';
    const progressChip = document.createElement('span');
    progressChip.className = `story-chip story-chip-${story.progress}`;
    progressChip.textContent = STORY_PROGRESS[story.progress] || 'Drafting';
    chips.append(progressChip);
    const chapterTotal = parseStoryChapters(story.text || '').length;
    if (chapterTotal) {
      const chapterChip = document.createElement('span');
      chapterChip.className = 'story-chip';
      chapterChip.textContent = `${chapterTotal} chapter${chapterTotal === 1 ? '' : 's'}`;
      chips.append(chapterChip);
    }
    (story.tags || []).slice(0, 3).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'story-chip';
      chip.textContent = `#${tag}`;
      chips.append(chip);
    });
    const castNames = storyCharacterNames(story);
    const cast = document.createElement('span');
    cast.className = 'story-card-cast';
    cast.textContent = castNames.length
      ? `✦ ${castNames.slice(0, 2).join(', ')}${castNames.length > 2 ? ` +${castNames.length - 2}` : ''}`
      : '';
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
    card.append(header, title, excerpt, chips);
    if (castNames.length) card.append(cast);
    card.append(action);
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
  document.querySelector('#story-sidebar-count').textContent = String(all.length);
  document.querySelector('#lore-count').textContent = `(${all.length})`;
  document.querySelector('#story-empty').classList.toggle('hidden', all.length > 0);
  document.querySelector('#story-filter-bar').classList.toggle('hidden', all.length === 0);
  document.querySelector('#story-no-results').classList.toggle('hidden', !(all.length > 0 && items.length === 0));
  library.classList.toggle('hidden', items.length === 0);
  const previewStory = all.find((story) => story.id === previewStoryId) || items[0] || all[0];
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
    backgroundColor: DEFAULT_STORY_BACKGROUND, image: '', ...normalizeStoryMeta({}),
  };
  document.querySelector('#story-title').value = story.title;
  document.querySelector('#story-text').value = story.text;
  document.querySelector('#story-title-font').value = story.titleFont || 'playfair';
  document.querySelector('#story-body-font').value = story.bodyFont || 'dm-sans';
  document.querySelector('#story-background').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-background-hex').value = normalizeStoryBackground(story.backgroundColor);
  document.querySelector('#story-image-url').value = story.image;
  syncStoryImageChip();
  const meta = normalizeStoryMeta(story);
  document.querySelector('#story-kind').value = meta.kind;
  document.querySelector('#story-progress').value = meta.progress;
  document.querySelector('#story-summary').value = meta.summary;
  document.querySelector('#story-setting').value = meta.setting;
  document.querySelector('#story-tags').value = meta.tags.join(', ');
  renderStoryCharacterPicker(meta.characterIds);
  updateStoryCounter(story.text);
  document.querySelector('#story-chapters-panel').open = false;
  renderStoryChapters();
  renderStoryHistory();
  disarmStoryDiscard();
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
  const previousSaved = savedStories.find((item) => item.id === story.id);
  savedStories.splice(0, savedStories.length, ...nextStories);
  delete storyDrafts[story.id];
  if (previousSaved && !(storyVersions[story.id] || []).length) recordStoryVersion(previousSaved);
  recordStoryVersion(story);
  renderStoryHistory();
  if (!writeStorage(STORY_DRAFTS_KEY, storyDrafts)) {
    showToast('Story saved, but its temporary draft could not be cleared.');
  }
  document.querySelector('#story-save-status').textContent = 'Story saved on this device';
  document.querySelector('#story-editor-title').textContent = story.title;
  renderStories();
  showToast('Story saved.');
  return true;
}

function saveStoryDraft() {
  const draft = currentStoryDraft();
  const saved = savedStories.find((story) => story.id === draft.id);
  const unchanged = saved && saved.title === draft.title && saved.text === draft.text
    && saved.titleFont === draft.titleFont && saved.bodyFont === draft.bodyFont
    && saved.backgroundColor === draft.backgroundColor && saved.image === draft.image
    && storyMetaEqual(saved, draft);
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
  document.querySelector('#backstory-count').textContent = String(profile.story.length);
  updateProfileMeter(profile);
  syncImageChips();
  syncGalleryThumbs();

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
  const groupSelect = document.querySelector('#cast-group-filter');
  const allGroups = [...new Set(characters.flatMap((character) => character.groups || []))].sort((a, b) => a.localeCompare(b));
  const previousGroup = groupSelect.value;
  groupSelect.replaceChildren(new Option('All groups', ''), ...allGroups.map((group) => new Option(group, group)));
  groupSelect.value = allGroups.includes(previousGroup) ? previousGroup : '';
  groupSelect.classList.toggle('hidden', !allGroups.length);
  const groupFilter = groupSelect.value;
  const sortMode = document.querySelector('#cast-sort').value;
  const filtered = characters.filter((character) => (!groupFilter || (character.groups || []).includes(groupFilter)) && [
    character.name,
    character.role,
    character.species,
    character.description,
    ...(character.traits || []),
    ...(character.groups || []),
  ].join(' ').toLowerCase().includes(query));
  if (sortMode === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortMode === 'edited') filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    if ((character.groups || []).length) {
      const groupLine = document.createElement('span');
      groupLine.className = 'cast-groups';
      groupLine.textContent = `⚑ ${character.groups.slice(0, 2).join(', ')}${character.groups.length > 2 ? ` +${character.groups.length - 2}` : ''}`;
      info.append(groupLine);
    }
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
  renderRelationEditors();
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

function renderProfileStories(characterId) {
  const box = document.querySelector('#profile-stories');
  box.replaceChildren();
  const linked = savedStories.filter((story) => (story.characterIds || []).includes(characterId));
  if (!linked.length) {
    const hint = document.createElement('p');
    hint.className = 'profile-empty';
    hint.textContent = 'Not in any story yet. Pick this character under “Story details” when writing a story.';
    box.append(hint);
    return;
  }
  linked.forEach((story) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-story-link';
    const name = document.createElement('strong');
    name.textContent = story.title || 'Untitled story';
    const detail = document.createElement('span');
    detail.textContent = `${STORY_KINDS[story.kind] || 'Story'} · ${STORY_PROGRESS[story.progress] || 'Drafting'}`;
    button.append(name, detail);
    button.addEventListener('click', () => {
      requestProfileClose(() => openStoryEditor(story.id, document.querySelector('#new-story')));
    });
    box.append(button);
  });
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
  [...profile.traits, profile.pronouns, profile.age, profile.species, ...(profile.groups || []).map((group) => `⚑ ${group}`)].filter(Boolean).forEach((item) => {
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
  renderProfileStories(profile.id);
  renderProfileDepth(profile);
  renderProfileConnections(profile);
  renderProfileTimeline(profile);
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
    cover: character.cover,
    accent: character.accent || '#4385e8',
    story: character.story,
    gallery: character.gallery,
    relations: character.relations,
    links: character.links,
    worlds: character.worlds,
    stats: character.stats,
    groups: traitsValue(character.groups),
    goal: character.goal, fear: character.fear, secret: character.secret, flaw: character.flaw,
    voice: character.voice, appearance: character.appearance, bonds: character.bonds, timeline: character.timeline,
  }).forEach(([idName, value]) => { document.getElementById(idName).value = value || ''; });
  imageCropState = {
    avatar: normalizeImageCrop(character.avatarCrop),
    cover: normalizeImageCrop(character.coverCrop),
  };
  rememberImageSources();
  document.querySelector('#accent-hex').value = document.querySelector('#accent').value;
  document.querySelector('#save-label').textContent = 'Update character';
  syncCharacterActions(true);
  localStorage.removeItem(DRAFT_KEY);
  document.querySelector('#autosave-status').textContent = 'Editing saved character';
  characterFormHasChanges = false;
  document.querySelector('#depth-details').open = Boolean(character.goal || character.fear || character.secret
    || character.flaw || character.voice || character.appearance);
  document.querySelector('#profile-extras').open = Boolean(characterBonds(character).length || parseTimeline(character.timeline).length);
  renderRelationEditors();
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
  syncCharacterActions(false);
  document.querySelector('#appearance-details').open = false;
  document.querySelector('#profile-extras').open = false;
  document.querySelector('#depth-details').open = false;
  renderRelationEditors();
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
  button.classList.toggle('is-visible', window.scrollY > 360 && !characterDialog.open && !aboutDialog.open && !changelogDialog.open && !document.querySelector('#story-dialog').open);
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

let renderedGalleryValue = null;

function imageSummary(value) {
  if (value.startsWith('data:')) return 'Uploaded image';
  try {
    const url = new URL(value);
    const path = url.pathname.length > 1 ? url.pathname : '';
    return `${url.hostname.replace(/^www\./, '')}${path.length > 26 ? `${path.slice(0, 26)}…` : path}`;
  } catch {
    return 'Image link';
  }
}

function syncImageChip(chip, wrap, value, show) {
  const visible = Boolean(show && value && validImageSource(value));
  wrap.classList.toggle('has-image', visible);
  chip.classList.toggle('hidden', !visible);
  const image = chip.querySelector('img');
  if (!visible) {
    if (chip.dataset.src) {
      chip.dataset.src = '';
      image.removeAttribute('src');
    }
    return;
  }
  if (chip.dataset.src !== value) {
    chip.dataset.src = value;
    image.classList.remove('hidden');
    image.onerror = () => image.classList.add('hidden');
    image.src = value;
  }
  const label = chip.querySelector('.upload-chip-text');
  label.textContent = imageSummary(value);
  label.title = value.startsWith('data:') ? '' : value;
}

function syncImageChips() {
  ['avatar', 'cover'].forEach((kind) => {
    const field = imageField(kind);
    const value = field.value.trim();
    syncImageChip(document.querySelector(`#${kind}-chip`), field.closest('.avatar-input-wrap'), value,
      value === (field.dataset.confirmedSource || ''));
  });
}

function syncStoryImageChip() {
  const field = document.querySelector('#story-image-url');
  syncImageChip(document.querySelector('#story-image-chip'), field.closest('.story-image-control'), field.value.trim(), true);
}

function galleryLines() {
  return document.querySelector('#gallery').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setGalleryLines(lines) {
  const gallery = document.querySelector('#gallery');
  gallery.value = lines.join('\n');
  gallery.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncGalleryThumbs() {
  const gallery = document.querySelector('#gallery');
  if (renderedGalleryValue === gallery.value) return;
  renderedGalleryValue = gallery.value;
  const list = document.querySelector('#gallery-thumbs');
  list.replaceChildren();
  galleryLines().forEach((line, index) => {
    const item = document.createElement('li');
    item.className = 'gallery-thumb';
    if (validImageSource(line)) {
      const image = document.createElement('img');
      image.alt = `Extra image ${index + 1}`;
      image.loading = 'lazy';
      image.title = line.startsWith('data:') ? 'Uploaded image' : line;
      image.addEventListener('error', () => {
        image.remove();
        item.classList.add('is-broken');
        item.dataset.note = 'Could not load';
      });
      image.src = line;
      item.append(image);
    } else {
      item.classList.add('is-broken');
      item.dataset.note = 'Not an image link';
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove extra image ${index + 1}`);
    remove.addEventListener('click', () => setGalleryLines(galleryLines().filter((_, position) => position !== index)));
    item.append(remove);
    list.append(item);
  });
}

function addGalleryLink() {
  const input = document.querySelector('#gallery-url');
  const value = input.value.trim();
  if (!value) {
    showToast('Paste an image link first.');
    input.focus();
    return;
  }
  if (!validWebUrl(value)) {
    showToast('Use a direct http(s) image link, or upload an image file.');
    input.focus();
    return;
  }
  if (galleryLines().includes(value)) {
    showToast('That image is already in the gallery.');
    return;
  }
  setGalleryLines([...galleryLines(), value]);
  input.value = '';
  input.focus();
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
  syncImageChips();
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

function renderChangelog() {
  const list = document.querySelector('#changelog-list');
  list.replaceChildren();
  CHANGELOG.forEach((entry, index) => {
    const card = document.createElement('article');
    card.className = 'changelog-entry';
    const header = document.createElement('div');
    header.className = 'changelog-entry-header';
    const version = document.createElement('h2');
    version.textContent = `Version ${entry.version}`;
    header.append(version);
    if (index === 0) {
      const badge = document.createElement('span');
      badge.className = 'changelog-badge';
      badge.textContent = 'Latest';
      header.append(badge);
    }
    const date = document.createElement('time');
    date.textContent = entry.date;
    date.dateTime = entry.date.replaceAll('/', '-');
    header.append(date);
    const notes = document.createElement('ul');
    entry.notes.forEach((note) => {
      const item = document.createElement('li');
      const match = note.match(/^(Lore & Story|Characters|Images|Fixed|Added)(:|\b)/);
      if (match && match[2] === ':') {
        const label = document.createElement('strong');
        label.textContent = `${match[1]}:`;
        item.append(label, note.slice(match[0].length));
      } else {
        item.textContent = note;
      }
      notes.append(item);
    });
    card.append(header, notes);
    list.append(card);
  });
}

function requestChangelogClose() {
  if (!changelogDialog.open || changelogDialog.classList.contains('is-closing')) return;
  changelogDialog.classList.add('is-closing');
  const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  changelogCloseTimer = window.setTimeout(() => {
    changelogDialog.close();
    changelogCloseTimer = null;
  }, delay);
}
document.querySelector('#changelog-open').addEventListener('click', (event) => {
  changelogReturnFocus = event.currentTarget;
  renderChangelog();
  changelogDialog.classList.remove('is-closing');
  changelogDialog.showModal();
  syncModalScrollLock();
  changelogDialog.querySelector('.profile-scroll').scrollTop = 0;
  document.querySelector('#changelog-close').focus();
});
document.querySelector('#changelog-close').addEventListener('click', requestChangelogClose);
changelogDialog.addEventListener('click', (event) => {
  if (event.target === changelogDialog) requestChangelogClose();
});
changelogDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestChangelogClose();
});
changelogDialog.addEventListener('close', () => {
  if (changelogCloseTimer) {
    window.clearTimeout(changelogCloseTimer);
    changelogCloseTimer = null;
  }
  changelogDialog.classList.remove('is-closing');
  updateBackToTopVisibility();
  if (changelogReturnFocus instanceof HTMLElement && changelogReturnFocus.isConnected) changelogReturnFocus.focus();
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
  profile.updatedAt = new Date().toISOString();
  profile.bonds = serializeBonds(parseBonds(profile.bonds).filter((bond) => bond.id !== profile.id && characters.some((item) => item.id === bond.id)));
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
  const previousSaved = characters.find((item) => item.id === profile.id);
  characters = nextCharacters;
  if (previousSaved && !(characterVersions[profile.id] || []).length) recordCharacterVersion(previousSaved);
  recordCharacterVersion(profile);
  rememberImageSources();
  persistCharacterLibrary();
  activeId = profile.id;
  document.querySelector('#character-id').value = profile.id;
  localStorage.removeItem(DRAFT_KEY);
  characterFormHasChanges = false;
  document.querySelector('#autosave-status').textContent = 'Character saved';
  document.querySelector('#save-label').textContent = 'Update character';
  syncCharacterActions(true);
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
  ['groups', 'Groups'], ['goal', 'Goal'], ['fear', 'Fear'], ['secret', 'Secret'], ['flaw', 'Flaw'],
  ['voice', 'Voice'], ['appearance', 'Appearance'], ['bonds', 'Connections'], ['timeline', 'Timeline'],
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
    .map(([key, label]) => `${label}: ${key === 'bonds'
      ? parseBonds(profile[key]).map((bond) => `${characters.find((item) => item.id === bond.id)?.name || 'Unknown'}${bond.label ? ` (${bond.label})` : ''}`).join(', ')
      : key === 'timeline' ? parseTimeline(profile[key]).map((event) => `${event.when ? `${event.when}: ` : ''}${event.text}`).join('; ')
      : Array.isArray(profile[key]) ? profile[key].join(', ') : profile[key]}`)
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
  const toList = (raw, itemLimit, max) => (Array.isArray(raw)
    ? raw.map((item) => toString(item, itemLimit))
    : toString(raw, 400).split(/[|,]/).map((item) => item.trim().slice(0, itemLimit))).filter(Boolean).slice(0, max);
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
    story: toString(get('story', 'backstory', 'background'), 4000),
    gallery: toString(get('gallery', 'images', 'image urls'), MAX_GALLERY_VALUE_LENGTH),
    relations: toString(get('relations', 'relationships'), 700),
    links: toString(get('links', 'url', 'website'), 700),
    worlds: toString(get('worlds', 'world', 'setting'), 700),
    stats: toString(get('stats', 'extra stats'), 700),
    groups: toList(get('groups', 'group', 'factions', 'faction'), 40, 10),
    goal: toString(get('goal', 'goals'), 200),
    fear: toString(get('fear', 'fears'), 200),
    secret: toString(get('secret', 'secrets'), 300),
    flaw: toString(get('flaw', 'flaws'), 200),
    voice: toString(get('voice', 'catchphrase'), 160),
    appearance: toString(get('appearance', 'looks'), 500),
    bonds: serializeBonds(parseBonds(toString(get('bonds', 'connections'), 3000))),
    timeline: serializeTimeline(parseTimeline(toString(get('timeline', 'events', 'life events'), 12000))),
    updatedAt: toString(get('updatedAt', 'updated at'), 40),
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
    ...normalizeStoryMeta(record),
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

function storiesToReadable(items, markdown) {
  return items.map((story) => {
    const names = storyCharacterNames(story);
    const title = story.title || 'Untitled story';
    const meta = [
      STORY_KINDS[story.kind], `${STORY_PROGRESS[story.progress] || 'Drafting'}${story.isDraft ? ' (unsaved draft)' : ''}`,
      story.setting && `Setting: ${story.setting}`,
      names.length && `Characters: ${names.join(', ')}`,
      story.tags?.length && `Tags: ${story.tags.join(', ')}`,
    ].filter(Boolean).join(' · ');
    return [
      markdown ? `# ${title}` : `${title}\n${'='.repeat(Math.min(title.length, 60))}`,
      meta,
      story.summary && (markdown ? `> ${story.summary}` : story.summary),
      story.text.trim(),
    ].filter(Boolean).join('\n\n');
  }).join(markdown ? '\n\n---\n\n' : '\n\n\n');
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
    const readable = format === 'md' || format === 'txt';
    const extension = readable ? format : format === 'yaml' ? 'yaml' : 'json';
    const content = readable
      ? storiesToReadable([...data.stories, ...data.drafts.map((draft) => ({ ...draft, isDraft: true }))], format === 'md')
      : format === 'yaml' ? toYaml(data) : JSON.stringify(data, null, 2);
    const mimeType = format === 'md' ? 'text/markdown;charset=utf-8' : format === 'txt' ? 'text/plain;charset=utf-8'
      : format === 'yaml' ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8';
    downloadFile(`fable-story-library.${extension}`, content, mimeType);
    showToast(readable
      ? `Stories exported as ${extension.toUpperCase()} for reading. Use JSON or YAML for backups you can import.`
      : `Story library and drafts exported as ${extension.toUpperCase()}.`);
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
  const hasSavedVersion = kind === 'story' && savedStories.some((story) => story.id === id);
  const itemType = kind === 'character' ? 'character' : isDraft && !hasSavedVersion ? 'draft' : 'story';
  document.querySelector('#delete-dialog-title').textContent =
    `Delete ${itemType}?`;
  document.querySelector('#delete-dialog-message').textContent =
    isDraft && hasSavedVersion
      ? `Delete ${item.title || 'Untitled story'}? This removes the saved story, its unsaved changes, and its version history. This cannot be undone.`
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
  if (kind === 'discard-character') {
    pendingDeleteFocus = null;
    deleteDialog.close();
    resetForm();
    return;
  }
  if (kind === 'story') {
    const wasSaved = savedStories.some((story) => story.id === characterId);
    const nextStories = savedStories.filter((story) => story.id !== characterId);
    const nextDrafts = { ...storyDrafts };
    delete nextDrafts[characterId];
    if (wasSaved && !writeStorage(STORIES_STORAGE_KEY, nextStories)) {
      showToast('Could not delete this story. Your browser storage may be unavailable.');
      return;
    }
    if (!writeStorage(STORY_DRAFTS_KEY, nextDrafts)) {
      showToast('Could not remove this story’s draft. Your browser storage may be unavailable.');
      return;
    }
    savedStories.splice(0, savedStories.length, ...nextStories);
    delete storyDrafts[characterId];
    if (storyVersions[characterId]) {
      delete storyVersions[characterId];
      writeStorage(STORY_VERSIONS_KEY, storyVersions);
    }
    if (previewStoryId === characterId) previewStoryId = '';
    renderStories();
    deleteDialog.close();
    showToast(wasSaved ? 'Story deleted.' : 'Story draft deleted.');
    return;
  }
  const nextCharacters = characters.filter((character) => character.id !== characterId).map((character) => (
    parseBonds(character.bonds).some((bond) => bond.id === characterId)
      ? { ...character, bonds: serializeBonds(parseBonds(character.bonds).filter((bond) => bond.id !== characterId)) }
      : character
  ));
  if (!writeStorage(STORAGE_KEY, nextCharacters)) {
    showToast('Could not delete. Your browser storage may be unavailable.');
    return;
  }
  characters = nextCharacters;
  if (characterVersions[characterId]) {
    delete characterVersions[characterId];
    writeStorage(CHARACTER_VERSIONS_KEY, characterVersions);
  }
  persistCharacterLibrary();
  renderCharacters();
  deleteDialog.close();
  if (activeId === characterId) resetForm();
  showToast('Character removed from your cast.');
});

document.querySelector('#search-characters').addEventListener('input', renderCharacters);
['new-character', 'sidebar-new', 'empty-create'].forEach((id) => document.getElementById(id).addEventListener('click', (event) => requestNewCharacter(event.currentTarget)));
document.querySelector('#duplicate-character').addEventListener('click', duplicateCharacter);
document.querySelector('#bond-add').addEventListener('click', addBondFromEditor);
document.querySelector('#bond-label').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addBondFromEditor();
  }
});
['#cast-sort', '#cast-group-filter'].forEach((selector) => document.querySelector(selector).addEventListener('input', renderCharacters));
document.querySelector('#gallery-url-add').addEventListener('click', addGalleryLink);
document.querySelector('#gallery-url').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addGalleryLink();
  }
});
['avatar', 'cover'].forEach((kind) => {
  document.querySelector(`#${kind}-chip .upload-chip-remove`).addEventListener('click', () => {
    const field = imageField(kind);
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    syncImageChips();
    field.focus();
  });
});
document.querySelector('#story-image-url').addEventListener('change', syncStoryImageChip);
document.querySelector('#story-image-chip .upload-chip-remove').addEventListener('click', () => {
  const field = document.querySelector('#story-image-url');
  field.value = '';
  syncStoryImageChip();
  handleStoryEditorInput();
  field.focus();
});
document.querySelector('#timeline-add').addEventListener('click', addTimelineEvent);
['#timeline-when', '#timeline-text'].forEach((selector) => document.querySelector(selector).addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTimelineEvent();
  }
}));
document.querySelector('#prompt-spark').addEventListener('click', nextCharacterPrompt);
document.querySelector('#prompt-next').addEventListener('click', nextCharacterPrompt);
document.querySelector('#prompt-use').addEventListener('click', useCharacterPrompt);

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
document.querySelector('#story-save-close').addEventListener('click', () => {
  if (saveCurrentStory()) document.querySelector('#story-dialog').close();
});
document.querySelector('#story-discard').addEventListener('click', discardStoryChanges);
document.querySelector('#story-format-bar').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-format]');
  if (button) applyStoryFormat(button.dataset.format);
});
document.querySelector('#story-starters').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-starter]');
  if (button) insertStoryStarter(button.dataset.starter);
});
['#story-search', '#story-filter-kind', '#story-filter-progress', '#story-sort'].forEach((selector) => {
  document.querySelector(selector).addEventListener('input', renderStories);
});
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
    worlds: savedDraft.worlds, stats: savedDraft.stats, groups: traitsValue(savedDraft.groups),
    goal: savedDraft.goal, fear: savedDraft.fear, secret: savedDraft.secret, flaw: savedDraft.flaw,
    voice: savedDraft.voice, appearance: savedDraft.appearance, bonds: savedDraft.bonds, timeline: savedDraft.timeline,
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
    syncCharacterActions(true);
  }
}
rememberImageSources();
renderCharacters();
renderStories();
updatePreview();
initializeDataFolder();
