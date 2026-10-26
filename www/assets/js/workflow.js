// Workflow guidance uses the same authorized reads as the operational screens.
window.CacaoWorkflow = (() => {
  const node = (tag, value, className) => { const n = document.createElement(tag); n.textContent = value ?? ''; if (className) n.className = className; return n; };
  const link = (label, href) => { const a = node('a', label, 'btn secondary'); a.href = href; return a; };
  const status = value => ({pending:'Pending review', approved:'Approved', rejected:'Needs correction', verified:'Verified', flagged:'Needs review'})[value] || value || 'Pending review';
  function panel(title, description) { const section = node('section', '', 'workflow-panel'); section.append(node('h2', title)); if (description) section.append(node('p', description)); return section; }
  function stages() { const list = node('ol', '', 'workflow-stages'); for (const label of ['Complete profile', 'Profile review', 'Register & map plantation', 'Boundary review', 'Record farm activities', 'Monitor & report']) list.append(node('li', label)); return list; }
  function action(container, title, detail, href) { const card = node('article', '', 'workflow-action'); card.append(node('h3', title), node('p', detail), link('View records', href)); container.append(card); }
  async function dashboard({farmers, plantations}) {
    document.getElementById('workflow-dashboard')?.remove();
    const role = currentAccount.profile.role;
    const section = panel(role === 'farmer' ? 'My registration & mapping' : 'Operational priorities', role === 'farmer' ? 'Check your profile review and plantation registration progress.' : 'Review submissions, maintain plantation records, and coordinate field activities.'); section.id = 'workflow-dashboard';
    const process=node('details','','workflow-process');process.append(node('summary','Registration and monitoring workflow'),stages());section.append(process);
    const cards = node('div', '', 'workflow-grid'); section.append(cards);
    if (role === 'farmer') {
      const own = farmers.filter(row => row.owner_id === currentAccount.user.id);
      if (!own.length) action(cards, 'Complete your farmer profile', 'Submit your details for staff review.', 'farmers.html');
      for (const row of own) action(cards, row.full_name + ': ' + status(row.registration_status), row.registration_status === 'rejected' ? 'Read the reviewer?s feedback, update your profile, and resubmit.' : row.registration_status === 'approved' ? 'Continue with plantation registration and farm records.' : 'Your profile is awaiting staff review.', row.registration_status === 'approved' ? 'plantations.html' : 'reviews.html?farmer=' + encodeURIComponent(row.id));
    } else {
      const pending = farmers.filter(row => row.registration_status === 'pending').length;
      action(cards, role === 'field' ? 'Visit assigned farmers' : 'Review farmer profiles', pending + ' profiles pending review within your authorized scope.', role === 'field' ? 'farmers.html' : 'reviews.html');
      if (role === 'super_admin') action(cards, 'Manage staff assignments', 'Keep farmer access and staff responsibilities current.', 'users.html');
    }
    const pendingMaps = plantations.filter(row => row.verification_status !== 'verified').length;
    action(cards, 'Plantation workspaces', plantations.length + ' plantations. ' + pendingMaps + ' boundaries awaiting verification or follow-up.', 'plantations.html');
    if (!plantations.length) action(cards, 'Register a plantation', 'Link a farmer profile, capture the boundary, and review the area.', 'plantation-form.html');
    if (role !== 'farmer') {
      const outcomes = await Promise.allSettled([listAll('plantation_tasks'), listAll('pest_reports')]);
      const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
      const tasks = outcomes[0];
      const overdue = tasks.status === 'fulfilled' ? tasks.value.filter(row => row.scheduled_on < today && !['completed','cancelled'].includes(row.status)).length : null;
      action(cards, 'Tasks and farm visits', overdue === null ? 'Task totals unavailable. Open the schedule to retry.' : overdue + ' overdue tasks within your authorized scope.', 'tasks.html');
      const pests = outcomes[1];
      action(cards, 'Farm health follow-up', pests.status === 'fulfilled' ? pests.value.filter(row => row.resolution_status !== 'resolved').length + ' unresolved pest and disease reports.' : 'Farm health totals unavailable. Open reports to retry.', 'pests.html');
    }
    action(cards, 'Sync & recovery', 'Prepare records online, collect field data, then synchronize and review conflicts. Offline account access currently supports farmers only.', 'sync.html');
    const content=document.getElementById('page-content');
    const indicators=content.querySelector?.('.dashboard-secondary') || content.querySelector?.('.stats');
    if(indicators)indicators.after(section);else content.prepend(section);
  }
  async function workspace() {
    try {
      if (!await requireSession()) return;
      const id = new URLSearchParams(location.search).get('id');
      if (!id) throw new Error('Choose a plantation from the plantation directory.');
      const farm = await getRecord('plantations', id);
      const root = document.getElementById('plantation-workspace'); root.replaceChildren();
      root.append(node('h1', farm.name), node('p', [farm.farmer_name, farm.barangay, farm.municipality].filter(Boolean).join(' · ')));
      const overview = panel('Plantation overview');
      const details = node('dl', '', 'workflow-details');
      for (const [label, value] of [['Area', humanArea(farm.area_sqm)], ['Trees', Number(farm.tree_count || 0).toLocaleString()], ['Farm status', farm.status || 'active'], ['Boundary review', status(farm.verification_status)], ['Boundary revision', farm.revision ?? 'Legacy']]) details.append(node('dt', label), node('dd', value));
      overview.append(details, link('Edit plantation / boundary', 'plantation-form.html?id=' + encodeURIComponent(id)), link('Boundary history & reviewer feedback', 'history.html?plantation=' + encodeURIComponent(id))); root.append(overview);
      if (farm.farmer_id) {
        try {
          const farmer = await getRecord('farmers', farm.farmer_id);
          overview.append(node('p', 'Farmer profile: ' + status(farmer.registration_status)));
        } catch (error) { overview.append(node('p', 'Farmer profile status unavailable. Open Farmer profiles to review.')); }
      }
      if (farm.boundary) {
        const map = node('div'); map.id = 'workspace-boundary-map'; map.style.height = '300px'; map.setAttribute('aria-label', 'Plantation boundary map'); overview.append(map);
        CacaoApp.drawMap([farm], map.id);
      }
      const groups = panel('Farm records', 'Open a section to view records and add updates for this plantation.'); const grid = node('div', '', 'workflow-grid'); groups.append(grid);
      const suffix = '?plantation=' + encodeURIComponent(id);
      const sections = [['Tree inventories','Latest counts and inventory history.','trees'],['Harvest & production','Pods, wet beans and dry beans.','harvests'],['Pest reports','Observations, severity and resolution.','pests'],['Treatments','Treatment records and next inspection dates.','treatments'],['Maintenance','Pruning, fertilizer, irrigation and weeding.','maintenance'],['Tree events','Planting, mortality and replacement.','tree-events'],['Tree tags','Individual tree records.','tree-tags']];
      if (currentAccount.profile.role !== 'farmer') sections.push(['Tasks','Schedule work and track completion.','tasks'],['Inspections','Follow up on pest and disease reports.','inspections'],['Attendance','Worker attendance and hours.','attendance']);
      for (const [title, description, page] of sections) action(grid, title, description, page + '.html' + suffix);
      root.append(groups);
      const activity = panel('Recent plantation activity'); root.append(activity);
      const outcomes = await Promise.allSettled(['harvests','pest_reports','maintenance_records'].map(table => listAll(table)));
      outcomes.forEach((outcome, index) => {
        const title = ['Harvests','Pest reports','Maintenance'][index];
        if (outcome.status !== 'fulfilled') { activity.append(node('p', title + ': unavailable. Open the section to retry.')); return; }
        const rows = outcome.value.filter(row => row.plantation_id === id).sort((a,b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0,3);
        activity.append(node('h3', title));
        if (!rows.length) activity.append(node('p', 'No records available.'));
        for (const row of rows) activity.append(node('p', [row.harvest_date || row.observed_on || row.performed_on, row.pest_name || row.activity_type || (row.dry_bean_kg + ' kg dry beans'), row.resolution_status].filter(Boolean).join(' · ')));
      });
      const sync = panel('Before leaving the field', 'Prepare records online → Unlock field data → Collect records → Reconnect → Synchronize → Resolve conflicts. Device-local drafts and pending submissions are confirmed only after successful synchronization.'); sync.append(link('Open sync & recovery', 'sync.html')); root.append(sync);
      notify('page-status', 'Showing plantation records available to your account.');
    } catch (error) { notify('page-status', error.message, true); }
  }
  return {dashboard, workspace, status};
})();
