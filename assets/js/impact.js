// Impact focus areas: expand or collapse all sections.
const toggleButton = document.getElementById('toggle-focus');
const sections = Array.from(document.querySelectorAll('#impact-focus details'));
function updateToggle() {
  const allOpen = sections.every(section => section.open);
  toggleButton.textContent = allOpen ? 'Collapse all focus areas' : 'Read all focus areas';
  toggleButton.setAttribute('aria-expanded', String(allOpen));
}
toggleButton.addEventListener('click', () => {
  const expand = !sections.every(section => section.open);
  sections.forEach(section => { section.open = expand; });
  updateToggle();
});
sections.forEach(section => section.addEventListener('toggle', updateToggle));
toggleButton.classList.remove('hidden');
updateToggle();
