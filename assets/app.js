(() => {
  const data = window.YEAR_PLANNER_DATA;
  const planner = document.getElementById('planner');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let adminMode = false;
  let adminConfig = null;
  let shadeMode = false;
  let shadeStart = '';
  let shadeEnd = '';
  let draggingShade = false;
  let editingShadeId = '';
  let shadeRanges = [];
  let shadeDragMode = 'add';
  let shadePointerStart = '';
  let shadePointerStartedSelected = false;
  let shadePointerHandled = false;

  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const rangesForShade = shade => {
    if (Array.isArray(shade.ranges) && shade.ranges.length) return shade.ranges;
    if (shade.start && shade.end) return [{ start: shade.start, end: shade.end }];
    return [];
  };
  const shadesFor = date => data.shading.filter(s =>
    !s.hidden && rangesForShade(s).some(r => r.start <= date && r.end >= date)
  );

  function applyShade(cell, date) {
    const shades = shadesFor(date);
    cell.style.background = shades.length ? (shades[shades.length - 1].colour || '#eef2f7') : '';
  }

  function renderPlanner() {
    planner.replaceChildren();

    for (let month = 0; month < 12; month++) {
      const section = document.createElement('section');
      section.className = 'month';

      const heading = document.createElement('h2');
      heading.textContent = monthNames[month];
      section.append(heading);

      const grid = document.createElement('div');
      grid.className = 'month-grid';

      for (const weekday of weekdays) {
        const header = document.createElement('div');
        header.className = 'weekday';
        header.textContent = weekday;
        grid.append(header);
      }

      const first = new Date(data.year, month, 1);
      for (let i = 0; i < first.getDay(); i++) {
        const blank = document.createElement('div');
        blank.className = 'day blank';
        grid.append(blank);
      }

      const days = new Date(data.year, month + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const date = iso(new Date(data.year, month, day));
        const cell = document.createElement('div');
        cell.className = 'day';
        cell.dataset.date = date;
        applyShade(cell, date);

        const number = document.createElement('div');
        number.className = 'date-number';
        number.textContent = String(day);
        cell.append(number);

        for (const event of data.events.filter(e => e.date === date)) {
          const item = document.createElement(event.url ? 'a' : 'div');
          item.className = 'event';
          item.dataset.calendar = event.calendarId;
          item.textContent = event.title;
          item.style.background = event.colour;
          item.style.color = event.textColour || '#fff';

          if (event.url) {
            item.href = event.url;
            item.target = '_blank';
            item.rel = 'noopener';
          }

          cell.append(item);
        }

        grid.append(cell);
      }

      section.append(grid);
      planner.append(section);
    }

    bindShadeCells();
  }

  function bindShadeCells() {
    document.querySelectorAll('.day[data-date]').forEach(cell => {
      cell.addEventListener('pointerdown', event => {
        if (!adminMode || !shadeMode) return;

        event.preventDefault();
        draggingShade = true;
        shadePointerHandled = false;
        shadePointerStart = cell.dataset.date;
        shadePointerStartedSelected = dateIsSelected(cell.dataset.date);
        shadeDragMode = event.shiftKey ? 'extend' : 'add';

        if (shadeDragMode === 'extend' && shadeRanges.length) {
          shadeStart = shadeRanges[shadeRanges.length - 1].start;
          shadeEnd = cell.dataset.date;
        } else {
          shadeStart = cell.dataset.date;
          shadeEnd = cell.dataset.date;
        }

        paintShadeSelection();
      });

      cell.addEventListener('pointerenter', () => {
        if (!adminMode || !shadeMode || !draggingShade) return;
        shadeEnd = cell.dataset.date;
        paintShadeSelection();
      });

      cell.addEventListener('pointerup', () => {
        if (!adminMode || !shadeMode || !draggingShade) return;

        const endedOn = cell.dataset.date;
        draggingShade = false;

        // A simple click on an already-selected cell toggles just that date off.
        if (
          shadeDragMode !== 'extend' &&
          shadePointerStartedSelected &&
          shadePointerStart === endedOn
        ) {
          shadePointerHandled = true;
          removeDateFromRanges(endedOn);
          shadeStart = '';
          shadeEnd = '';
          paintShadeSelection();

          // For an existing saved layer, no remaining ranges means deletion is
          // now the meaningful next action. For a brand-new layer, simply leave
          // the selection empty so the user can choose again.
          if (!shadeRanges.length && editingShadeId) showDeleteConfirm();
          return;
        }

        commitCurrentRange();
      });
    });
  }

  document.addEventListener('pointerup', event => {
    if (
      draggingShade &&
      shadeMode &&
      !shadePointerHandled &&
      !(event.target instanceof Element && event.target.closest('.day[data-date]'))
    ) {
      commitCurrentRange();
    }
    draggingShade = false;
    shadePointerHandled = false;
  });

  function normaliseRange(a, b) {
    return a <= b ? [a, b] : [b, a];
  }

  function nextDate(date, days) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    return iso(d);
  }

  function dateIsSelected(date) {
    return shadeRanges.some(range => range.start <= date && range.end >= date);
  }

  function mergeRanges(ranges) {
    const sorted = ranges
      .map(range => {
        const [start, end] = normaliseRange(range.start, range.end);
        return { start, end };
      })
      .sort((a, b) => a.start.localeCompare(b.start));

    const merged = [];
    for (const range of sorted) {
      const previous = merged[merged.length - 1];

      if (!previous || nextDate(previous.end, 1) < range.start) {
        merged.push({ ...range });
        continue;
      }

      if (range.end > previous.end) previous.end = range.end;
    }

    return merged;
  }

  function removeDateFromRanges(date) {
    const next = [];

    for (const range of shadeRanges) {
      if (date < range.start || date > range.end) {
        next.push(range);
        continue;
      }

      if (range.start < date) {
        next.push({ start: range.start, end: nextDate(date, -1) });
      }

      if (date < range.end) {
        next.push({ start: nextDate(date, 1), end: range.end });
      }
    }

    shadeRanges = mergeRanges(next);
  }

  function paintShadeSelection() {
    document.querySelectorAll('.day.is-shade-selection').forEach(el => el.classList.remove('is-shade-selection'));
    document.querySelectorAll('.day.is-shade-selection-preview').forEach(el => el.classList.remove('is-shade-selection-preview'));

    for (const range of shadeRanges) {
      document.querySelectorAll('.day[data-date]').forEach(cell => {
        if (cell.dataset.date >= range.start && cell.dataset.date <= range.end) {
          cell.classList.add('is-shade-selection');
        }
      });
    }

    if (shadeStart && shadeEnd) {
      const [start, end] = normaliseRange(shadeStart, shadeEnd);
      document.querySelectorAll('.day[data-date]').forEach(cell => {
        if (cell.dataset.date >= start && cell.dataset.date <= end) {
          cell.classList.add('is-shade-selection-preview');
        }
      });
    }

    renderShadeRangesList();

    const status = document.getElementById('shade-selection-status');
    if (status) {
      status.textContent = shadeRanges.length
        ? `${shadeRanges.length} range${shadeRanges.length === 1 ? '' : 's'} selected. Drag to add another.`
        : 'Drag across the planner to select dates.';
    }
  }

  function commitCurrentRange() {
    if (!shadeStart || !shadeEnd) return;

    const [start, end] = normaliseRange(shadeStart, shadeEnd);

    if (shadeDragMode === 'extend' && shadeRanges.length) {
      shadeRanges[shadeRanges.length - 1] = { start, end };
    } else {
      shadeRanges.push({ start, end });
    }

    // Collapse overlapping or immediately adjacent selections so each date is
    // represented only once in the layer.
    shadeRanges = mergeRanges(shadeRanges);

    shadeStart = '';
    shadeEnd = '';
    shadeDragMode = 'add';
    paintShadeSelection();
  }

  function renderShadeRangesList() {
    const host = document.getElementById('shade-ranges-list');
    if (!host) return;

    host.replaceChildren();

    if (!shadeRanges.length) {
      const empty = document.createElement('div');
      empty.className = 'shade-range-empty';
      empty.textContent = 'No ranges selected yet.';
      host.append(empty);
      return;
    }

    shadeRanges.forEach((range, index) => {
      const row = document.createElement('div');
      row.className = 'shade-range-row';

      const text = document.createElement('span');
      text.textContent = `${range.start} → ${range.end}`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'shade-range-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        shadeRanges.splice(index, 1);
        paintShadeSelection();

        if (!shadeRanges.length && editingShadeId) {
          showDeleteConfirm();
        }
      });

      row.append(text, remove);
      host.append(row);
    });
  }

  function showDeleteConfirm() {
    const deleteButton = document.getElementById('shade-delete-button');
    const confirmGroup = document.getElementById('shade-delete-confirm-group');

    if (deleteButton) deleteButton.hidden = true;
    if (confirmGroup) confirmGroup.hidden = false;
  }

  function hideDeleteConfirm() {
    const deleteButton = document.getElementById('shade-delete-button');
    const confirmGroup = document.getElementById('shade-delete-confirm-group');

    if (deleteButton) deleteButton.hidden = !editingShadeId;
    if (confirmGroup) confirmGroup.hidden = true;
  }

  function startShadeMode(shade = null) {
    shadeMode = true;
    draggingShade = false;
    document.body.classList.add('shade-select-mode');

    const form = document.getElementById('shade-editor-form');
    const heading = document.getElementById('shade-editor-heading');

    editingShadeId = shade?.id || '';
    shadeStart = '';
    shadeEnd = '';
    shadeRanges = shade
      ? mergeRanges(rangesForShade(shade).map(range => ({ ...range })))
      : [];

    if (heading) heading.textContent = shade ? 'Edit shading' : 'Add shading';

    hideDeleteConfirm();

    if (form) {
      form.reset();
      form.elements.id.value = editingShadeId;
      form.elements.year.value = shade?.year || data.year;
      form.elements.name.value = shade?.name || '';
      form.elements.colour.value = shade?.colour || '#e5e7eb';
    }

    paintShadeSelection();
    showShadeEditor();
  }

  function stopShadeMode() {
    shadeMode = false;
    draggingShade = false;
    shadeStart = '';
    shadeEnd = '';
    shadeRanges = [];
    document.body.classList.remove('shade-select-mode');
    document.querySelectorAll('.day.is-shade-selection').forEach(el => el.classList.remove('is-shade-selection'));
  }

  function showShadeEditor() {
    const panel = document.getElementById('shade-editor-panel');
    if (panel) panel.hidden = false;
  }

  function hideShadeEditor() {
    const panel = document.getElementById('shade-editor-panel');
    if (panel) panel.hidden = true;
    stopShadeMode();
  }

  async function adminApi(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      credentials: 'same-origin',
    });

    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('application/json')) {
      throw new Error('Administrator access is not available.');
    }

    const body = await response.json();
    if (body.ok === false) throw new Error(body.error || 'Request failed.');
    return body;
  }

  async function detectAdmin() {
    try {
      adminConfig = await adminApi('/api/admin/config');
      adminMode = true;
      document.body.classList.add('is-admin');
      document.querySelectorAll('.admin-only').forEach(el => {
        el.hidden = false;
      });
      document.querySelectorAll('.public-manager-label').forEach(el => {
        el.hidden = true;
      });
      document.querySelectorAll('.admin-manager-label').forEach(el => {
        el.hidden = false;
      });
      document.querySelectorAll('.toolbar-control[data-manager]').forEach(el => {
        el.classList.add('toolbar-control--admin');
      });
    } catch {
      adminMode = false;
    }
  }

  function openPlannerIntroEditor() {
    if (!adminMode) return;

    const panel = document.getElementById('planner-intro-editor');
    const form = document.getElementById('planner-intro-form');
    if (!panel || !form) return;

    const intro = data.intro || { text: '', links: [], logoUrl: '' };
    const links = Array.isArray(intro.links) ? intro.links : [];

    form.elements.text.value = intro.text || '';
    form.elements.logoUrl.value = intro.logoUrl || '';
    form.elements.link1Label.value = links[0]?.label || '';
    form.elements.link1Url.value = links[0]?.url || '';
    form.elements.link2Label.value = links[1]?.label || '';
    form.elements.link2Url.value = links[1]?.url || '';

    panel.hidden = false;
  }

  function closePlannerIntroEditor() {
    const panel = document.getElementById('planner-intro-editor');
    if (panel) panel.hidden = true;
  }

  document.getElementById('planner-intro-edit')?.addEventListener('click', openPlannerIntroEditor);
  document.getElementById('planner-intro-close')?.addEventListener('click', closePlannerIntroEditor);

  document.getElementById('planner-intro-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);

    const links = [];
    const link1Url = String(fd.get('link1Url') || '').trim();
    const link2Url = String(fd.get('link2Url') || '').trim();

    if (link1Url) {
      links.push({
        label: String(fd.get('link1Label') || '').trim(),
        url: link1Url,
      });
    }
    if (link2Url) {
      links.push({
        label: String(fd.get('link2Label') || '').trim(),
        url: link2Url,
      });
    }

    await adminApi('/api/admin/planner-intro', {
      method: 'POST',
      body: JSON.stringify({
        year: data.year,
        text: fd.get('text'),
        logoUrl: fd.get('logoUrl'),
        links,
      }),
    });

    location.reload();
  });

  // Movable planner intro editor.
  const introPanel = document.getElementById('planner-intro-editor');
  const introHandle = document.getElementById('planner-intro-drag-handle');
  let introDrag = null;

  introHandle?.addEventListener('pointerdown', event => {
    if (!introPanel) return;
    event.preventDefault();

    const rect = introPanel.getBoundingClientRect();
    introPanel.style.left = `${rect.left}px`;
    introPanel.style.top = `${rect.top}px`;
    introPanel.style.right = 'auto';

    introDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    introHandle.setPointerCapture?.(event.pointerId);
  });

  introHandle?.addEventListener('pointermove', event => {
    if (!introPanel || !introDrag || introDrag.pointerId !== event.pointerId) return;

    const left = Math.max(0, Math.min(window.innerWidth - introPanel.offsetWidth, event.clientX - introDrag.offsetX));
    const top = Math.max(0, Math.min(window.innerHeight - introPanel.offsetHeight, event.clientY - introDrag.offsetY));

    introPanel.style.left = `${left}px`;
    introPanel.style.top = `${top}px`;
  });

  const endIntroDrag = event => {
    if (!introDrag) return;
    if (event.pointerId !== undefined && event.pointerId !== introDrag.pointerId) return;
    introDrag = null;
  };

  introHandle?.addEventListener('pointerup', endIntroDrag);
  introHandle?.addEventListener('pointercancel', endIntroDrag);

  let editingCalendarId = '';

  function hideCalendarDeleteConfirm() {
    const deleteButton = document.getElementById('calendar-delete-button');
    const confirmGroup = document.getElementById('calendar-delete-confirm-group');
    if (deleteButton) deleteButton.hidden = !editingCalendarId;
    if (confirmGroup) confirmGroup.hidden = true;
  }

  function showCalendarDeleteConfirm() {
    const deleteButton = document.getElementById('calendar-delete-button');
    const confirmGroup = document.getElementById('calendar-delete-confirm-group');
    if (deleteButton) deleteButton.hidden = true;
    if (confirmGroup) confirmGroup.hidden = false;
  }

  function openCalendarEditor(calendar = null) {
    if (!adminMode) return;

    editingCalendarId = calendar?.id || '';

    const panel = document.getElementById('calendar-editor-panel');
    const form = document.getElementById('calendar-editor-form');
    const heading = document.getElementById('calendar-editor-heading');
    const syncButton = document.getElementById('calendar-sync-current');

    if (!panel || !form) return;

    form.reset();
    form.elements.id.value = editingCalendarId;
    form.elements.name.value = calendar?.name || '';
    form.elements.colour.value = calendar?.colour || '#356a8a';
    form.elements.url.value = calendar?.url || '';
    form.elements.enabled.checked = calendar?.enabled !== false;

    if (heading) heading.textContent = calendar ? 'Edit calendar' : 'Add calendar';
    if (syncButton) syncButton.hidden = !calendar;

    hideCalendarDeleteConfirm();
    panel.hidden = false;
  }

  function closeCalendarEditor() {
    const panel = document.getElementById('calendar-editor-panel');
    if (panel) panel.hidden = true;
    editingCalendarId = '';
  }

  async function syncCalendar(id, button = null) {
    if (!id) return;
    const original = button?.textContent || 'Sync';
    if (button) {
      button.disabled = true;
      button.textContent = 'Syncing…';
    }

    try {
      await adminApi('/api/admin/sync/' + encodeURIComponent(id), {
        method: 'POST',
        body: '{}',
      });
      if (button) button.textContent = 'Synced';
      window.setTimeout(() => location.reload(), 450);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
      alert(error instanceof Error ? error.message : 'Calendar sync failed.');
    }
  }


  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  function focusToday() {
    const today = todayIso();
    const todayYear = Number(today.slice(0,4));

    if (todayYear !== data.year) {
      window.location.href = `/?year=${todayYear}&today=1`;
      return;
    }

    const cell = document.querySelector(`.day[data-date="${today}"]`);
    if (!cell) return;

    cell.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    cell.classList.remove('today-focus');
    requestAnimationFrame(() => {
      cell.classList.add('today-focus');
      window.setTimeout(() => cell.classList.remove('today-focus'), 2200);
    });
  }

  renderPlanner();


  document.getElementById('today-button')?.addEventListener('click', focusToday);

  if (new URLSearchParams(window.location.search).get('today') === '1') {
    window.setTimeout(focusToday, 120);
  }

  document.querySelectorAll('.calendar-last-synced[data-last-synced]').forEach(el => {
    const raw = el.dataset.lastSynced;
    if (!raw) return;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return;
    el.textContent = `Last synced ${date.toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
  });

  document.querySelectorAll('.calendar-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      document.querySelectorAll(`[data-calendar="${CSS.escape(cb.dataset.calendar)}"]`).forEach(el => {
        el.hidden = !cb.checked;
      });

      const legendItem = document.querySelector(`[data-legend-calendar="${CSS.escape(cb.dataset.calendar)}"]`);
      if (legendItem) legendItem.hidden = !cb.checked;
    });
  });

  document.querySelectorAll('.shade-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const shade = data.shading.find(s => s.id === cb.dataset.shade);
      if (shade) shade.hidden = !cb.checked;

      document.querySelectorAll('.day[data-date]').forEach(cell => {
        applyShade(cell, cell.dataset.date);
      });

      const legendItem = document.querySelector(`[data-legend-shade="${CSS.escape(cb.dataset.shade)}"]`);
      if (legendItem) legendItem.hidden = !cb.checked;
    });
  });

  // Toolbar pop-outs close when clicking outside.
  document.addEventListener('click', event => {
    document.querySelectorAll('.toolbar details[open]').forEach(details => {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  });

  // Help panel.
  const helpButton = document.getElementById('planner-help-button');
  const helpPanel = document.getElementById('planner-help-panel');
  const helpClose = document.getElementById('planner-help-close');

  helpButton?.addEventListener('click', event => {
    event.stopPropagation();
    helpPanel.hidden = !helpPanel.hidden;
  });

  helpPanel?.addEventListener('click', event => event.stopPropagation());
  helpClose?.addEventListener('click', () => { helpPanel.hidden = true; });

  document.addEventListener('click', () => {
    if (helpPanel) helpPanel.hidden = true;
  });

  document.getElementById('add-calendar-button')?.addEventListener('click', () => openCalendarEditor());

  document.querySelectorAll('[data-calendar-edit]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const calendar = (data.calendars || []).find(item => item.id === button.dataset.calendarEdit);
      if (calendar) openCalendarEditor(calendar);
    });
  });

  document.querySelectorAll('[data-calendar-sync]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      syncCalendar(button.dataset.calendarSync, button);
    });
  });

  document.getElementById('calendar-editor-close')?.addEventListener('click', closeCalendarEditor);

  document.getElementById('calendar-editor-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);

    await adminApi('/api/admin/calendar', {
      method: 'POST',
      body: JSON.stringify({
        id: fd.get('id') || undefined,
        name: fd.get('name'),
        colour: fd.get('colour'),
        url: fd.get('url'),
        enabled: form.elements.enabled.checked,
      }),
    });

    location.reload();
  });

  document.getElementById('calendar-delete-button')?.addEventListener('click', () => {
    if (editingCalendarId) showCalendarDeleteConfirm();
  });

  document.getElementById('calendar-delete-cancel')?.addEventListener('click', hideCalendarDeleteConfirm);

  document.getElementById('calendar-delete-confirm')?.addEventListener('click', async () => {
    if (!editingCalendarId) return;
    await adminApi('/api/admin/calendar/' + encodeURIComponent(editingCalendarId), {
      method: 'DELETE',
      body: '{}',
    });
    location.reload();
  });

  document.getElementById('calendar-sync-current')?.addEventListener('click', event => {
    if (editingCalendarId) syncCalendar(editingCalendarId, event.currentTarget);
  });

  const calendarColour = document.getElementById('calendar-colour-input');
  const calendarEditorPanel = document.getElementById('calendar-editor-panel');
  calendarColour?.addEventListener('change', () => calendarColour.blur());
  calendarEditorPanel?.addEventListener('pointerdown', event => {
    if (calendarColour && event.target !== calendarColour) calendarColour.blur();
  });

  document.getElementById('add-shading-button')?.addEventListener('click', () => startShadeMode());

  document.querySelectorAll('[data-shade-edit]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const shade = data.shading.find(item => item.id === button.dataset.shadeEdit);
      if (shade) startShadeMode(shade);
    });
  });
  document.getElementById('shade-editor-close')?.addEventListener('click', hideShadeEditor);

  document.getElementById('shade-selection-clear')?.addEventListener('click', () => {
    shadeRanges = [];
    shadeStart = '';
    shadeEnd = '';
    draggingShade = false;
    paintShadeSelection();

    if (editingShadeId) showDeleteConfirm();
  });


  document.getElementById('shade-delete-button')?.addEventListener('click', () => {
    if (!editingShadeId) return;
    showDeleteConfirm();
  });

  document.getElementById('shade-delete-cancel')?.addEventListener('click', () => {
    hideDeleteConfirm();
  });

  document.getElementById('shade-delete-confirm')?.addEventListener('click', async () => {
    if (!editingShadeId) return;

    await adminApi('/api/admin/shading/' + encodeURIComponent(editingShadeId), {
      method: 'DELETE',
      body: '{}',
    });

    location.reload();
  });

  const shadeColour = document.getElementById('shade-colour-input');

  shadeColour?.addEventListener('change', () => {
    shadeColour.blur();
  });

  document.getElementById('shade-editor-form')?.addEventListener('submit', async event => {
    event.preventDefault();

    const form = event.currentTarget;

    if (!shadeRanges.length) {
      if (editingShadeId) {
        showDeleteConfirm();
      } else {
        alert('Drag across the planner to add at least one shading range.');
      }
      return;
    }

    const fd = new FormData(form);

    await adminApi('/api/admin/shading', {
      method: 'POST',
      body: JSON.stringify({
        id: fd.get('id') || undefined,
        name: fd.get('name'),
        colour: fd.get('colour'),
        year: Number(fd.get('year')),
        ranges: shadeRanges,
      }),
    });

    location.reload();
  });


  const shadeEditorPanel = document.getElementById('shade-editor-panel');
  shadeEditorPanel?.addEventListener('pointerdown', event => {
    const colour = document.getElementById('shade-colour-input');
    if (!colour) return;

    // Only a click on the actual colour input counts as "inside" the colour
    // control. Any other click in the shading dialog should dismiss the picker.
    if (event.target !== colour) {
      colour.blur();
    }
  });

  // Movable calendar editor.
  const calendarPanel = document.getElementById('calendar-editor-panel');
  const calendarHandle = document.getElementById('calendar-dialog-drag-handle');
  let calendarDrag = null;

  calendarHandle?.addEventListener('pointerdown', event => {
    if (!calendarPanel) return;
    event.preventDefault();

    const rect = calendarPanel.getBoundingClientRect();
    calendarPanel.style.left = `${rect.left}px`;
    calendarPanel.style.top = `${rect.top}px`;
    calendarPanel.style.right = 'auto';

    calendarDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    calendarHandle.setPointerCapture?.(event.pointerId);
  });

  calendarHandle?.addEventListener('pointermove', event => {
    if (!calendarPanel || !calendarDrag || calendarDrag.pointerId !== event.pointerId) return;

    const left = Math.max(0, Math.min(window.innerWidth - calendarPanel.offsetWidth, event.clientX - calendarDrag.offsetX));
    const top = Math.max(0, Math.min(window.innerHeight - calendarPanel.offsetHeight, event.clientY - calendarDrag.offsetY));

    calendarPanel.style.left = `${left}px`;
    calendarPanel.style.top = `${top}px`;
  });

  const endCalendarDrag = event => {
    if (!calendarDrag) return;
    if (event.pointerId !== undefined && event.pointerId !== calendarDrag.pointerId) return;
    calendarDrag = null;
  };

  calendarHandle?.addEventListener('pointerup', endCalendarDrag);
  calendarHandle?.addEventListener('pointercancel', endCalendarDrag);

  // Movable shading panel.
  const shadePanel = document.getElementById('shade-editor-panel');
  const handle = document.getElementById('shade-dialog-drag-handle');
  let drag = null;

  handle?.addEventListener('pointerdown', event => {
    if (!shadePanel) return;
    event.preventDefault();

    const rect = shadePanel.getBoundingClientRect();
    shadePanel.style.left = `${rect.left}px`;
    shadePanel.style.top = `${rect.top}px`;
    shadePanel.style.right = 'auto';

    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    handle.setPointerCapture?.(event.pointerId);
  });

  handle?.addEventListener('pointermove', event => {
    if (!shadePanel || !drag || drag.pointerId !== event.pointerId) return;

    const left = Math.max(0, Math.min(window.innerWidth - shadePanel.offsetWidth, event.clientX - drag.offsetX));
    const top = Math.max(0, Math.min(window.innerHeight - shadePanel.offsetHeight, event.clientY - drag.offsetY));

    shadePanel.style.left = `${left}px`;
    shadePanel.style.top = `${top}px`;
  });

  const endDrag = event => {
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    drag = null;
  };

  handle?.addEventListener('pointerup', endDrag);
  handle?.addEventListener('pointercancel', endDrag);

  detectAdmin();
})();
