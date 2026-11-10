(() => {
  "use strict";

  const catalog = window.LONGZU_CATALOG;
  if (!catalog) {
    document.body.innerHTML = "<p style='padding:40px;font-family:serif'>目录数据未加载，请确认 data/catalog.js 与 index.html 位于同一阅读器文件夹中。</p>";
    return;
  }

  const STORAGE_KEY = "longzu-private-reader-v1";
  const elements = {
    html: document.documentElement,
    brandButton: document.querySelector("#brandButton"),
    globalSearchButton: document.querySelector("#globalSearchButton"),
    themeButton: document.querySelector("#themeButton"),
    libraryView: document.querySelector("#libraryView"),
    heroStats: document.querySelector("#heroStats"),
    continuePanel: document.querySelector("#continuePanel"),
    bookGrid: document.querySelector("#bookGrid"),
    warningList: document.querySelector("#warningList"),
    readerView: document.querySelector("#readerView"),
    readerBookButton: document.querySelector("#readerBookButton"),
    readerBookTitle: document.querySelector("#readerBookTitle"),
    readerProgressLine: document.querySelector("#readerProgressLine"),
    bookmarkButton: document.querySelector("#bookmarkButton"),
    settingsButton: document.querySelector("#settingsButton"),
    readerSearchButton: document.querySelector("#readerSearchButton"),
    chapterShell: document.querySelector("#chapterShell"),
    chapterContent: document.querySelector("#chapterContent"),
    chapterNav: document.querySelector("#chapterNav"),
    previousChapterButton: document.querySelector("#previousChapterButton"),
    nextChapterButton: document.querySelector("#nextChapterButton"),
    drawerBackdrop: document.querySelector("#drawerBackdrop"),
    tocDrawer: document.querySelector("#tocDrawer"),
    closeDrawerButton: document.querySelector("#closeDrawerButton"),
    chapterFilter: document.querySelector("#chapterFilter"),
    drawerBooks: document.querySelector("#drawerBooks"),
    chapterList: document.querySelector("#chapterList"),
    settingsPopover: document.querySelector("#settingsPopover"),
    closeSettingsButton: document.querySelector("#closeSettingsButton"),
    fontSizeRange: document.querySelector("#fontSizeRange"),
    lineHeightRange: document.querySelector("#lineHeightRange"),
    pageWidthRange: document.querySelector("#pageWidthRange"),
    fontSizeOutput: document.querySelector("#fontSizeOutput"),
    lineHeightOutput: document.querySelector("#lineHeightOutput"),
    pageWidthOutput: document.querySelector("#pageWidthOutput"),
    searchModal: document.querySelector("#searchModal"),
    closeSearchButton: document.querySelector("#closeSearchButton"),
    searchInput: document.querySelector("#searchInput"),
    searchStatus: document.querySelector("#searchStatus"),
    searchResults: document.querySelector("#searchResults"),
    toast: document.querySelector("#toast"),
  };

  const bookById = new Map(catalog.books.map((book) => [book.id, book]));
  const chapterById = new Map();
  for (const book of catalog.books) {
    for (const chapter of book.chapters) {
      chapterById.set(chapter.id, { ...chapter, book });
    }
  }

  const defaultState = {
    prefs: {
      theme: "paper",
      fontSize: 20,
      lineHeight: 20,
      pageWidth: 760,
    },
    progress: {},
    bookmarks: [],
    lastChapterId: null,
    lastBookId: null,
  };

  const loadSaved = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return {
        prefs: { ...defaultState.prefs, ...(parsed?.prefs || {}) },
        progress: parsed?.progress || {},
        bookmarks: Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : [],
        lastChapterId: parsed?.lastChapterId || null,
        lastBookId: parsed?.lastBookId || null,
      };
    } catch {
      return structuredClone(defaultState);
    }
  };

  let saved = loadSaved();
  let bookmarks = new Set(saved.bookmarks);
  let currentChapterId = null;
  let currentBookId = null;
  let chapterData = null;
  let loadToken = 0;
  let searchIndex = null;
  let searchIndexLoading = null;
  let toastTimer = null;
  let saveTimer = null;
  let lastScrollProgress = 0;

  function saveState() {
    saved.prefs = { ...saved.prefs };
    saved.bookmarks = [...bookmarks];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Local file privacy modes can disable storage; the reader still works.
    }
  }

  function formatNumber(value) {
    if (value >= 10000) {
      const formatted = (value / 10000).toFixed(value >= 100000 ? 1 : 2).replace(/\.0+$/, "");
      return `${formatted} 万`;
    }
    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function readingMinutes(chars) {
    return Math.max(1, Math.round(chars / 420));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeText(value) {
    return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
  }

  function applyPreferences() {
    const prefs = saved.prefs;
    elements.html.dataset.theme = prefs.theme;
    elements.html.style.setProperty("--reader-font-size", `${prefs.fontSize}px`);
    elements.html.style.setProperty("--reader-line-height", String(prefs.lineHeight / 10));
    elements.html.style.setProperty("--reader-width", `${prefs.pageWidth}px`);
    elements.fontSizeRange.value = String(prefs.fontSize);
    elements.lineHeightRange.value = String(prefs.lineHeight);
    elements.pageWidthRange.value = String(prefs.pageWidth);
    elements.fontSizeOutput.value = `${prefs.fontSize}px`;
    elements.lineHeightOutput.value = (prefs.lineHeight / 10).toFixed(1).replace(/\.0$/, "");
    elements.pageWidthOutput.value = `${prefs.pageWidth}px`;
    document.querySelectorAll(".theme-options [data-theme]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.theme === prefs.theme);
    });
  }

  function bookReadCount(book) {
    return book.chapters.filter((chapter) => saved.progress[chapter.id]?.read).length;
  }

  function bookProgress(book) {
    return book.chapters.length ? bookReadCount(book) / book.chapters.length : 0;
  }

  function renderLibrary() {
    elements.heroStats.innerHTML = [
      ["卷册", catalog.stats.books],
      ["章节", catalog.stats.chapters],
      ["总字数", `${formatNumber(catalog.stats.chars)}字`],
    ].map(([label, value]) => `
      <div class="hero-stat"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>
    `).join("");

    elements.bookGrid.innerHTML = catalog.books.map((book) => {
      const progress = bookProgress(book);
      const read = bookReadCount(book);
      const status = read === book.chapters.length
        ? "已读完"
        : read > 0
          ? `${read}/${book.chapters.length} 章`
          : "未开始";
      return `
        <button class="book-card" type="button" data-book-id="${book.id}" style="--book-accent:${book.accent};--book-progress:${Math.round(progress * 100)}%">
          <div class="book-cover">
            <div class="cover-top">
              <span class="cover-index">${escapeHtml(book.roman)} · ${String(book.order + 1).padStart(2, "0")}</span>
              <span class="cover-status">${escapeHtml(status)}</span>
            </div>
            <div class="cover-title">
              <span class="roman">${escapeHtml(book.roman)}</span>
              <h3>${escapeHtml(book.title)}</h3>
            </div>
            <div class="cover-foot">
              <div class="progress-track"><span></span></div>
              <span>${book.chapters.length} CHAPTERS</span>
            </div>
          </div>
          <div class="book-meta">
            <strong>${escapeHtml(book.fullTitle)}</strong>
            <span>${escapeHtml(book.subtitle)} · ${formatNumber(book.charCount)}字</span>
          </div>
        </button>
      `;
    }).join("");

    const last = saved.lastChapterId ? chapterById.get(saved.lastChapterId) : null;
    elements.continuePanel.hidden = !last;
    if (last) {
      const progress = saved.progress[last.id];
      const percent = progress?.scroll ? Math.max(1, Math.round(progress.scroll * 100)) : 0;
      elements.continuePanel.innerHTML = `
        <div class="continue-copy">
          <small>CONTINUE READING</small>
          <strong>${escapeHtml(last.book.title)} · ${escapeHtml(last.label)} ${escapeHtml(last.title)}</strong>
          <span>${percent ? `本章读至 ${percent}%` : "从本章开头继续"} · ${formatNumber(last.charCount)}字</span>
        </div>
        <button class="primary-button" id="continueButton" type="button">继续阅读</button>
      `;
      document.querySelector("#continueButton")?.addEventListener("click", () => openChapter(last.id));
    }

    elements.warningList.innerHTML = catalog.warnings.map((warning) => `
      <div class="warning-item">
        <strong>${escapeHtml(warning.bookTitle)}</strong>
        <span>${escapeHtml(warning.message)}</span>
      </div>
    `).join("");
  }

  function firstUnreadChapter(book) {
    return book.chapters.find((chapter) => !saved.progress[chapter.id]?.read) || book.chapters[0];
  }

  function openBook(bookId) {
    const book = bookById.get(bookId);
    if (!book) return;
    const chapter = firstUnreadChapter(book);
    if (chapter) openChapter(chapter.id);
  }

  function setRoute(chapterId) {
    const target = chapterId ? `#read/${chapterId}` : "#library";
    if (window.location.hash === target) return;
    history.pushState({ chapterId: chapterId || null }, "", target);
  }

  function replaceRoute(chapterId) {
    const target = chapterId ? `#read/${chapterId}` : "#library";
    history.replaceState({ chapterId: chapterId || null }, "", target);
  }

  function showLibrary({ updateHash = true } = {}) {
    currentChapterId = null;
    currentBookId = null;
    chapterData = null;
    elements.libraryView.hidden = false;
    elements.readerView.hidden = true;
    elements.settingsPopover.hidden = true;
    closeDrawer();
    closeSearch();
    renderLibrary();
    window.scrollTo({ top: 0, behavior: "instant" });
    if (updateHash && window.location.hash !== "#library") replaceRoute(null);
    document.title = "龙族 · 私人阅读室";
  }

  function showViewForChapter(chapterId) {
    elements.libraryView.hidden = true;
    elements.readerView.hidden = false;
    document.title = `${chapterById.get(chapterId)?.title || "阅读"} · 龙族`;
  }

  function loaderFor(file) {
    return new Promise((resolve, reject) => {
      const old = document.querySelector("#chapterDataLoader");
      if (old) old.remove();
      window.LONGZU_CHAPTER = null;
      const script = document.createElement("script");
      script.id = "chapterDataLoader";
      script.src = file;
      script.onload = () => {
        if (window.LONGZU_CHAPTER) resolve(window.LONGZU_CHAPTER);
        else reject(new Error("章节数据为空"));
      };
      script.onerror = () => reject(new Error("章节文件无法加载"));
      document.body.appendChild(script);
    });
  }

  function skeletonMarkup() {
    return '<div class="chapter-skeleton"><span></span><span></span><span></span><span></span></div>';
  }

  async function openChapter(chapterId, options = {}) {
    const chapter = chapterById.get(chapterId);
    if (!chapter) {
      showLibrary();
      return;
    }

    saveScrollNow();
    const token = ++loadToken;
    currentChapterId = chapterId;
    currentBookId = chapter.book.id;
    chapterData = null;
    saved.lastChapterId = chapterId;
    saved.lastBookId = chapter.book.id;
    saveState();

    if (options.updateHash !== false) setRoute(chapterId);
    showViewForChapter(chapterId);
    elements.chapterContent.innerHTML = skeletonMarkup();
    elements.chapterContent.setAttribute("aria-busy", "true");
    elements.chapterNav.hidden = true;
    elements.readerBookTitle.textContent = `${chapter.book.title} · ${chapter.label}`;
    updateBookmarkButton();
    renderChapterNavTitle(chapter);
    renderDrawer(chapter.book.id);

    try {
      const data = await loaderFor(chapter.file);
      if (token !== loadToken) return;
      chapterData = data;
      renderChapter(chapter, data);
      elements.chapterContent.removeAttribute("aria-busy");
      elements.chapterNav.hidden = false;
      renderChapterNavigation(chapter);
      updateBookmarkButton();
      updateReaderProgress();

      requestAnimationFrame(() => {
        const storedScroll = options.restore === false ? 0 : (saved.progress[chapter.id]?.scroll || 0);
        const shouldRestore = options.keepScroll ? false : storedScroll > 0.01;
        if (shouldRestore) {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo({ top: Math.round(max * storedScroll), behavior: "instant" });
        } else {
          window.scrollTo({ top: 0, behavior: "instant" });
        }
        elements.chapterContent.focus({ preventScroll: true });
      });
    } catch (error) {
      if (token !== loadToken) return;
      elements.chapterContent.innerHTML = `
        <div class="empty-state">
          这一章没有成功加载。<br>
          请确认整个“龙族阅读器”文件夹被完整复制，且浏览器允许打开本地网页。
        </div>
      `;
      elements.chapterContent.removeAttribute("aria-busy");
      console.error(error);
    }
  }

  function renderChapter(chapter, data) {
    const part = chapter.part ? `<p class="chapter-part">${escapeHtml(chapter.part)}</p>` : "";
    const subtitle = chapter.englishTitle ? `<p class="chapter-subtitle">${escapeHtml(chapter.englishTitle)}</p>` : "";
    const paragraphs = data.paragraphs.map((paragraph) => {
      if (/^(?:\*\s*){3,}$/.test(paragraph) || /^[-—─]{3,}$/.test(paragraph)) {
        return '<p class="separator" aria-label="分隔">···</p>';
      }
      return `<p>${escapeHtml(paragraph)}</p>`;
    }).join("");

    elements.chapterContent.innerHTML = `
      <header class="chapter-header">
        ${part}
        <p class="chapter-label">${escapeHtml(chapter.book.roman)} · ${escapeHtml(chapter.label)}</p>
        <h1 class="chapter-title">${escapeHtml(chapter.title)}</h1>
        ${subtitle}
      </header>
      <div class="chapter-body">${paragraphs || '<p>本章没有可显示的正文。</p>'}</div>
      <div class="chapter-end">本章终</div>
    `;
  }

  function chapterPosition(chapter) {
    return chapter.book.chapters.findIndex((item) => item.id === chapter.id);
  }

  function renderChapterNavTitle(chapter) {
    elements.previousChapterButton.innerHTML = `<small>上一章</small><strong>${escapeHtml(chapter.book.title)} · ${escapeHtml(chapter.label)}</strong>`;
    elements.nextChapterButton.innerHTML = `<small>下一章</small><strong>${escapeHtml(chapter.book.title)} · ${escapeHtml(chapter.label)}</strong>`;
  }

  function renderChapterNavigation(chapter) {
    const index = chapterPosition(chapter);
    const previous = chapter.book.chapters[index - 1];
    const next = chapter.book.chapters[index + 1];
    elements.previousChapterButton.disabled = !previous;
    elements.nextChapterButton.disabled = !next;
    elements.previousChapterButton.innerHTML = previous
      ? `<small>上一章</small><strong>${escapeHtml(previous.label)} · ${escapeHtml(previous.title)}</strong>`
      : "<small>上一章</small><strong>已是全书开篇</strong>";
    elements.nextChapterButton.innerHTML = next
      ? `<small>下一章</small><strong>${escapeHtml(next.label)} · ${escapeHtml(next.title)}</strong>`
      : "<small>下一章</small><strong>本卷结束</strong>";
  }

  function navigateChapter(direction) {
    const chapter = chapterById.get(currentChapterId);
    if (!chapter) return;
    const index = chapterPosition(chapter);
    const target = chapter.book.chapters[index + direction];
    if (target) openChapter(target.id, { restore: false });
  }

  function saveScrollNow() {
    if (!currentChapterId || elements.readerView.hidden) return;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, window.scrollY / max));
    const previous = saved.progress[currentChapterId] || {};
    saved.progress[currentChapterId] = {
      ...previous,
      scroll: progress,
      read: Boolean(previous.read || progress >= 0.88),
      updatedAt: Date.now(),
    };
    lastScrollProgress = progress;
    saveState();
  }

  function scheduleScrollSave() {
    if (!currentChapterId || elements.readerView.hidden) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScrollNow, 220);
  }

  function updateReaderProgress() {
    if (elements.readerView.hidden) return;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const raw = Math.max(0, Math.min(1, window.scrollY / max));
    lastScrollProgress = raw;
    elements.readerProgressLine.style.width = `${Math.max(1, raw * 100)}%`;
  }

  function closeDrawer() {
    elements.tocDrawer.classList.remove("is-open");
    elements.tocDrawer.setAttribute("aria-hidden", "true");
    elements.drawerBackdrop.hidden = true;
  }

  function openDrawer() {
    elements.drawerBackdrop.hidden = false;
    elements.tocDrawer.classList.add("is-open");
    elements.tocDrawer.setAttribute("aria-hidden", "false");
    renderDrawer(currentBookId);
    requestAnimationFrame(() => elements.chapterFilter.focus());
  }

  function renderDrawer(bookId) {
    const book = bookById.get(bookId || currentBookId);
    if (!book) return;
    elements.drawerBooks.innerHTML = catalog.books.map((item) => `
      <button class="drawer-book ${item.id === book.id ? "is-active" : ""}" data-drawer-book="${item.id}" type="button">
        ${escapeHtml(item.roman)} · ${escapeHtml(item.title)}
      </button>
    `).join("");
    renderChapterList(book);
    const current = elements.chapterList.querySelector(".is-current");
    current?.scrollIntoView({ block: "center" });
  }

  function renderChapterList(book) {
    const query = elements.chapterFilter.value.trim().toLocaleLowerCase("zh-CN");
    const chapters = book.chapters.filter((chapter) => {
      if (!query) return true;
      return `${chapter.label} ${chapter.title} ${chapter.englishTitle} ${chapter.part}`.toLocaleLowerCase("zh-CN").includes(query);
    });

    if (!chapters.length) {
      elements.chapterList.innerHTML = '<p class="empty-state">没有匹配的章节。</p>';
      return;
    }

    let lastPart = null;
    const markup = [];
    for (const chapter of chapters) {
      if (chapter.part && chapter.part !== lastPart) {
        markup.push(`<p class="chapter-group">${escapeHtml(chapter.part)}</p>`);
        lastPart = chapter.part;
      }
      const progress = saved.progress[chapter.id];
      markup.push(`
        <button class="chapter-item ${chapter.id === currentChapterId ? "is-current" : ""} ${progress?.read ? "is-read" : ""}" data-chapter-id="${chapter.id}" type="button">
          <span class="chapter-item-label">${escapeHtml(chapter.label)}</span>
          <span class="chapter-item-title">${escapeHtml(chapter.title)}</span>
          <span class="chapter-item-dot" aria-hidden="true"></span>
        </button>
      `);
    }
    elements.chapterList.innerHTML = markup.join("");
  }

  function updateBookmarkButton() {
    const active = currentChapterId ? bookmarks.has(currentChapterId) : false;
    elements.bookmarkButton.setAttribute("aria-pressed", String(active));
    elements.bookmarkButton.setAttribute("aria-label", active ? "移除书签" : "添加书签");
    elements.bookmarkButton.title = active ? "移除书签" : "添加书签";
  }

  function toggleBookmark() {
    if (!currentChapterId) return;
    if (bookmarks.has(currentChapterId)) {
      bookmarks.delete(currentChapterId);
      showToast("已移除书签");
    } else {
      bookmarks.add(currentChapterId);
      showToast("已添加书签");
    }
    saveState();
    updateBookmarkButton();
    renderChapterList(bookById.get(currentBookId));
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 1600);
  }

  function openSettings() {
    elements.settingsPopover.hidden = false;
    applyPreferences();
  }

  function closeSettings() {
    elements.settingsPopover.hidden = true;
  }

  function ensureSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchIndexLoading) return searchIndexLoading;
    searchIndexLoading = new Promise((resolve, reject) => {
      window.LONGZU_SEARCH_INDEX = null;
      const script = document.createElement("script");
      script.src = "data/search.js";
      script.onload = () => {
        searchIndex = window.LONGZU_SEARCH_INDEX || [];
        resolve(searchIndex);
      };
      script.onerror = () => reject(new Error("搜索索引无法加载"));
      document.body.appendChild(script);
    });
    return searchIndexLoading;
  }

  function openSearch() {
    elements.searchModal.hidden = false;
    elements.searchResults.innerHTML = `
      <p class="search-placeholder">可以搜索人物、地点、招式或记得的句子。<br>第一次搜索时需要读取全文索引，通常只用几秒。</p>
    `;
    elements.searchStatus.textContent = "输入至少 2 个字";
    requestAnimationFrame(() => elements.searchInput.focus());
  }

  function closeSearch() {
    elements.searchModal.hidden = true;
    elements.searchInput.value = "";
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(value, query) {
    const safe = escapeHtml(value);
    const safeQuery = escapeHtml(query);
    if (!safeQuery) return safe;
    return safe.replace(new RegExp(escapeRegExp(safeQuery), "gi"), (match) => `<mark>${match}</mark>`);
  }

  async function performSearch(rawQuery) {
    const query = rawQuery.trim();
    if (query.length < 2) {
      elements.searchStatus.textContent = "输入至少 2 个字";
      elements.searchResults.innerHTML = '<p class="search-placeholder">输入至少两个字后开始搜索。</p>';
      return;
    }

    elements.searchStatus.textContent = "正在读取全文…";
    elements.searchResults.innerHTML = '<p class="search-placeholder">正在翻阅全部卷册…</p>';
    try {
      const index = await ensureSearchIndex();
      const normalizedQuery = normalizeText(query);
      const results = [];
      for (const entry of index) {
        const normalizedEntry = normalizeText(`${entry.title}\n${entry.text}`);
        const position = normalizedEntry.indexOf(normalizedQuery);
        if (position < 0) continue;
        const rawPosition = entry.text.toLocaleLowerCase("zh-CN").indexOf(query.toLocaleLowerCase("zh-CN"));
        const start = Math.max(0, rawPosition - 65);
        const end = Math.min(entry.text.length, rawPosition + query.length + 95);
        const snippet = `${start > 0 ? "…" : ""}${entry.text.slice(start, end).replace(/\n+/g, " ")}${end < entry.text.length ? "…" : ""}`;
        results.push({ ...entry, snippet });
        if (results.length >= 60) break;
      }

      elements.searchStatus.textContent = results.length ? `${results.length} 个章节命中` : "没有结果";
      elements.searchResults.innerHTML = results.length
        ? results.map((entry) => `
          <button class="search-result" type="button" data-search-chapter="${entry.id}">
            <span class="search-result-head">
              <strong>${escapeHtml(entry.label)} · ${escapeHtml(entry.title)}</strong>
              <small>${escapeHtml(entry.bookTitle)}${entry.part ? ` / ${escapeHtml(entry.part)}` : ""}</small>
            </span>
            <p>${highlight(entry.snippet, query)}</p>
          </button>
        `).join("")
        : '<p class="search-placeholder">没有找到这个说法。可以缩短关键词，或换一个更容易辨认的词。</p>';
    } catch (error) {
      elements.searchStatus.textContent = "索引未加载";
      elements.searchResults.innerHTML = '<p class="search-placeholder">全文索引没有成功加载。请确认 data/search.js 文件存在。</p>';
      console.error(error);
    }
  }

  function toggleNightReading() {
    saved.prefs.theme = saved.prefs.theme === "night" ? "paper" : "night";
    saveState();
    applyPreferences();
    showToast(saved.prefs.theme === "night" ? "已切换夜读模式" : "已恢复纸白模式");
  }

  function routeFromHash() {
    const match = window.location.hash.match(/^#read\/([a-z0-9-]+)$/i);
    if (match && chapterById.has(match[1])) {
      openChapter(match[1], { updateHash: false });
      return;
    }
    showLibrary({ updateHash: false });
  }

  // Event delegation
  elements.bookGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-book-id]");
    if (card) openBook(card.dataset.bookId);
  });

  elements.brandButton.addEventListener("click", () => {
    saveScrollNow();
    setRoute(null);
    showLibrary({ updateHash: false });
  });

  elements.readerBookButton.addEventListener("click", openDrawer);
  elements.closeDrawerButton.addEventListener("click", closeDrawer);
  elements.drawerBackdrop.addEventListener("click", closeDrawer);
  elements.chapterFilter.addEventListener("input", () => {
    const book = bookById.get(currentBookId);
    if (book) renderChapterList(book);
  });

  elements.drawerBooks.addEventListener("click", (event) => {
    const button = event.target.closest("[data-drawer-book]");
    if (!button) return;
    const book = bookById.get(button.dataset.drawerBook);
    const target = firstUnreadChapter(book);
    renderChapterList(book);
    elements.drawerBooks.querySelectorAll(".drawer-book").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.drawerBook === book.id);
    });
    if (target) openChapter(target.id);
  });

  elements.chapterList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chapter-id]");
    if (!button) return;
    closeDrawer();
    openChapter(button.dataset.chapterId, { restore: false });
  });

  elements.previousChapterButton.addEventListener("click", () => navigateChapter(-1));
  elements.nextChapterButton.addEventListener("click", () => navigateChapter(1));
  elements.bookmarkButton.addEventListener("click", toggleBookmark);
  elements.settingsButton.addEventListener("click", () => {
    if (elements.settingsPopover.hidden) openSettings();
    else closeSettings();
  });
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.themeButton.addEventListener("click", toggleNightReading);

  elements.settingsPopover.addEventListener("click", (event) => {
    const themeButton = event.target.closest("[data-theme]");
    if (themeButton) {
      saved.prefs.theme = themeButton.dataset.theme;
      saveState();
      applyPreferences();
    }
  });

  elements.fontSizeRange.addEventListener("input", (event) => {
    saved.prefs.fontSize = Number(event.target.value);
    saveState();
    applyPreferences();
  });
  elements.lineHeightRange.addEventListener("input", (event) => {
    saved.prefs.lineHeight = Number(event.target.value);
    saveState();
    applyPreferences();
  });
  elements.pageWidthRange.addEventListener("input", (event) => {
    saved.prefs.pageWidth = Number(event.target.value);
    saveState();
    applyPreferences();
  });

  elements.globalSearchButton.addEventListener("click", openSearch);
  elements.readerSearchButton.addEventListener("click", openSearch);
  elements.closeSearchButton.addEventListener("click", closeSearch);
  document.querySelector("[data-close-search]")?.addEventListener("click", closeSearch);

  let searchTimer = null;
  elements.searchInput.addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value;
    searchTimer = setTimeout(() => performSearch(value), 260);
  });

  elements.searchResults.addEventListener("click", (event) => {
    const result = event.target.closest("[data-search-chapter]");
    if (!result) return;
    closeSearch();
    openChapter(result.dataset.searchChapter, { restore: false });
  });

  document.addEventListener("click", (event) => {
    if (!elements.settingsPopover.hidden
      && !elements.settingsPopover.contains(event.target)
      && !elements.settingsButton.contains(event.target)) {
      closeSettings();
    }
  });

  document.addEventListener("keydown", (event) => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape") {
      if (!elements.searchModal.hidden) closeSearch();
      else if (!elements.settingsPopover.hidden) closeSettings();
      else if (elements.tocDrawer.classList.contains("is-open")) closeDrawer();
      return;
    }
    if (isTyping || elements.readerView.hidden) return;
    if (event.key === "ArrowLeft" && !elements.previousChapterButton.disabled) navigateChapter(-1);
    if (event.key === "ArrowRight" && !elements.nextChapterButton.disabled) navigateChapter(1);
  });

  window.addEventListener("scroll", () => {
    updateReaderProgress();
    scheduleScrollSave();
  }, { passive: true });

  window.addEventListener("popstate", () => {
    saveScrollNow();
    routeFromHash();
  });

  window.addEventListener("beforeunload", saveScrollNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScrollNow();
  });

  applyPreferences();
  routeFromHash();
})();
