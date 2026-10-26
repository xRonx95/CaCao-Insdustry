// Shared directory behavior; each workspace keeps its own HTML/CSS/JS entry point.
window.CacaoDirectory = (() => {
  const text = (tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
  };
  function matches(farm, filters) {
    const haystack = [farm.name, farm.farmer_name, farm.barangay, farm.municipality, farm.id].join(' ').toLocaleLowerCase();
    return (!filters.search || haystack.includes(filters.search.trim().toLocaleLowerCase()))
      && (!filters.barangay || farm.barangay === filters.barangay)
      && (!filters.status || farm.status === filters.status)
      && (!filters.review || farm.verification_status === filters.review);
  }
  async function start() {
    let rows = [], page = 0;
    const filters = () => ({
      search: $('directory-search').value,
      barangay: $('directory-barangay').value,
      status: $('directory-status').value,
      review: $('directory-review').value
    });
    function render() {
      const filtered = rows.filter(row => matches(row, filters()));
      const last = Math.max(0, Math.ceil(filtered.length / 12) - 1);
      page = Math.min(page, last);
      const list = $('plantation-list');
      list.replaceChildren();
      for (const farm of filtered.slice(page * 12, page * 12 + 12)) {
        const card = text('article', '');
        card.className = 'farm-item';
        const edit = text('a', farm.name);
        edit.href = 'plantation-workspace.html?id=' + encodeURIComponent(farm.id);
        edit.append(text('small', [farm.farmer_name, farm.barangay, farm.municipality].filter(Boolean).join(' · ')));
        card.append(edit, text('small', Number(farm.tree_count || 0).toLocaleString() + ' trees · ' + humanArea(farm.area_sqm)));
        card.append(text('small', (farm.status || 'active') + ' · review: ' + (farm.verification_status || 'pending')));
        const history = text('a', 'Boundary history & review');
        history.href = 'history.html?plantation=' + encodeURIComponent(farm.id);
        history.className = 'text-btn';
        const editLink = text('a', 'Edit plantation');
        editLink.href = 'plantation-form.html?id=' + encodeURIComponent(farm.id);
        editLink.className = 'text-btn';
        card.append(history, editLink);
        list.append(card);
      }
      if (!filtered.length) list.append(text('p', 'No plantations match these filters.'));
      $('directory-count').textContent = filtered.length + ' plantations · page ' + (page + 1) + ' of ' + (last + 1);
      $('directory-previous').disabled = page === 0;
      $('directory-next').disabled = page >= last;
    }
    async function refresh() {
      rows = (await listPlantations()).sort((a, b) => a.name.localeCompare(b.name));
      const select = $('directory-barangay'), previous = select.value;
      select.replaceChildren();
      const all = text('option', 'All barangays'); all.value = ''; select.append(all);
      for (const value of [...new Set(rows.map(row => row.barangay).filter(Boolean))].sort()) {
        const option = text('option', value); option.value = value; select.append(option);
      }
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
      render();
      notify('page-status', navigator.onLine ? 'Authorized plantations updated.' : 'Showing downloaded plantations. Queued changes are listed in Sync & recovery.');
    }
    for (const id of ['directory-search', 'directory-barangay', 'directory-status', 'directory-review']) {
      $(id).addEventListener(id === 'directory-search' ? 'input' : 'change', () => { page = 0; render(); });
    }
    $('directory-previous').addEventListener('click', () => { page--; render(); });
    $('directory-next').addEventListener('click', () => { page++; render(); });
    $('refresh').addEventListener('click', () => refresh().catch(error => notify('page-status', error.message, true)));
    try { if (await requireSession()) await refresh(); }
    catch (error) { notify('page-status', error.message, true); }
  }
  return { start, matches };
})();
